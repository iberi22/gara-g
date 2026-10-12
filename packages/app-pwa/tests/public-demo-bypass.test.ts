import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
/**
 * tests/public-demo-bypass.test.ts — el modo demo no se puede activar desde fuera.
 *
 * `isPublicDemoEnabled` aceptaba `?public_demo=true` y la cabecera
 * `x-public-demo`. Con solo eso, `GET /fleet/vehicles?public_demo=true` devolvia
 * 200 sin cookie y servia las placas de los tenants (12 placas unicas
 * filtradas en produccion el 2026-10-01). El entorno ya no abre nada en
 * produccion.
 *
 * Se prueba sobre el codigo real del middleware, no sobre una copia.
 */
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');
const SRC = readFileSync(resolve(ROOT, 'src/middleware.ts'), 'utf-8');

/** Extrae el cuerpo de isPublicDemoEnabled del fuente real. */
function functionBody(): string {
  const start = SRC.indexOf('function isPublicDemoEnabled');
  expect(start, 'isPublicDemoEnabled no existe en middleware.ts').toBeGreaterThan(-1);
  const end = SRC.indexOf('export const onRequest', start);
  return SRC.slice(start, end === -1 ? undefined : end);
}

describe('el modo demo no se puede activar desde la request', () => {
  const body = functionBody();

  it('no lee public_demo de la query', () => {
    expect(body).not.toMatch(/searchParams\.get\(\s*['"]public_demo/i);
    expect(body).not.toMatch(/searchParams\.get\(\s*['"]PUBLIC_DEMO/i);
  });

  it('no lee la cabecera x-public-demo', () => {
    expect(body).not.toMatch(/x-public-demo/i);
  });

  it('cierra el modo demo cuando ENVIRONMENT es production', () => {
    // El cierre tiene que existir dentro de la propia funcion.
    expect(body).toMatch(/ENVIRONMENT/);
    expect(body).toMatch(/===\s*['"]production['"]/);
  });

  it('el guard de produccion se evalua antes de mirar PUBLIC_DEMO', () => {
    const prod = body.indexOf("== 'production'");
    const demo = body.search(/PUBLIC_DEMO/);
    expect(prod, 'no compara ENVIRONMENT con production').toBeGreaterThan(-1);
    expect(demo, 'no lee PUBLIC_DEMO').toBeGreaterThan(-1);
    expect(prod, 'el cierre por produccion debe ir antes de PUBLIC_DEMO').toBeLessThan(demo);
  });
});

describe('el guard de sesion sigue presente', () => {
  it('la allowlist PUBLICA no incluye /fleet/', () => {
    // Si PUBLIC_PATHS contuviera /fleet/, el bypass no seria el unico agujero.
    const ini = SRC.indexOf('PUBLIC_PATHS');
    expect(ini).toBeGreaterThan(-1);
    const bloque = SRC.slice(ini, SRC.indexOf(']', ini) + 1);
    expect(bloque).not.toMatch(/['"]\/fleet/);
  });
});
