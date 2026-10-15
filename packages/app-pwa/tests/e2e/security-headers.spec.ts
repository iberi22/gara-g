import { test, expect } from '@playwright/test';

/**
 * tests/e2e/security-headers.spec.ts — las cabeceras de seguridad en el despliegue real.
 *
 * La CSP con hashes la calcula src/middleware.ts (ver src/lib/securityHeaders.ts): aqui
 * se comprueba contra el servidor de verdad (dev en :4321, o BASE_URL=produccion), que
 * es lo unico que descarta un fallo que los tests unitarios no pueden ver: que Cloudflare
 * o el adaptador se coman la cabecera, o que el HTML real traiga un script inline que el
 * escaneo no haya cubierto.
 *
 * No entra en el alcance de CI (FLEET_SCOPE_SPECS de playwright.config.ts); se ejecuta a
 * mano: `pnpm exec playwright test tests/e2e/security-headers.spec.ts`.
 */
test.describe('cabeceras de seguridad', () => {
  test('la respuesta HTML lleva CSP con hashes, HSTS, nosniff y Referrer-Policy', async ({ request }) => {
    const res = await request.get('/login');
    expect(res.status()).toBe(200);

    const csp = res.headers()['content-security-policy'] ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toMatch(/script-src 'self' 'sha256-[A-Za-z0-9+/=]+'/);
    expect(csp).not.toContain('unsafe-eval');

    // La CSP es inutil si el HTML trae scripts inline que no estan hasheados: cada
    // <script> sin src del documento tiene que aparecer en la politica.
    const html = await res.text();
    for (const [, attrs, contenido] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
      if (/\bsrc\s*=/i.test(attrs) || contenido === '') continue;
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(contenido));
      const hash = `'sha256-${Buffer.from(new Uint8Array(digest)).toString('base64')}'`;
      expect(csp, `script inline sin hash en la CSP: ${contenido.slice(0, 60)}`).toContain(hash);
    }

    expect(res.headers()['strict-transport-security']).toBe('max-age=31536000; includeSubDomains; preload');
    expect(res.headers()['x-content-type-options']).toBe('nosniff');
    expect(res.headers()['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(res.headers()['x-frame-options']).toBe('DENY');
  });

  test('un asset estatico sale con las cabeceras de public/_headers', async ({ request }) => {
    const res = await request.get('/manifest.json');
    expect(res.status()).toBe(200);
    expect(res.headers()['x-content-type-options']).toBe('nosniff');
    expect(res.headers()['strict-transport-security']).toBe('max-age=31536000; includeSubDomains; preload');
    expect(res.headers()['content-security-policy']).toContain("default-src 'none'");
  });

  test('el redirect del guard de sesion no sale sin HSTS', async ({ request }) => {
    const res = await request.get('/fleet', { maxRedirects: 0 });
    expect([200, 302, 303, 307, 308]).toContain(res.status());
    expect(res.headers()['strict-transport-security']).toBe('max-age=31536000; includeSubDomains; preload');
  });
});
