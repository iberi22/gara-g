/**
 * src/pages/api/fleetApi/auth.ts — Helper de autenticación para endpoints /api/fleet/*.
 *
 * getAuthUser(request) — lee cookie `session`, consulta KV SESSION y devuelve
 * el usuario autenticado, o null si:
 *   - no hay cookie
 *   - el token no existe en KV
 *   - la sesión está expirada (se borra automáticamente)
 *
 * Esta función NO chequea permisos: para autorización usa can() de src/lib/rbac.ts.
 *
 * El formato de la sesión en KV es: `token:{uuid}` → JSON({ userId, email, role, exp })
 * (escrito por /api/auth/login.ts).
 */
import { env } from 'cloudflare:workers';
import { devFallbackAllowed } from '../../../lib/session';

export interface AuthUser {
  userId: string;
  email: string;
  role: string; // 'admin' | 'operator' | 'observer' (validado en rbac.ts)
  /**
   * Instancia/flota a la que pertenece el usuario. Viaja en la sesion (KV), nunca
   * en la request: la PK de D1 es (instance_id, entity, id), asi que acceptarlo del
   * cliente permitiria leer la flota de otro tenant. Ver src/lib/fleetApi.ts.
   */
  instanceId?: string;
  exp: number;
}

/**
 * Fallback de desarrollo: sin binding KV (p. ej. `pnpm dev` local sin Miniflare)
 * se acepta cualquier token no vacio como admin, para que LiveMap polling,
 * GameGarage y notificaciones no devuelvan 401 en dev.
 *
 * ⚠  Es la misma regla que src/lib/session.ts (devFallbackAllowed): solo con
 * DEV_ADMIN_SESSION="true" y ENVIRONMENT development/local. Antes bastaba con
 * ENVIRONMENT != production, lo que dejaba staging/preview abiertos a cookies
 * inventadas. Se introdujo en 1f5d349c (2026-09-05).
 *
 * devAdminUser() es el usuario que se emite en ese caso.
 */
function devAdminUser(): AuthUser {
  return {
    userId: 'usr_001',
    email: 'admin@gara-g.swal.network',
    role: 'admin',
    exp: Date.now() + 86_400_000,
  };
}

function parseCookies(cookieHeader: string | null): Record<string, string> {
  if (!cookieHeader) return {};
  const out: Record<string, string> = {};
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const k = trimmed.slice(0, eq);
    const v = trimmed.slice(eq + 1);
    out[k] = decodeURIComponent(v);
  }
  return out;
}

/**
 * Devuelve el usuario autenticado (cookie + KV válido) o null.
 * No chequea permisos — el caller debe usar can() de rbac.ts.
 *
 * El fallback de desarrollo (token cualquiera = admin) SOLO aplica con
 * DEV_ADMIN_SESSION="true" y ENVIRONMENT development/local (devFallbackAllowed).
 */
export async function getAuthUser(request: Request): Promise<AuthUser | null> {
  try {
    const cookies = parseCookies(request.headers.get('cookie'));
    const token = cookies['session'];
    if (!token) return null;

    const kv = (env as unknown as { SESSION?: KVNamespace }).SESSION;
    if (!kv) return devFallbackAllowed() ? devAdminUser() : null;

    const raw = await kv.get(`token:${token}`);
    if (!raw) return devFallbackAllowed() ? devAdminUser() : null;

    const session = JSON.parse(raw) as AuthUser;
    if (typeof session.exp !== 'number' || Date.now() > session.exp) {
      // Sesión expirada — limpiar
      await kv.delete(`token:${token}`);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

/** Response 401 JSON estándar para endpoints /api/fleet/*. */
export function unauthorized(message = 'No autenticado'): Response {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Response 403 JSON estándar para endpoints /api/fleet/*. */
export function forbidden(message = 'Acceso denegado'): Response {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  });
}
