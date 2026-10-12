import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * tests/deploy-bundle-safety.test.ts — el bundle de deploy sale del build correcto.
 *
 * Contexto: `pnpm run build` es `scripts/build-workers.js`, que envuelve a
 * `astro build`. Astro regenera dist/server/wrangler.json desde cero y lo deja
 * sin D1, sin R2, sin ENVIRONMENT y con name=gara-g-app-pwa.
 *
 * Ese fichero es exactamente lo que lee `wrangler deploy`. Desplegarlo asi
 * publica una app sin base de datos y con los tres guards de admin abiertos,
 * que es el backdoor que cerr6 el P0 de seguridad.
 *
 * El script normalize-wrangler-config.mjs sabe arreglarlo y aborta con exit 1
 * si el bundle sale incompleto, pero no lo llamaba nadie: se ejecutaba a mano,
 * y siempre DESPUES del build, en el orden correcto. Si alguien corria
 * `build` y luego `deploy` a pelo, el bundle roto era el que se desplegaba, y
 * el build daba exit 0.
 *
 * Estos tests leen el bundle que deja el build. No simulan nada.
 *
 * Este fichero NO entra en el `vitest run` por defecto de la PWA (el script
 * `test` de packages/app-pwa lo excluye con `--exclude`): sin build no hay
 * bundle y la suite unitaria no depende del estado de dist/. Se invoca a
 * proposito, DESPUES de `pnpm --filter gara-g-app-pwa build`
 * (ver .github/workflows/ci.yml y .github/workflows/ci-swal-gara.yml). Y si se
 * invoca sin build, FALLA: un gate que se salta no es un gate.
 *
 * El orden del build (normalizador despues de astro) vive en
 * tests/deploy-build-order.test.ts, que si corre en la suite unitaria.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { wranglerToml } from '../../../scripts/infra-config.mjs';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const BUNDLE = resolve(ROOT, 'dist/server/wrangler.json');
const WRANGLER_TOML = wranglerToml().path;
/** La fecha declarada es la fuente de verdad; el bundle debe heredarla. */
const TOML_COMPATIBILITY_DATE =
  readFileSync(WRANGLER_TOML, 'utf-8').match(/^\s*compatibility_date\s*=\s*"([^"]+)"/m)?.[1] ?? '';

interface Bundle {
  name?: string;
  main?: string;
  d1_databases?: Array<{ binding?: string; database_name?: string; database_id?: string }>;
  r2_buckets?: Array<{ binding?: string; bucket_name?: string }>;
  kv_namespaces?: Array<{ binding?: string; id?: string }>;
  ratelimits?: Array<{ name?: string; namespace_id?: string; simple?: { limit?: number; period?: number } }>;
  vars?: Record<string, string>;
  routes?: Array<{ pattern?: string }>;
  assets?: { directory?: string };
  compatibility_date?: string;
}

let bundle: Bundle;

beforeAll(() => {
  // Sin `skipIf` a proposito. Este fichero audita el bundle que deja el build:
  // si se invoca y no hay bundle, el fallo tiene que verse.
  if (!existsSync(BUNDLE)) {
    throw new Error(
      'dist/server/wrangler.json no existe: este fichero audita el bundle de deploy. ' +
        'Corre `pnpm --filter gara-g-app-pwa build` antes de invocarlo.',
    );
  }
  bundle = JSON.parse(readFileSync(BUNDLE, 'utf-8'));
});

describe('bundle de deploy: lo que deja el build', () => {
  it('existe (lo deja el build; sin build esta suite falla, no se salta)', () => {
    expect(
      existsSync(BUNDLE),
      'dist/server/wrangler.json no existe: corre `pnpm --filter gara-g-app-pwa build`',
    ).toBe(true);
  });

  it('lleva la base de datos D1', () => {
    expect(
      bundle.d1_databases ?? [],
      'sin d1_databases: el login no encuentra entity',
    ).not.toHaveLength(0);
  });

  it('lleva el bucket R2', () => {
    expect(
      bundle.r2_buckets ?? [],
      'sin r2_buckets: los documentos no se guardan',
    ).not.toHaveLength(0);
  });

  it('lleva el binding de Workers AI (asistente del expediente)', () => {
    expect((bundle as { ai?: { binding?: string } }).ai?.binding, 'sin ai.binding: el asistente responde 503').toBe('AI');
  });

  it('lleva el namespace KV de sesiones', () => {
    const kv = bundle.kv_namespaces ?? [];
    expect(kv.length, 'sin kv_namespaces: no hay sesiones').toBeGreaterThan(0);
    expect(
      kv.some((k) => k.binding === 'SESSION'),
      'ningun namespace con binding SESSION',
    ).toBe(true);
  });

  it('lleva los limitadores del respaldo cifrado (sin ellos R2 queda abierto al abuso) y el de credenciales TURN', () => {
    const names = (bundle.ratelimits ?? []).map((r) => r.name).sort();
    expect(names).toEqual(['MESH_ICE_LIMITER', 'SYNC_CREATE_LIMITER', 'SYNC_RATE_LIMITER', 'SYNC_UPDATE_LIMITER']);
  });

  it('ENVIRONMENT es exactamente production', () => {
    // Cualquier otro valor reabre los tres fallbacks de admin.
    expect(bundle.vars?.ENVIRONMENT).toBe('production');
  });

  it('es el worker gara-g, no gara-g-app-pwa', () => {
    expect(bundle.name).toBe('gara-g');
  });

  it('los bindings traen identificador, no solo el nombre', () => {
    for (const d of bundle.d1_databases ?? []) {
      expect(d.database_id, `D1 ${d.binding} sin database_id`).toBeTruthy();
    }
    for (const k of bundle.kv_namespaces ?? []) {
      expect(k.id, `KV ${k.binding} sin id`).toBeTruthy();
    }
  });

  it('sirve los assets desde dist/client, no dist', () => {
    // Astro 5 separa estaticos (client) y servidor (server).
    expect(bundle.assets?.directory).toMatch(/client/);
  });

  it('la compatibility_date no es la fecha del día', () => {
    // El normalizador usaba `new Date()` para esta fecha, así que el bundle se
    // movía solo con el calendario. El 2026-10-01 estampó 2026-10-01 y el
    // workerd local, que solo soporta hasta 2026-08-06, se negaba a arrancar:
    //
    //   This Worker requires compatibility date "2026-10-01", but the newest
    //   date supported by this server binary is "2026-08-06"
    //
    // Con exit 0 en el build y la suite en verde, porque el fallo es de arranque.
    // La fecha se hereda de wrangler.toml, que es la fuente de verdad.
    const hoy = new Date().toISOString().slice(0, 10);
    const declared = bundle.compatibility_date ?? '';
    expect(declared, 'el bundle no declara compatibility_date').toBeTruthy();
    expect(declared, `estampa la fecha del día (${hoy}) en vez de heredar la declarada`).not.toBe(
      hoy,
    );
    expect(declared).toBe(TOML_COMPATIBILITY_DATE);
  });
});
