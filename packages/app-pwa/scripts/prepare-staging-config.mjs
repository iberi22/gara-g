#!/usr/bin/env node
// prepare-staging-config.mjs — Genera el bundle de deploy del STAGE.
//
// Por qué genera en vez de declarar un wrangler.staging.toml versionado: el bundle
// normalizado (dist/server/wrangler.json) lleva D1, R2, KV, AI, ratelimits y assets.
// Declarar esas mismas claves otra vez en un toml versionado sería una segunda fuente
// de verdad que se desincroniza en el primer commit que toque un binding — y el fallo
// es silencioso: el stage arranca sin base de datos. Aquí solo se COPIA y se cambian
// identidad y rutas, así que la lista de bindings tiene un único origen: el build.
//
// Qué cambia respecto al bundle de producción, y por qué (los dos comentarios largos
// están en src/lib/staging.ts y en el header de este repo's deploy memory):
//
//   name: gara-g -> gara-g-staging
//     Worker DISTINTO. Barrera principal: aunque el resto de la config se malgastara,
//     este deploy nunca toca el Worker `gara-g` de producción.
//
//   routes: se borran
//     El bundle de producción va con routes a gara-g.swal.network/*. Dejarlas en el
//     stage significaría ADOPTAR ese dominio custom y sacarle el tráfico a los
//     usuarios reales. Sin `routes` + `workers_dev=false`, wrangler publica el Worker
//     en su propio subdominio y es Pages quien le entrega el tráfico en
//     gara-g.pages.dev.
//
//   ENVIRONMENT: NO se toca (sigue siendo 'production')
//     ENVIRONMENT es el interruptor de los fallbacks de admin (src/lib/session.ts) y el
//     que hace que el tenant se lea de la sesión en vez de `?instanceId=` del cliente
//     (src/lib/fleetApi.ts). Ponerlo a 'staging' reabriría el backdoor de admin y una
//     escritura libre sobre otros tenants, contra una D1 compartida con producción.
//     Para "qué URL es esta" está DEPLOY_TARGET.
//
//   DEPLOY_TARGET: staging
//     Lo único que enciende el banner, el prefijo [STAGING] en el <title> y el tenant
//     `gara-staging`.
//
// D1: base propia del stage, `gara-staging` (config/staging-resources.json). R2 y KV siguen
// siendo sentinels hasta que existan sus recursos de staging. El stage NO debe ver ningun
// id de producción (applyStagingIsolation lo comprueba); el tenant sigue siendo gara-staging.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stagingIds } from '../../../scripts/infra-config.mjs';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function applyStagingIsolation(cfg, pIds, sIds) {
  if (sIds.d1_database_id === pIds.d1) throw new Error('D1 database_id equals production id');
  if (sIds.r2_bucket_name === pIds.r2) throw new Error('R2 bucket_name equals production id');
  if (sIds.kv.SESSION === pIds.kvSession) throw new Error('KV SESSION equals production id');
  if (sIds.kv.SWAL_KV === pIds.kvSwal) throw new Error('KV SWAL_KV equals production id');
  // Cruzado: ningun recurso del stage puede ser NINGUN id de produccion (p. ej. el id de la
  // D1 de produccion pegado en el campo de KV por error).
  const prod = new Set(Object.values(pIds).filter(Boolean));
  for (const [what, v] of [['D1', sIds.d1_database_id], ['R2', sIds.r2_bucket_name], ['KV SESSION', sIds.kv.SESSION], ['KV SWAL_KV', sIds.kv.SWAL_KV]]) {
    if (prod.has(v)) throw new Error(`${what} reuses a production resource id`);
  }
  // La D1 del stage es una base real: un uuid. Un sentinel aqui publicaria un stage sin base.
  if (!UUID.test(String(sIds.d1_database_id ?? ''))) throw new Error('D1 database_id is not a D1 uuid');
  if (cfg.d1_databases?.[0]) {
    cfg.d1_databases[0].database_id = sIds.d1_database_id;
    if (sIds.d1_database_name) cfg.d1_databases[0].database_name = sIds.d1_database_name;
  }
  if (cfg.r2_buckets?.[0]) cfg.r2_buckets[0].bucket_name = sIds.r2_bucket_name;
  cfg.kv_namespaces?.forEach(k => { if (k.binding === 'SESSION') k.id = sIds.kv.SESSION; if (k.binding === 'SWAL_KV') k.id = sIds.kv.SWAL_KV; });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const distServer = join(__dirname, '..', 'dist', 'server');
  const src = join(distServer, 'wrangler.json');
  const out = join(distServer, 'wrangler.staging.json');
  if (!existsSync(src)) {
    console.error(`[staging] FATAL: no existe ${src}. Corre \`pnpm build:canon\` primero.`);
    process.exit(1);
  }
  const cfg = JSON.parse(readFileSync(src, 'utf-8'));
  // Identidad: un Worker aparte. Nunca `gara-g`.
  if (cfg.name === 'gara-g') {
    cfg.name = 'gara-g-staging';
    console.log('[staging] name: gara-g -> gara-g-staging');
  }
  // Pages hace de front door; las routes del bundle apuntan al dominio de PRODUCCIÓN.
  if (cfg.routes?.length) {
    console.log(`[staging] rutas eliminadas (adoptarian ${cfg.routes[0].pattern}): ${cfg.routes.map((r) => r.pattern).join(', ')}`);
    cfg.routes = [];
  }
  delete cfg.zone_name;
  // La marca que enciende el banner y el tenant de pruebas.
  cfg.vars = { ...(cfg.vars ?? {}), DEPLOY_TARGET: 'staging' };
  // Guardas. Son las mismas que el normalizador pone en producción, y por el mismo motivo:
  // cada una tapa un fallo silencioso (sin D1 no hay login, sin ENVIRONMENT se reabre el
  // backdoor de admin) que se descubre cuando ya se ha desplegado.
  const problems = [];
  if (cfg.name === 'gara-g') problems.push('el nombre sigue siendo gara-g: el deploy pisaria PRODUCCIÓN');
  if (cfg.vars.DEPLOY_TARGET !== 'staging') problems.push('DEPLOY_TARGET no es staging');
  if (cfg.vars.ENVIRONMENT !== 'production')
    problems.push(`ENVIRONMENT=${cfg.vars.ENVIRONMENT}: reabre los fallbacks de admin y el tenant del cliente`);
  if (cfg.routes?.length) problems.push('todavia hay routes: adoptarian el dominio de produccion');
  if (!cfg.d1_databases?.length) problems.push('sin D1: el stage no tendria base de datos');
  if (!cfg.r2_buckets?.length) problems.push('sin R2');
  if (!cfg.kv_namespaces?.length) problems.push('sin KV SESSION');
  // config/staging-resources.json (gitignored, lo copia el deploy) -> private/infra -> plantilla.
  const sIds = stagingIds();
  const pIds = { d1: cfg.d1_databases?.[0]?.database_id, r2: cfg.r2_buckets?.[0]?.bucket_name, kvSession: cfg.kv_namespaces?.find(k => k.binding === 'SESSION')?.id, kvSwal: cfg.kv_namespaces?.find(k => k.binding === 'SWAL_KV')?.id };
  try { applyStagingIsolation(cfg, pIds, sIds); } catch(e) { problems.push(e.message); }
  if (problems.length) {
    console.error(`[staging] STAGE NO SEGURO:\n  - ${problems.join('\n  - ')}`);
    process.exit(1);
  }
  writeFileSync(out, JSON.stringify(cfg, null, 2));
  console.log(`[staging] escribió ${out}`);
  console.log(`[staging] worker=${cfg.name} ENVIRONMENT=${cfg.vars.ENVIRONMENT} DEPLOY_TARGET=${cfg.vars.DEPLOY_TARGET} routes=[] (sirve Pages)`);
  console.log(`[staging] bindings sustituidos por sentinels: D1=${cfg.d1_databases[0].database_id} R2=${cfg.r2_buckets[0].bucket_name} KV=${cfg.kv_namespaces.map((k) => k.binding).join(',')}`);
}
