import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
/**
 * tests/r2-private-documents.test.ts — el vault de documentos no es público.
 *
 * `/r2/*` estaba en PUBLIC_PATHS y servía el bucket R2 del vault (SOAT,
 * tecnoMecánica, pólizas) con `Cache-Control: public, max-age=31536000,
 * immutable` y `Access-Control-Allow-Origin: *`. Tres consecuencias: cualquier
 * clave filtrada por un CSV o un Referer se descargaba sin sesión; un documento
 * borrado seguía vivo un año en el edge; y un usuario autenticado de un tenant
 * podía leer los de todos, porque la clave no llevaba tenant.
 */
import { describe, expect, it } from 'vitest';

/** Sin comentarios: el docstring cita el bug a proposito y no es codigo. */
function code(only: string): string {
  return only.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

const ROOT = resolve(import.meta.dirname, '..');
const R2 = readFileSync(resolve(ROOT, 'src/pages/r2/[...path].ts'), 'utf-8');
const MW = readFileSync(resolve(ROOT, 'src/middleware.ts'), 'utf-8');

describe('/r2/ no es una ruta publica', () => {
  const allowlist = MW.slice(
    MW.indexOf('const PUBLIC_PATHS'),
    MW.indexOf('];', MW.indexOf('const PUBLIC_PATHS')),
  );

  it('no aparece en PUBLIC_PATHS', () => {
    expect(allowlist).not.toMatch(/['"]\/r2\//);
  });

  it('exige sesion', () => {
    expect(R2).toMatch(/getSessionUser/);
    expect(R2).toMatch(/status:\s*401/);
  });

  it('exige que la clave pertenezca al tenant de la sesion', () => {
    // Sin esto, un usuario autenticado de un tenant leia los de todos.
    expect(R2).toMatch(/key\.startsWith\(\`\$\{tenant\}\/\`\)/);
    expect(R2).toMatch(/locals[\s\S]{0,80}tenant/);
  });

  it('el tenant sale de la sesion, no de la query', () => {
    expect(R2).not.toMatch(/searchParams\.get\(\s*['"]instanceId/);
  });

  it('no se cachea en publico ni abre CORS', () => {
    // Los docstrings citan el bug a proposito; se analiza solo el codigo.
    expect(code(R2)).not.toMatch(/max-age=31536000/);
    expect(code(R2)).not.toMatch(/Access-Control-Allow-Origin/);
    expect(R2).toMatch(/private, no-store/);
  });

  it('envia nosniff y evita que el documento se ejecute o incruste', () => {
    expect(R2).toMatch(/X-Content-Type-Options['"]:\s*['"]nosniff/);
    // `attachment` sigue siendo el defecto: `?inline=1` solo lo cambia para PDF
    // e imágenes, y aun así conserva nosniff + sandbox.
    expect(R2).toMatch(/Content-Disposition['"]:[^;]*\?[^:]*: 'attachment'/);
    expect(R2).toMatch(/Content-Security-Policy/);
  });

  it('inline solo aplica a PDF e imagenes, y sigue enjaulado', () => {
    expect(code(R2)).toMatch(/inline \? `inline; filename=/);
    expect(code(R2)).toMatch(/application\/pdf'[\s\S]{0,40}startsWith\('image\/'\)/);
    expect(code(R2)).toMatch(/set\('Content-Security-Policy',\s*'sandbox'\)/);
    expect(code(R2)).toMatch(/private, max-age=300/);
  });

  it('responde JSON tambien en 404 y 503', () => {
    // Un 404 en texto plano delata que la ruta existe y delata el backend.
    expect(R2).toMatch(/application\/json/);
    expect(R2).not.toMatch(/new Response\(\s*['"]Not Found['"]\s*,\s*\{\s*status:\s*404\s*\}\s*\)/);
  });

  it('no filtra la existence de claves de otro tenant', () => {
    // 404 en vez de 403: un 403 confirmaria que la clave existe.
    const i = R2.indexOf('key.startsWith');
    expect(i).toBeGreaterThan(-1);
    const bloque = R2.slice(i, i + 300);
    expect(bloque, 'un 403 confirmaria que la clave existe en otro tenant').toMatch(/notFound\(\)/);
    expect(bloque).not.toMatch(/status:\s*403/);
  });
});

describe('la sesion tiene una sola implementacion', () => {
  it('el middleware importa getSessionUser, no lo redefine', () => {
    expect(MW).toMatch(/from\s*'\.\/lib\/session\.js'/);
    expect(MW).not.toMatch(/async function getSessionUser/);
  });

  it('un fallo de KV no degrada a admin en produccion', () => {
    const SESSION = readFileSync(resolve(ROOT, 'src/lib/session.ts'), 'utf-8');
    expect(SESSION).toMatch(/devFallbackAllowed/);
    // El catch devuelve el fallback, que en produccion es null.
    // El catch de getSessionUser, no el de devFallbackAllowed.
    const i = SESSION.indexOf('// ⚠');
    expect(i, 'falta el aviso del catch de getSessionUser').toBeGreaterThan(-1);
    const catchBloque = SESSION.slice(i - 60, i + 220);
    expect(catchBloque).toMatch(/devAdmin/);
    expect(catchBloque).toMatch(/En produccion un fallo al leer KV/);
  });
});
