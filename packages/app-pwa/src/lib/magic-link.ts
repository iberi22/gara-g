/**
 * src/lib/magic-link.ts — Nombres de un solo uso, sin contraseña, vía Cloudflare.
 *
 * Por qué magic link y no más contraseñas: el login por formulario ya tenía
 * PBKDF2 y un problema peor (el fetch a sí mismo, 522). Un enlace de un solo uso
 * elimina el reusable de credenciales y hace imposible el phishing de
 * credenciales, porque no hay credencial que robar.
 *
 * Nombres de un solo uso sobre Cloudflare Email Routing (`send_email` del
 * binding, sin proveedor externo). Requiere que el Worker esté en un dominio con
 * Email Routing activo; si falta el binding, `canSendMagicEmail()` lo dice y el
 * endpoint de solicitud no finge haber enviado nada.
 *
 * Reglas:
 *   · El token se genera con crypto.randomUUID + entropía extra, nunca con Math.random.
 *   · Solo se guarda el hash SHA-256 del token en KV, nunca el token. Un volcado
 *     de KV no permite autenticarse.
 *   · TTL de 15 minutos, un solo uso, borrado en cuanto se consume.
 *   · La respuesta al endpoint de solicitud es SIEMPRE la misma, exista o no el
 *     email: si dijera "no existe ese usuario", sería un oráculo de enumeración.
 */
import { DEFAULT_INSTANCE_ID } from './domain.config';
import { env } from 'cloudflare:workers';
import { escapeHtml } from './html.js';

const REQUEST_PREFIX = 'magic:req:';
const SESSION_PREFIX = 'token:';
export const MAGIC_LINK_TTL = 15 * 60; // 15 minutos

/** Origen permitido en el enlace. Nunca se toma de la request. */
export interface MagicLinkEnv {
  SWAL_D1?: D1Database;
  SESSION?: KVNamespace;
  SWAL_KV?: KVNamespace;
  ENVIRONMENT?: string;
  /** Dominio con Email Routing, p.ej. `swal.network`. */
  EMAIL_FROM_DOMAIN?: string;
  /** Remitente completo; si falta se compone `no-reply@{EMAIL_FROM_DOMAIN}`. */
  EMAIL_FROM?: string;
  /** Origen del enlace. Se valida contra la lista; por defecto, producción. */
  PUBLIC_SITE_URL?: string;
}

export interface MagicLinkRequestBody {
  email: string;
  /** Origen del enlace; solo se acepta si está en la lista permitida. */
  origin?: string;
}

export type MagicLinkResult =
  | { ok: true; token?: string; emailSent: boolean }
  | { ok: false; error: string; status: number };

function readEnv(): MagicLinkEnv {
  return env as unknown as MagicLinkEnv;
}

/** ¿Hay con qué enviar correo? Si no, el flujo no puede completarse. */
export function canSendMagicEmail(): boolean {
  try {
    const e = readEnv();
    return Boolean(e.EMAIL_FROM_DOMAIN || e.EMAIL_FROM);
  } catch {
    return false;
  }
}

/**
 * Origenes admitidos para el enlace.
 *
 * El enlace es una URL que el usuario va a pulsar: si el `origin` viniera de la
 * request sin validar, cualquiera podría pedir un magic link a `gara-g` y hacer
 * que el correo llegue con un destino elegido por el atacante. Por eso solo se
 * aceptan los declarados, no los observados.
 */
export function allowedOrigins(): string[] {
  const e = (() => {
    try {
      return readEnv();
    } catch {
      return {} as MagicLinkEnv;
    }
  })();
  const out = new Set<string>();
  if (e.PUBLIC_SITE_URL) out.add(e.PUBLIC_SITE_URL.replace(/\/+$/, ''));
  // El dominio de producción siempre vale, aunque no esté declarado.
  out.add('https://gara-g.swal.network');
  return [...out];
}

/** Resuelve y valida el origen del enlace contra la lista permitida. */
export function resolveOrigin(requested?: string): string {
  const permitidos = allowedOrigins();
  if (!requested) return permitidos[permitidos.length - 1];
  const limpio = requested.replace(/\/+$/, '');
  return permitidos.includes(limpio) ? limpio : permitidos[permitidos.length - 1];
}

/** SHA-256 en hex. Lo que se guarda en KV. */
export async function hashToken(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Token de alta entropía: UUID v4 (122 bits) más 128 bits de crypto.getRandomValues.
 * No es criptográficamente necesario para un token de 15 min y un solo uso; se
 * añade para que un intento de adivinar en línea no tenga ni la forma de estar
 * dentro del rango plausible.
 */
export function generateToken(): string {
  const extra = new Uint8Array(16);
  crypto.getRandomValues(extra);
  const suffix = [...extra].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${crypto.randomUUID()}${suffix}`;
}

/** Email normalizado para comparar. Minúsculas y sin espacios. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function emailAddress(): string | null {
  const e = (() => {
    try {
      return readEnv();
    } catch {
      return {} as MagicLinkEnv;
    }
  })();
  if (e.EMAIL_FROM) return e.EMAIL_FROM;
  if (e.EMAIL_FROM_DOMAIN) return `no-reply@${e.EMAIL_FROM_DOMAIN}`;
  return null;
}

/** Comprueba si existe el usuario en D1. No filtra el motivo al cliente. */
export async function userExists(email: string): Promise<{ userId: string; role: string } | null> {
  const d1 = readEnv().SWAL_D1;
  if (!d1) return null;
  try {
    const row = await d1
      .prepare(
        `SELECT id AS userId, data FROM entity
         WHERE instance_id = ? AND entity = 'user'
           AND lower(json_extract(data, '$.email')) = ?
         LIMIT 1`,
      )
      .bind(DEFAULT_INSTANCE_ID, normalizeEmail(email))
      .first<{ userId: string; data: string }>();
    if (!row) return null;
    const data = JSON.parse(row.data) as { role?: string; active?: boolean };
    if (data.active === false) return null;
    return { userId: row.userId, role: data.role ?? 'observer' };
  } catch {
    return null;
  }
}

/** Guarda el hash del token con el email y el rol, con TTL. */
export async function storeMagicToken(
  tokenHash: string,
  email: string,
  userId: string,
  role: string,
): Promise<boolean> {
  const kv = (() => {
    try {
      const e = readEnv();
      return e.SESSION ?? e.SWAL_KV;
    } catch {
      return undefined;
    }
  })();
  if (!kv) return false;
  await kv.put(
    `${REQUEST_PREFIX}${tokenHash}`,
    JSON.stringify({ email: normalizeEmail(email), userId, role }),
    { expirationTtl: MAGIC_LINK_TTL },
  );
  return true;
}

/** Devuelve el enlace y lo deja marcado como enviado (traza de auditoría). */
export function buildLink(origin: string, token: string): string {
  return `${origin}/api/auth/magic?token=${encodeURIComponent(token)}`;
}

/**
 * Cuerpo del correo. Texto plano a propósito: el HTML se cita y algunos clientes
 * lo ocultan. Sin el token completo en ningún log.
 */
export function emailBody(link: string): string {
  return [
    'Entra a GARA-G con este enlace:',
    '',
    link,
    '',
    'El enlace vale una sola vez y caduca en 15 minutos.',
    'Si no lo pediste, ignora este correo: no se hizo ningún cambio.',
  ].join('\n');
}

/**
 * Envía el correo por Cloudflare Email Routing (`send_email`).
 * Devuelve false si no hay binding o si el envío falla; quien llama decide si eso
 * es un 503 o una respuesta neutra.
 */
export async function sendMagicEmail(to: string, subject: string, body: string): Promise<boolean> {
  const from = emailAddress();
  if (!from) return false;
  try {
    const send = (env as unknown as { send_email?: (m: unknown) => Promise<unknown> }).send_email;
    if (typeof send !== 'function') return false;
    await send({ from, to: [to], subject, html: `<pre>${escapeHtml(body)}</pre>` });
    return true;
  } catch {
    return false;
  }
}

export { SESSION_PREFIX, REQUEST_PREFIX };
