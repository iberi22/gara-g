/**
 * src/lib/authenticate.ts — Autenticación compartida por el endpoint y la página.
 *
 * Motivo: `pages/login.astro` hacía `fetch(${Astro.url.origin}/api/auth/login)`,
 * es decir, el Worker se llamaba a sí mismo por su dominio público. Cloudflare
 * corta esa subpetición con 522, y la página lo traducía a
 * `Credenciales inválidas (522)`: el login por formulario no funcionaba en
 * producción para nadie, pero el mensaje hacía pensar que era la contraseña.
 *
 * Aquí vive la lógica; el endpoint y la página la llaman directamente, sin
 * subpetición. Una sola implementación: cambiar el login en un sitio ya no
 * puede dejar el otro desactualizado.
 */
import { DEFAULT_INSTANCE_ID } from './domain.config';
import { env } from 'cloudflare:workers';
import { hashPassword, verifyPassword } from './password';
import { normalizeRole } from './rbac';
import { pinTenant } from './staging';

const SESSION_TTL = 7 * 24 * 60 * 60; // 7 días en segundos

export interface AuthResult {
  ok: boolean;
  token?: string;
  role?: string;
  error?: string;
  status: number;
}

/**
 * No hay usuarios de demostracion. Hasta 2026-10 existia una lista con una cuenta admin de
 * contrasena conocida que se usaba cuando D1 no tenia al usuario y ENVIRONMENT no era `production`:
 * bastaba un deploy sin esa var para que el dominio publico diera rol admin a cualquiera
 * (verificado el 2026-09-30). Ahora el unico origen de usuarios es D1 en todos los entornos;
 * para desarrollo se crea un usuario en la D1 local.
 */

/** Busca el usuario por email en la tabla `entity` de D1. */
async function findUserByEmailD1(
  d1: D1Database,
  email: string,
  instanceId: string,
): Promise<{ userId: string; email: string; role: string; passwordHash: string } | null> {
  // El email viene del cuerpo del POST, que no es de fiar: un `{"email": ["a"]}`
  // o `{"email": {"x": 1}}` llega aqui como array u objeto. SQLite no puede
  // enlazar esos tipos y `.bind()` lanza ("Provided value cannot be bound to
  // SQLite parameter 2"), lo que salia como 500. Un login fallido debe ser un
  // 401, no un error del servidor, y ademas no debe revelar nada sobre la base.
  if (typeof email !== 'string' || !email.includes('@')) return null;

  const res = await d1
    .prepare(
      `SELECT id AS userId, data FROM entity
       WHERE instance_id = ? AND entity = 'user'
         AND json_extract(data, '$.active') = 1
         AND lower(json_extract(data, '$.email')) = lower(?)`,
    )
    .bind(instanceId, email)
    .first<{ userId: string; data: string }>();
  if (!res) return null;
  const data = JSON.parse(res.data) as { email?: string; role?: string; passwordHash?: string };
  if (!data.passwordHash) return null;
  return {
    userId: res.userId,
    email: data.email ?? email,
    role: data.role ?? 'observer',
    passwordHash: data.passwordHash,
  };
}

/**
 * Autentica contra D1 (sin usuarios de demostracion: sin fila en D1 no hay sesion).
 * Deja la sesión en KV. No devuelve una Response: quien llama decide el formato.
 *
 * El tenant se fija aqui (una sola vez, en el unico punto donde nace una sesion) y no
 * en cada endpoint que la lee: quien llame a `authenticate()` hereda automaticamente el
 * tenant correcto, y no cabe que un endpoint nuevo se quede sin el. Ver pinTenant.
 */
export async function authenticate(
  email: string,
  password: string,
  // El tipo se declara a mano porque el valor por defecto (`DEFAULT_INSTANCE_ID`) es un
  // literal: sin la anotacion, TS lo fija en ese literal y la reasignacion del tenant
  // del stage no compila.
  instanceId: string = DEFAULT_INSTANCE_ID,
): Promise<AuthResult> {
  if (!email || !password) {
    return { ok: false, error: 'Email y password requeridos', status: 400 };
  }

  // En el stage se busca el usuario DENTRO del tenant del stage, no en el de
  // produccion: el login contra `gara-g-default-instance` es el login de produccion,
  // y un stage con credenciales de produccion es la mitad del problema que el stage
  // tiene que evitar. Ver src/lib/staging.ts.
  instanceId = pinTenant(instanceId) ?? instanceId;

  let matched: { userId: string; email: string; role: string; passwordHash: string } | null = null;

  const d1 = (env as unknown as { SWAL_D1?: D1Database }).SWAL_D1;
  if (d1) {
    const found = await findUserByEmailD1(d1, email, instanceId);
    if (found && (await verifyPassword(password, found.passwordHash))) matched = found;
  }

  if (!matched) return { ok: false, error: 'Credenciales inválidas', status: 401 };

  const role = normalizeRole(matched.role) ?? 'observer';
  const token = crypto.randomUUID();
  const session = {
    userId: matched.userId,
    email: matched.email,
    role,
    // El tenant viaja DENTRO de la sesión, no se deduce de ella. Sin esto,
    // `middleware.ts` caía siempre a `user.instanceId ?? DEMO_INSTANCE_ID` y
    // `locals.tenant` era siempre el fallback: /r2/* daba 403 y /api/fleet/*
    // consultaba la flota del tenant por defecto sin que nadie lo pidiera.
    instanceId,
    exp: Date.now() + SESSION_TTL * 1000,
  };

  const kv = (env as unknown as { SESSION?: KVNamespace }).SESSION;
  if (kv) {
    await kv.put(`token:${token}`, JSON.stringify(session), { expirationTtl: SESSION_TTL });
  }

  return { ok: true, token, role, status: 200 };
}

export { SESSION_TTL };
