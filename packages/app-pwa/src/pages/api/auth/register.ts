import { randomUUID } from 'node:crypto';
import { env } from 'cloudflare:workers';
/**
 * src/pages/api/auth/register.ts — Admin-only user creation.
 *
 * POST /api/auth/register
 * Auth: session cookie (admin role required).
 * Body: { email, password, role, active? }
 * Response: { ok: true, userId } | { ok: false, error }
 *
 * Hashes password via PBKDF2 (src/lib/password.ts) and stores as a D1 entity row
 * with entity='user'. instanceId is taken from the session (multi-tenant isolation).
 */
import type { APIRoute } from 'astro';
import { hashPassword } from '../../../lib/password';
import { type Role, normalizeRole } from '../../../lib/rbac';
import { DEFAULT_INSTANCE_ID } from '../../../lib/xavier';
import { forbidden, getAuthUser, unauthorized } from '../fleetApi/auth';

interface D1Database {
  prepare: (sql: string) => {
    bind: (...args: any[]) => {
      run: () => Promise<{ success?: boolean; meta?: any }>;
      all: <T>() => Promise<{ results?: T[] }>;
    };
  };
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonResponse(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

export const OPTIONS: APIRoute = async () =>
  new Response(null, { status: 204, headers: CORS_HEADERS });

export const POST: APIRoute = async ({ request }) => {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden('Solo administradores pueden crear usuarios');

  try {
    const body = (await request.json().catch(() => ({}))) as {
      email?: string;
      password?: string;
      role?: string;
      active?: boolean;
    };
    const { email, password, role: roleInput } = body;
    if (!email || !password) {
      return jsonResponse({ ok: false, error: 'email y password requeridos' }, 400);
    }
    const role = normalizeRole(roleInput);
    if (!role) {
      return jsonResponse({ ok: false, error: 'role inválido (admin|operator|observer)' }, 400);
    }
    if (password.length < 6) {
      return jsonResponse({ ok: false, error: 'password mínimo 6 caracteres' }, 400);
    }

    const passwordHash = await hashPassword(password);
    const userId = `usr_${randomUUID()}`;
    const data = { email, passwordHash, role, active: body.active !== false };

    const d1 = (env as unknown as { SWAL_D1?: D1Database }).SWAL_D1;
    if (!d1) {
      return jsonResponse({ ok: false, error: 'D1 no disponible' }, 503);
    }

    // Verificar email único
    const existing = await d1
      .prepare('SELECT id FROM entity WHERE instance_id = ? AND entity = ?')
      .bind(user.userId, 'user') // instanceId simplification
      .all<{ id: string }>();
    // Note: usamos la instanceId de la sesión, no userId. El fallback es la
    // constante canónica, no un tenant inventado: con 'gara-g-default' el
    // registro iba a un tenant distinto del de la app.
    const sessionInstance = (user as { instanceId?: string }).instanceId ?? DEFAULT_INSTANCE_ID;
    const existingByEmail = await d1
      .prepare('SELECT id, data FROM entity WHERE instance_id = ? AND entity = ?')
      .bind(sessionInstance, 'user')
      .all<{ id: string; data: string }>();
    for (const row of existingByEmail.results ?? []) {
      try {
        const parsed = JSON.parse(row.data) as { email?: string };
        if (parsed.email === email) {
          return jsonResponse({ ok: false, error: 'Email ya registrado' }, 409);
        }
      } catch {}
    }

    await d1
      .prepare(
        'INSERT INTO entity (instance_id, entity, id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .bind(
        sessionInstance,
        'user',
        userId,
        JSON.stringify(data),
        new Date().toISOString(),
        new Date().toISOString(),
      )
      .run();

    return jsonResponse({ ok: true, userId, email, role }, 201);
  } catch (e) {
    return jsonResponse({ ok: false, error: 'Error interno' }, 500);
  }
};
