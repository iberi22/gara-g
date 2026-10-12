import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
/**
 * tests/login-no-self-fetch.test.ts — el login no se llama a si mismo.
 *
 * `pages/login.astro` hacia `fetch(`${Astro.url.origin}/api/auth/login`)`: el
 * Worker se llamaba por su dominio publico y Cloudflare cortaba la subpeticion
 * con 522, que la pagina traducía a `Credenciales invalidas (522)`. El login por
 * formulario no funcionaba para nadie en produccion y el mensaje senalaba a la
 * contrasena.
 *
 * Ademas cubre la redireccion abierta: un `redirect` de la query a un dominio
 * externo convertia un login legitimo en phishing.
 */
import { describe, expect, it } from 'vitest';

/** Sin comentarios: los docstrings citan el bug a proposito y no son codigo. */
function code(only: string): string {
  return only.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

const ROOT = resolve(import.meta.dirname, '..');
const PAGE = readFileSync(resolve(ROOT, 'src/pages/login.astro'), 'utf-8');
const SHARED = readFileSync(resolve(ROOT, 'src/lib/authenticate.ts'), 'utf-8');
const ENDPOINT = readFileSync(resolve(ROOT, 'src/pages/api/auth/login.ts'), 'utf-8');

describe('la pagina de login no hace fetch a su propio dominio', () => {
  it('no hace fetch contra Astro.url.origin', () => {
    expect(PAGE).not.toMatch(/fetch\(\s*`?\$\{\s*Astro\.url\.origin/);
    expect(PAGE).not.toMatch(/fetch\(\s*['"]https?:\/\/gara-g\.swal\.network/);
  });

  it('no llama al endpoint de auth por HTTP', () => {
    // La ruta /api/auth/login no debe aparecer como destino de peticion.
    // Los docstrings la citan a proposito, asi que se ignoran los comentarios.
    expect(code(PAGE)).not.toMatch(/fetch[\s\S]{0,120}\/api\/auth\/login/);
  });

  it('usa la funcion compartida authenticate()', () => {
    expect(PAGE).toMatch(/import\s*{[^}]*authenticate[^}]*}\s*from\s*'[^']*authenticate'/);
    expect(PAGE).toMatch(/await\s+authenticate\(/);
  });

  it('el modulo compartido existe y no hace fetch', () => {
    expect(SHARED).toMatch(/export\s+async\s+function\s+authenticate/);
    expect(code(SHARED)).not.toMatch(/fetch\(/);
  });

  it('el endpoint delega en la misma funcion', () => {
    // Una sola implementacion: si divergen, el login deja de funcionar otra vez.
    expect(ENDPOINT).toMatch(/await\s+authenticate\(/);
  });
});

describe('la redireccion post-login no se puede usar para phishing', () => {
  it('rechaza destinos que no son rutas internas', () => {
    expect(PAGE).toMatch(/startsWith\('\/'\)/);
    expect(PAGE).toMatch(/startsWith\('\/\/'\)/);
  });

  it('no pasa el parametro redirect crudo a Astro.redirect', () => {
    // El valor saneado es el que se redirige, no el crudo de la query.
    expect(PAGE).not.toMatch(/Astro\.redirect\(\s*redirectTo\s*=\s*Astro\.url|raw\s*,\s*303/);
    expect(PAGE).toMatch(/Astro\.redirect\(redirectTo,\s*303\)/);
  });
});

describe('el login falla cerrado en todos los entornos', () => {
  it('no queda ninguna lista de usuarios demo ni su guarda de entorno', () => {
    // Antes habia un fallback a usuarios demo apagado solo con ENVIRONMENT=production:
    // un deploy sin esa var reabria un admin con contrasena conocida. Ya no existe.
    expect(code(SHARED)).not.toMatch(/DEMO_USERS/);
    expect(code(SHARED)).not.toMatch(/demoFallbackAllowed/);
    expect(code(ENDPOINT)).not.toMatch(/DEMO_USERS/);
    expect(code(ENDPOINT)).not.toMatch(/demoFallbackAllowed/);
  });
});
