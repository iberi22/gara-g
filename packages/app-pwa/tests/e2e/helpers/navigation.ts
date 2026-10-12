import type { Page, Response } from '@playwright/test';

/**
 * fixtures/navigation.ts — Navegación resiliente a flakes del dev-server.
 *
 * Contexto: el dev SSR de Astro sobre workerd (vite module runner) pierde
 * INTERMITENTEMENTE módulos del route-cache bajo carga
 * ("Unexpectedly unable to find a component instance for route X",
 * "Unable to resolve [...?astro&type=script...]"), devolviendo 500s
 * esporádicos que NO son bugs de la app (ver #952, #938).
 *
 * gotoStable() reintenta UNA vez solo ante fallo de transporte/servidor
 * (sin respuesta, 5xx, ERR_HTTP_RESPONSE_CODE_FAILURE) y avisa por consola.
 * Las assertions de los specs corren igual contra la página final: un 500
 * REAL (falla 2/2) sigue fallando el test. Revisar los warnings
 * "GOTO-RETRY" en los logs: si aparecen de forma sistemática, hay una
 * regresión real, no un flake.
 */
export async function gotoStable(
  page: Page,
  url: string,
  options: { waitUntil?: 'domcontentloaded' | 'load' | 'networkidle' } = {}
): Promise<Response | null> {
  const waitUntil = options.waitUntil ?? 'domcontentloaded';
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const response = await page.goto(url, { waitUntil });
      const status = response?.status() ?? 0;
      if (status >= 500) {
        lastError = new Error(`HTTP ${status} en ${url} (intento ${attempt})`);
        // eslint-disable-next-line no-console
        console.warn(`[GOTO-RETRY] ${url} → ${status}, reintentando (intento ${attempt}/2)`);
        continue;
      }
      if (attempt === 2) {
        // eslint-disable-next-line no-console
        console.warn(`[GOTO-RETRY] ${url} OK en reintento`);
      }
      return response;
    } catch (err) {
      lastError = err;
      // eslint-disable-next-line no-console
      console.warn(`[GOTO-RETRY] ${url} fallo transporte (${attempt}/2): ${(err as Error).message?.slice(0, 120)}`);
    }
  }
  throw lastError;
}
