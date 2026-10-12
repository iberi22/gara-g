/**
 * tests/deploy-config.test.ts — el config que sale al deploy debe ser desplegable.
 *
 * Contexto: `scripts/normalize-wrangler-config.mjs` convierte el wrangler.json que
 * emite Astro en el que se despliega. Antes sobreescribia el fichero entero con un
 * objeto literal, y el deploy resultante se llevaba por delante D1, R2 y KV, ademas
 * de dejar ENVIRONMENT sin definir — lo que reabria el fallback a admin que cerro el
 * P0. Nada de eso lo detectaban los tests: el fallo aparecia al desplegar.
 *
 * Estos tests ejecutan el script real contra NORMALIZE_OUT (un dir temporal), asi que
 * no tocan dist/ ni dejan residuos que el deploy pudiera subir como assets.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { wranglerToml } from '../../../scripts/infra-config.mjs';

const root = resolve(process.cwd(), '..', '..');
const script = resolve(root, 'packages/app-pwa/scripts/normalize-wrangler-config.mjs');

let outDir = '';
let target = '';

/** Config inicial, tal y como lo deja el adapter de Astro. */
const astroOutput = () => ({
  name: 'gara-g-app-pwa',
  main: './entry.mjs',
  compatibility_date: '2026-04-15',
  compatibility_flags: [],
  vars: {},
  kv_namespaces: [{ binding: 'SESSION' }],
  assets: { binding: 'ASSETS', directory: '../client' },
});

beforeEach(() => {
  outDir = join(tmpdir(), `gara-g-normalize-${process.pid}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(outDir, { recursive: true });
  target = join(outDir, 'wrangler.json');
  writeFileSync(target, JSON.stringify(astroOutput(), null, 2));
});

afterEach(() => {
  if (outDir && existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
});

/** Ejecuta el script contra el dir temporal. */
function run(env: Record<string, string> = {}) {
  try {
    const stdout = execFileSync('node', [script], {
      cwd: root,
      encoding: 'utf-8',
      env: {
        ...process.env,
        NORMALIZE_OUT: outDir,
        // Si el test escribe una copia, se le pasa; si no, el normalizador usa la real.
        ...(env.WRANGLER_TOML_IN ? env : { WRANGLER_TOML_IN: wranglerToml().path }),
        ...env,
      },
    });
    return { code: 0, stdout, config: JSON.parse(readFileSync(target, 'utf-8')) };
  } catch (e: any) {
    return {
      code: e.status ?? 1,
      stdout: `${e.stdout ?? ''}${e.stderr ?? ''}`,
      config: existsSync(target) ? JSON.parse(readFileSync(target, 'utf-8')) : null,
    };
  }
}

describe('normalize-wrangler-config: bindings que el runtime necesita', () => {
  it('termina con exit 0', () => {
    expect(run().code).toBe(0);
  });

  it('conserva el binding de D1 (sin el, el login no encuentra usuarios)', () => {
    const { config } = run();
    expect(config?.d1_databases).toHaveLength(1);
    expect(config?.d1_databases[0].binding).toBe('SWAL_D1');
    expect(config?.d1_databases[0].database_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('conserva el binding de R2 (sin el, los documentos no se guardan)', () => {
    const { config } = run();
    expect(config?.r2_buckets).toHaveLength(1);
    expect(config?.r2_buckets[0].binding).toBe('SWAL_R2');
  });

  it('conserva el binding de KV SESSION, y solo una vez', () => {
    const { config } = run();
    expect(config?.kv_namespaces).toHaveLength(1);
    expect(config?.kv_namespaces[0].binding).toBe('SESSION');
    expect(config?.kv_namespaces[0].id).toMatch(/^[0-9a-f]{32}$/);
  });

  it('no borra el binding de assets que emite el adapter', () => {
    expect(run().config?.assets?.binding).toBe('ASSETS');
  });
});

describe('normalize-wrangler-config: ENVIRONMENT debe quedar en production', () => {
  it('ENVIRONMENT=production — si falta, los tres guards de admin se abren', () => {
    expect(run().config?.vars?.ENVIRONMENT).toBe('production');
  });

  it('propaga XAVIER_URL para que la memoria de agentes tenga destino', () => {
    expect(run().config?.vars?.XAVIER_URL).toMatch(/^https:\/\//);
  });

  it('DOMAIN es el dominio real', () => {
    expect(run().config?.vars?.DOMAIN).toBe('gara-g.swal.network');
  });

  it('ninguna var parece una credencial', () => {
    const { config } = run();
    for (const [k, v] of Object.entries(config?.vars ?? {})) {
      expect(`${k}=${v}`).not.toMatch(/password|secret|token|api_key/i);
    }
  });
});

describe('normalize-wrangler-config: identidad y rutas', () => {
  it('despliega con el nombre real del Worker, no gara-g-app-pwa', () => {
    expect(run().config?.name).toBe('gara-g');
  });

  it('no expone workers.dev', () => {
    expect(run().config?.workers_dev).toBe(false);
  });

  it('apunta las rutas al dominio real, no a gara-g.pages.dev', () => {
    const { config } = run();
    expect(config?.routes[0].pattern).toBe('https://gara-g.swal.network/*');
    expect(config?.routes[0].zone_name).toBe('swal.network');
  });

  it('respeta PUBLIC_SITE_URL si viene definido', () => {
    expect(run({ PUBLIC_SITE_URL: 'https://otro.example.com' }).config?.routes[0].pattern).toBe(
      'https://otro.example.com/*',
    );
  });

  it('mantiene nodejs_compat', () => {
    expect(run().config?.compatibility_flags).toContain('nodejs_compat');
  });
});

describe('normalize-wrangler-config: el deploy se aborta si el config no es seguro', () => {
  it('sin D1 no escribe nada y sale con error', () => {
    // Copia temporal: mutar el wrangler.toml real es una carrera. Vitest corre
    // este archivo en paralelo con production-config.test.ts, que lo lee al
    // importarse, y podia capturar el fichero a medio escribir.
    const original = readFileSync(wranglerToml().path, 'utf-8');
    const toml = join(outDir, 'wrangler.toml');
    writeFileSync(toml, original.replace(/\[\[d1_databases\]\][\s\S]*?(?=\n\[|$)/, ''));
    const { code, stdout, config } = run({ WRANGLER_TOML_IN: toml });
    expect(code).not.toBe(0);
    expect(stdout).toContain('SWAL_D1');
    // El config del adapter se queda intacto: no se publica a medias.
    expect(config?.d1_databases).toBeUndefined();
  });

  it('con ENVIRONMENT equivocado aborta en vez de publicar', () => {
    const original = readFileSync(wranglerToml().path, 'utf-8');
    const toml = join(outDir, 'wrangler.toml');
    writeFileSync(
      toml,
      original.replace(/^ENVIRONMENT\s*=\s*"production"/m, 'ENVIRONMENT = "development"'),
    );
    const { code, stdout } = run({ WRANGLER_TOML_IN: toml });
    expect(code).not.toBe(0);
    expect(stdout).toContain('ENVIRONMENT');
  });

  it('imprime un resumen legible de lo que va a desplegarse', () => {
    const { stdout } = run();
    expect(stdout).toContain('[normalize-wrangler] bindings:');
    expect(stdout).toContain('D1=');
    expect(stdout).toContain('R2=');
    expect(stdout).toContain('ENVIRONMENT=production');
  });
});

describe('normalize-wrangler-config: limitadores del respaldo cifrado', () => {
  const NAMES = ['SYNC_RATE_LIMITER', 'SYNC_CREATE_LIMITER', 'SYNC_UPDATE_LIMITER', 'MESH_ICE_LIMITER'];

  it('declara los cuatro bindings ratelimits con namespace entero y periodo 10 o 60', () => {
    const { config } = run();
    expect(config?.ratelimits.map((r: any) => r.name).sort()).toEqual([...NAMES].sort());
    for (const r of config.ratelimits) {
      expect(r.namespace_id).toMatch(/^[1-9][0-9]*$/);
      expect([10, 60]).toContain(r.simple.period);
      expect(r.simple.limit).toBeGreaterThan(0);
    }
    const ids = config.ratelimits.map((r: any) => r.namespace_id);
    expect(new Set(ids).size).toBe(ids.length); // namespaces distintos: no comparten contador
    expect(config.ratelimits.find((r: any) => r.name === 'SYNC_CREATE_LIMITER').simple.limit).toBeLessThanOrEqual(5);
  });

  it('declara MESH_ICE_LIMITER (credenciales TURN) y recuerda los secretos opcionales sin fallar', () => {
    const { config, stdout } = run();
    const ice = config.ratelimits.find((r: any) => r.name === 'MESH_ICE_LIMITER');
    expect(ice.simple).toEqual({ limit: 10, period: 60 });
    expect(stdout).toContain('TURN_KEY_ID');
    expect(stdout).toContain('TURN_KEY_API_TOKEN');
  });

  it('rehace los limitadores aunque el adapter emita unos distintos con el mismo nombre', () => {
    writeFileSync(target, JSON.stringify({ ...astroOutput(), ratelimits: [{ name: 'SYNC_CREATE_LIMITER', namespace_id: '1', simple: { limit: 9999, period: 60 } }] }));
    const create = run().config?.ratelimits.filter((r: any) => r.name === 'SYNC_CREATE_LIMITER');
    expect(create).toHaveLength(1);
    expect(create[0].simple.limit).toBeLessThanOrEqual(5);
  });

  it('un build de produccion SIN limitadores se niega (exit 1, bundle no escrito)', () => {
    // Copia mutada del script, en su mismo dir (resuelve rutas por __dirname), sin la lista de limitadores.
    const mutated = resolve(root, 'packages/app-pwa/scripts/.tmp-normalize-sin-limitadores.mjs');
    const src = readFileSync(script, 'utf-8');
    expect(src).toContain('  ...SYNC_RATE_LIMITS,\n];');
    writeFileSync(mutated, src.replace('  ...SYNC_RATE_LIMITS,\n];', '];'));
    try {
      let code = 0;
      let out = '';
      try {
        execFileSync('node', [mutated], {
          cwd: root, encoding: 'utf-8', stdio: 'pipe',
          env: { ...process.env, NORMALIZE_OUT: outDir, WRANGLER_TOML_IN: wranglerToml().path },
        });
      } catch (e: any) {
        code = e.status ?? 1;
        out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
      }
      expect(code).toBe(1);
      expect(out).toContain('DEPLOY NO SEGURO');
      expect(out).toContain('SYNC_CREATE_LIMITER');
      expect(JSON.parse(readFileSync(target, 'utf-8')).name).toBe('gara-g-app-pwa'); // no se sobrescribio
    } finally {
      rmSync(mutated, { force: true });
    }
  });
});
