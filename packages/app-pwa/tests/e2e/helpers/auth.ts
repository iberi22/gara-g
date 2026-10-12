import type { BrowserContext } from '@playwright/test';

/**
 * helpers/auth.ts — Sesión admin para specs e2e.
 *
 * El middleware exige cookie `session` en /fleet* (salvo PUBLIC_DEMO).
 * En dev CUALQUIER token no vacío se acepta como admin, pero solo con
 * DEV_ADMIN_SESSION=true y ENVIRONMENT development/local (devFallbackAllowed en
 * src/lib/session.ts; playwright.config.ts los pasa al `pnpm dev` que arranca, o
 * ver packages/app-pwa/.dev.vars.example) — mismo patrón que
 * tracking-live.spec.ts. Uso:
 *
 *   import { useAdminSession } from './helpers/auth';
 *   test.beforeEach(async ({ context }) => { await useAdminSession(context); });
 *
 * DOS cookies, y ambas son necesarias:
 *
 * 1. `session` — la sesión de admin. En dev su userId es `usr_001`
 *    (devAdminSession en src/lib/session.ts).
 *
 * 2. `gara_onb` — marca de "onboarding ya hecho" para ESE userId. Sin ella,
 *    GET /fleet responde 303 a /fleet/bienvenida (src/middleware.ts:282-289)
 *    y todo spec que navegue a /fleet aterriza en el onboarding en vez del
 *    dashboard, fallando por datos, no por sesión.
 *
 * Las cookies se scopear con `url` (no `domain`) porque la suite corre contra
 * hosts distintos: con `domain: 'localhost'` la cookie NO viaja a 127.0.0.1 y
 * /fleet rebotaba a /login sin importar qué token pusiéramos.
 */
export const ADMIN_SESSION_TOKEN = 'test-admin-session-token';

/** userId del admin de desarrollo; ver devAdminSession() en src/lib/session.ts. */
export const DEV_ADMIN_USER_ID = 'usr_001';

export function authCookieUrl(): string {
  const base = process.env.BASE_URL || 'http://localhost:4321';
  try {
    const url = new URL(base);
    return `${url.protocol}//${url.host}/`;
  } catch {
    return 'http://localhost:4321/';
  }
}

export async function useAdminSession(context: BrowserContext): Promise<void> {
  // Playwright exige `url` O `path` en cada cookie, nunca los dos a la vez;
  // con `url` el path se deriva del propio URL (raíz).
  const url = authCookieUrl();
  await context.addCookies([
    { name: 'session', value: ADMIN_SESSION_TOKEN, url },
    { name: 'gara_onb', value: DEV_ADMIN_USER_ID, url },
  ]);
}