/**
 * src/lib/session.ts — Lectura de sesión desde KV.
 *
 * Estaba dentro de src/middleware.ts como función privada, lo que impedía que
 * cualquier endpoint comprobara la sesión por su cuenta y terminaría
 * reimplementándola. `pages/r2/[...path].ts` la necesita para no servir el vault
 * de documentos a cualquiera.
 *
 * La regla que se mantiene aquí: un fallo al leer KV **no** puede degradar a
 * admin. El fallback de desarrollo solo existe con DEV_ADMIN_SESSION="true" y
 * ENVIRONMENT development/local; en cualquier otro caso se deniega.
 */
import { DEFAULT_INSTANCE_ID } from './domain.config';
import { env } from 'cloudflare:workers';

export interface SessionUser {
  userId: string;
  email: string;
  role: string;
  /** Flota/tenant del usuario. La PK de D1 es (instance_id, entity, id). */
  instanceId?: string;
  exp: number;
}

interface Env {
  SESSION?: KVNamespace;
  SWAL_KV?: KVNamespace;
  ENVIRONMENT?: string;
  DEV_ADMIN_TOKEN?: string;
  /** Opt-in de la sesión de admin de desarrollo; ver devFallbackAllowed(). */
  DEV_ADMIN_SESSION?: string;
}

/** Entornos en los que se puede activar la sesión de admin de desarrollo. */
const DEV_ENVIRONMENTS = new Set(['development', 'local']);

/** Lee una var del Worker (`cloudflare:workers`) y, si no está, de `process.env`. */
function readVar(name: keyof Env): string | undefined {
  let value: unknown;
  try {
    value = (env as unknown as Env)[name];
  } catch {
    /* sin env: seguimos con process.env */
  }
  if (value === undefined && typeof process !== 'undefined') {
    value = process.env[name];
  }
  return typeof value === 'string' ? value : undefined;
}

/**
 * ¿Se permite el fallback de desarrollo (cookie desconocida = admin)?
 *
 * Solo con las DOS condiciones a la vez:
 *   1. `DEV_ADMIN_SESSION="true"` — opt-in explícito, y
 *   2. `ENVIRONMENT` es `development` o `local`.
 *
 * Antes bastaba con que ENVIRONMENT no fuera `production`: cualquier staging,
 * preview o despliegue sin la var aceptaba una cookie inventada como admin.
 * Ahora la ausencia de cualquiera de las dos vars lo cierra (staging, preview y
 * production nunca lo tienen). Para el dev local ver `packages/app-pwa/.dev.vars.example`.
 */
export function devFallbackAllowed(): boolean {
  const environment = readVar('ENVIRONMENT');
  if (!environment || !DEV_ENVIRONMENTS.has(environment)) return false;
  return readVar('DEV_ADMIN_SESSION') === 'true';
}

/**
 * Sesión de admin de desarrollo. Solo se emite si `devFallbackAllowed()` (opt-in
 * DEV_ADMIN_SESSION="true" + ENVIRONMENT development/local).
 */
function devAdminSession(): SessionUser {
  return {
    userId: 'usr_001',
    email: 'admin@gara-g.swal.network',
    role: 'admin',
    instanceId: DEFAULT_INSTANCE_ID,
    exp: Date.now() + 86_400_000,
  };
}

/** Resuelve un token de sesión contra KV. `null` si no hay sesión válida. */
export async function getSessionUser(sessionToken: string): Promise<SessionUser | null> {
  const devAdmin = devFallbackAllowed() ? devAdminSession() : null;

  try {
    const kv = (env as unknown as Env).SESSION ?? (env as unknown as Env).SWAL_KV;
    if (!kv) return sessionToken && devAdmin ? devAdmin : null;

    const raw = await kv.get(`token:${sessionToken}`);
    if (!raw) return sessionToken && devAdmin ? devAdmin : null;

    const session = JSON.parse(raw) as SessionUser;
    if (typeof session.exp !== 'number' || Date.now() > session.exp) {
      await kv.delete(`token:${sessionToken}`);
      return null;
    }
    return session;
  } catch {
    // ⚠  En produccion un fallo al leer KV NO puede degradar a admin: se deny.
    return sessionToken && devAdmin ? devAdmin : null;
  }
}

/** Lee la sesión desde la cabecera `Cookie` de una Request cruda. */
export async function getUserFromRequest(request: Request): Promise<SessionUser | null> {
  const cookieHeader = request.headers.get('cookie') ?? '';
  const match = cookieHeader.match(/(?:^|;\s*)session=([^;]+)/);
  if (!match) return null;
  return getSessionUser(decodeURIComponent(match[1]));
}
