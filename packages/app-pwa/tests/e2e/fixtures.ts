/**
 * fixtures.ts — Fixture e2e global de GARA-G (#940 console-guard + auth).
 *
 * Uso: `import { test, expect } from './fixtures';` en lugar de
 * `from '@playwright/test'`. El fixture:
 *  1. pone la cookie de sesión admin (el middleware exige auth en /fleet*),
 *  2. escucha console.error + pageerror y FALLA el test al final si hubo
 *     errores no allowlisteados (con el mensaje que los delata).
 *
 * ALLOWLIST: solo ruido de terceros, cada entrada con motivo. Un error NUEVO
 * nunca se allowlista: se corrige el bug real (cada fix en su archivo).
 */
import { test as base, expect, type Page, type BrowserContext } from '@playwright/test';
import { useAdminSession } from './helpers/auth';

interface AllowEntry {
  pattern: RegExp;
  reason: string;
}

const ALLOWLIST: AllowEntry[] = [
  {
    // Leaflet carga tiles de OSM: 404s de tiles puntuales no rompen el mapa.
    pattern: /tile\.openstreetmap\.org|leaflet.*tile/i,
    reason: 'Tiles OSM puntuales (red externa, no app)',
  },
  {
    // Warnings de Svelte HMR/dev que vite emite como error en consola.
    pattern: /\[HMR\].*svelte/i,
    reason: 'Ruido HMR de @vitejs/plugin-svelte en dev',
  },
  {
    // El service worker / fetch offline generan este error esperado en tests
    // que ponen el contexto offline a propósito (pwa-installable, offline-queue).
    pattern: /net::ERR_INTERNET_DISCONNECTED/i,
    reason: 'Offline esperado en tests con context.setOffline(true)',
  },
  {
    // Chrome loguea esto aunque el register tenga .catch: race entre el
    // registro del SW (on window load) y context.setOffline(true) en tests.
    // El SW funciona (ver pwa-installable); el mensaje es ruido del race.
    pattern: /An unknown error occurred when fetching the script/i,
    reason: 'Race SW-register vs setOffline en tests offline',
  },
];

export const test = base.extend({
  page: async ({ page, context }, use) => {
    await useAdminSession(context);
    const errors: string[] = [];
    const isAllowed = (text: string): boolean => ALLOWLIST.some((a) => a.pattern.test(text));
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (!isAllowed(text)) errors.push(`console.error: ${text.slice(0, 300)}`);
      }
    });
    page.on('pageerror', (err) => {
      const text = String(err?.message ?? err).slice(0, 300);
      if (!isAllowed(text)) errors.push(`pageerror: ${text}`);
    });
    page.on('response', (res) => {
      const status = res.status();
      if (status === 404 || status === 401 || status >= 500) {
        const text = `${status} ${res.url().slice(0, 160)}`;
        if (!isAllowed(text)) errors.push(`http-${status}: ${res.url().slice(0, 160)}`);
      }
    });
    await use(page);
    expect(
      errors,
      `console.errors/pageerrors no allowlisteados (#940):\n${errors.join('\n')}`
    ).toEqual([]);
  },
});

export { expect };
export { ALLOWLIST };
export type { Page, BrowserContext, Response, Request } from '@playwright/test';
