/**
 * src/pages/api/xavier/_proxy.ts — helper compartido del proxy server-side a Xavier.
 *
 * Por qué existe: src/lib/xavier.ts (y xavierSync.ts) hacen `fetch` DESDE EL NAVEGADOR
 * contra `http://localhost:8006`. El navegador del usuario final —en Santiago, o en
 * una voleadora— no resuelve localhost:8006, así que la memoria de agentes nunca
 * llegaba a Xavier en producción. El código existía; el flujo, no.
 *
 * El Worker sí puede hablar con Xavier: desde el servidor, `localhost:8006` es la
 * máquina donde corre el nodo, y fuera de ella se usa el host público.
 *
 * Este módulo no se importa desde el cliente: solo desde endpoints APIRoute.
 */
import { env } from 'cloudflare:workers';
import { normalizeRole } from '../../../lib/rbac';
import { getSessionUser } from '../../../lib/session';

export interface XavierEnv {
  XAVIER_URL?: string;
  XAVIER_API_KEY?: string;
}

export interface XavierCallResult {
  ok: boolean;
  status: number;
  body: string;
}

/** Base de Xavier sin barra final. Devuelve null si no está configurada. */
export function xavierBase(): string | null {
  const base = (env as unknown as XavierEnv).XAVIER_URL;
  if (!base) return null;
  return base.replace(/\/+$/, '');
}

export function jsonResponse(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Exige una sesión válida y devuelve el usuario, o responde 401.
 *
 * Hasta el 2026-10-01 estos endpoints no miraban la sesión: `/api/xavier/search`
 *dejaba cualquier autenticado leer toda la memoria de agentes del ecosistema
 * (no está filtrada por proyecto ni por tenant), y `/api/xavier/add` podía
 * escribir memorias que leerían después otros agentes — inyección de prompts
 * persistente. Aquí se cierra la puerta de entrada.
 */
export async function requireSession(
  cookies:
    | {
        get?: (name: string) => { value: string } | undefined;
      }
    | undefined,
): Promise<{ userId: string; email: string; role: string; tenant?: string } | Response> {
  // `cookies` puede no venir: Astro lo inyecta segun la ruta, y un endpoint
  // llamado sin contexto de peticion no debe reventar. Sin cookie no hay sesion.
  const token = cookies?.get?.('session')?.value ?? '';
  const user = token ? await getSessionUser(token) : null;
  if (!user) {
    return jsonResponse({ ok: false, error: 'No autenticado' }, 401);
  }
  return {
    userId: user.userId,
    email: user.email,
    role: user.role,
    tenant: user.instanceId,
  };
}

/** Exige rol admin. Devuelve la respuesta 403 si no lo tiene. */
export function requireAdmin(user: { role: string }): Response | null {
  const role = normalizeRole(user.role);
  if (role !== 'admin') {
    return jsonResponse({ ok: false, error: 'Requiere rol admin' }, 403);
  }
  return null;
}

/**
 * Reenvía una petición a Xavier y devuelve su respuesta tal cual.
 *
 * - 503 si XAVIER_URL no está configurado (falta el binding en wrangler.toml).
 * - 502 si Xavier no responde o lanza: el Worker no debe propagar una excepción.
 * - Cualquier otro código se propaga para que el cliente distinga 401 de 404.
 */
export async function callXavier(
  path: string,
  init: { method: string; body?: string },
): Promise<XavierCallResult> {
  const base = xavierBase();
  if (!base) {
    return {
      ok: false,
      status: 503,
      body: JSON.stringify({ ok: false, error: 'XAVIER_URL no configurado' }),
    };
  }

  const apiKey = (env as unknown as XavierEnv).XAVIER_API_KEY;

  try {
    const upstream = await fetch(`${base}${path}`, {
      method: init.method,
      headers: {
        'Content-Type': 'application/json',
        // ⚠  El header que acepta Xavier es `X-Xavier-Token`, NO `X-API-Key`.
        // Verificado contra el nodo real el 2026-09-30: con X-API-Key o
        // Authorization responde 401 aunque la key sea correcta. El secret se llama
        // XAVIER_API_KEY aunque viaje en X-Xavier-Token; se mandan los tres para
        // servir a las distintas instancias, pero X-Xavier-Token es el que importa.
        ...(apiKey
          ? {
              'X-Xavier-Token': apiKey,
              'X-API-Key': apiKey,
              Authorization: `Bearer ${apiKey}`,
            }
          : {}),
      },
      ...(init.body !== undefined ? { body: init.body } : {}),
    });
    const body = await upstream.text();
    return { ok: upstream.ok, status: upstream.status, body };
  } catch (err) {
    console.error('[xavier] upstream error', err);
    return {
      ok: false,
      status: 502,
      body: JSON.stringify({
        ok: false,
        // El detalle va al log; `detail` en la respuestaFiltraba el nombre del
        // host, el esquema de URLs y a veces el mensaje de fetch de DNS.
        error: 'Xavier no alcanzable',
      }),
    };
  }
}

/** Lee el cuerpo de la request sin lanzar si viene vacío o malformado. */
export async function readBody(request: Request): Promise<string> {
  try {
    return await request.text();
  } catch {
    return '{}';
  }
}
