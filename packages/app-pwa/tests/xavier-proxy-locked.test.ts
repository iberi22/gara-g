import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
/**
 * tests/xavier-proxy-locked.test.ts — el proxy a Xavier no es unConducto abierto.
 *
 * `/api/xavier/search` y `/api/xavier/add` reenviaban el cuerpo del cliente tal
 * cual a Xavier, usando el `XAVIER_API_KEY` del servidor, y sin mirar la sesión:
 *
 *   · search — cualquier autenticado leía toda la memoria del ecosistema, que
 *     no está filtrada por proyecto ni por tenant.
 *   · add — podía escribir memorias que después leerían otros agentes: inyección
 *     de prompts persistente.
 */
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');
const DIR = resolve(ROOT, 'src/pages/api/xavier');
const PROXY = readFileSync(resolve(DIR, '_proxy.ts'), 'utf-8');
const SEARCH = readFileSync(resolve(DIR, 'search.ts'), 'utf-8');
const ADD = readFileSync(resolve(DIR, 'add.ts'), 'utf-8');

describe('los endpoints de Xavier exigen sesión', () => {
  for (const [nombre, src] of [
    ['search', SEARCH],
    ['add', ADD],
  ] as const) {
    it(`${nombre} llama a requireSession`, () => {
      expect(src).toMatch(/requireSession\(cookies\)/);
    });

    it(`${nombre} propaga el 401 de requireSession`, () => {
      expect(src).toMatch(/if \(\s*user\s+instanceof Response\s*\)\s*return user/);
    });

    it(`${nombre} no reenvía el cuerpo del cliente en crudo`, () => {
      // `readBody(request)` sí se usa, pero para parsear: lo que sale hacia
      // Xavier tiene que ser un cuerpo construido aquí.
      expect(src).not.toMatch(/callXavier\([^)]*body:\s*raw\b/);
      expect(src).not.toMatch(/callXavier\([^)]*body:\s*body\s*\)/);
    });

    it(`${nombre} fija el namespace del servidor`, () => {
      expect(src).toMatch(/project:\s*'gara-g'/);
      // El project del cliente no puede viajar a Xavier.
      expect(src).not.toMatch(/project:\s*parsed\.project/);
    });
  }
});

describe('escribir en la memoria global exige admin', () => {
  it('add exige rol admin', () => {
    expect(ADD).toMatch(/requireAdmin\(user\)/);
    expect(ADD).toMatch(/if \(denied\)\s*return denied/);
  });

  it('requireAdmin normaliza el rol y solo admite admin', () => {
    expect(PROXY).toMatch(/normalizeRole\(user\.role\)/);
    expect(PROXY).toMatch(/role\s*!==\s*'admin'/);
    expect(PROXY).toMatch(/Requiere rol admin['"][\s\S]{0,40}?403/);
  });

  it('search no necesita admin: leer con sesión es legtimo', () => {
    expect(SEARCH).not.toMatch(/requireAdmin/);
  });
});

describe('el proxy no filtra detalles internos', () => {
  it('no devuelve detail con el error de fetch', () => {
    // `detail` con err.messagefiltraba el host de Xavier y el error de DNS.
    expect(PROXY).not.toMatch(/detail:\s*err/);
    expect(PROXY).toMatch(/console\.error\('\[xavier\] upstream error'/);
  });

  it('no propaga exceptions al cliente', () => {
    expect(PROXY).toMatch(/catch[\s\S]{0,200}status:\s*502/);
  });
});

describe('la superficie de escritura está acotada', () => {
  it('add limita el tamaño del texto', () => {
    expect(ADD).toMatch(/const MAX_CONTENT_CHARS = \d/);
    expect(ADD).toMatch(/text\.length\s*>\s*MAX_CONTENT_CHARS/);
    expect(ADD).toMatch(/excede el limite['"][\s\S]{0,40}?413/);
  });

  it('search limita el número de resultados', () => {
    expect(SEARCH).toMatch(/Math\.min\(\s*Math\.max\(1,\s*Math\.trunc\([^)]*\)\),\s*50\s*\)/);
  });

  it('add registra quien escribe', () => {
    expect(ADD).toMatch(/source:\s*`gara-g:\$\{user\.email\}`/);
  });

  it('el cliente no elige el path de Xavier', () => {
    // El path es literal en el código, nunca interpolado desde la request.
    expect(ADD).toMatch(/callXavier\(\s*'\/v1\/memories'/);
    expect(SEARCH).toMatch(/callXavier\(\s*'\/v1\/memories\/search'/);
    expect(PROXY).not.toMatch(/path:\s*\$\{/);
  });
});
