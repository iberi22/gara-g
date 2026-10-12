#!/usr/bin/env node
// normalize-wrangler-config.mjs — Post-build para el deploy a Cloudflare Workers.
//
// ⚠  Por qué este script existe en vez de usar el wrangler.json que emite Astro:
//    el adapter deja vars/bindings vacios y anota `name: gara-g-app-pwa`. Este script
//    los rellena desde el wrangler.toml de la raiz, que es la fuente de verdad.
//
// ⚠  ANTES (2026-09-30, versión previa) este script SOBREESCRIBIA el fichero entero
//    con un objeto literal. Eso producía un deploy roto:
//      - sin `d1_databases`  -> el login de usuarios no encuentra la tabla
//      - sin `r2_buckets`    -> los documentos de los vehiculos no se guardan
//      - sin `kv_namespaces` -> no hay namespace SESSION, no hay sesiones
//      - sin `ENVIRONMENT`   -> los tres guards de admin pasan a `!== 'production'`
//                                y se reabre el backdoor que cerro el P0
//      - routes a gara-g.pages.dev, el dominio que ya no existe
//    Verificado el 2026-09-30 ejecutando este script sobre el build real.
//
// Ahora: parte del JSON que genera Astro, conserva todo lo que ya venga, y SOLO
// anade o corrige lo que falta. Nunca borra bindings.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { wranglerToml } from '../../../scripts/infra-config.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = join(__dirname, '..');
// NORMALIZE_OUT permite ensayar el script contra otro destino (los tests lo usan
// para no tocar dist/). Por defecto escribe donde el deploy lo lee.
const distServer = process.env.NORMALIZE_OUT
  ? resolve(process.env.NORMALIZE_OUT)
  : join(root, 'dist', 'server');
const wranglerJsonPath = join(distServer, 'wrangler.json');
// WRANGLER_TOML_IN permite leer un wrangler.toml alternativo. Los tests lo usan
// para ensayar variantes (por ejemplo "sin D1") sobre una copia temporal en vez
// de reescribir el fichero real del repo mientras otros tests lo leen.
const wranglerTomlPath = process.env.WRANGLER_TOML_IN
  ? resolve(process.env.WRANGLER_TOML_IN)
  : wranglerToml().path; // real -> private/infra -> wrangler.example.toml (scripts/infra-config.mjs)

if (!existsSync(distServer)) mkdirSync(distServer, { recursive: true });

const siteUrl = process.env.PUBLIC_SITE_URL || 'https://gara-g.swal.network';
const siteZone = process.env.PUBLIC_SITE_ZONE || 'swal.network';
const appName = process.env.WRANGLER_APP_NAME || 'gara-g';

if (!existsSync(wranglerTomlPath)) {
  console.error(`[normalize-wrangler] FATAL: no existe ${wranglerTomlPath}`);
  process.exit(1);
}
const toml = readFileSync(wranglerTomlPath, 'utf-8');

// La fecha de compatibilidad se hereda de wrangler.toml, que es la fuente de
// verdad declarada. Estampar la fecha del día (lo que hacía antes con `today`)
// hace que el bundle se mueva solo con el calendario: el 2026-10-01 el
// workerd local solo soporta hasta 2026-08-06 y el Worker no arrancaba, con
// exit 0 en el build y la suite en verde. La fecha se sube a mano en el toml,
// junto al resto de la configuración, no se deduce.
const declaredCompatibilityDate =
  process.env.COMPATIBILITY_DATE ||
  toml.match(/^\s*compatibility_date\s*=\s*"([^"]+)"/m)?.[1] ||
  '2026-08-31';

/** Lee un valor `clave = "valor"` del wrangler.toml. */
function tomlValue(key) {
  const m = toml.match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, 'm'));
  return m?.[1] ?? null;
}

/** Extrae el id de un binding `[[bloque]]` del toml. */
function tomlBinding(section, binding) {
  const re = new RegExp(`\\[\\[${section}\\]\\]([\\s\\S]*?)(?=\\n\\[|$)`, 'g');
  for (const [, block] of toml.matchAll(re)) {
    if (new RegExp(`binding\\s*=\\s*"${binding}"`).test(block)) {
      return block.match(/(?:database_id|bucket_name|id)\s*=\s*"([^"]*)"/)?.[1] ?? null;
    }
  }
  return null;
}

// --- 1. Base: lo que emitió Astro, o un objeto minimo si no existe -------------
let cfg = {};
if (existsSync(wranglerJsonPath)) {
  cfg = JSON.parse(readFileSync(wranglerJsonPath, 'utf-8'));
}

// --- 2. Identidad y runtime ---------------------------------------------------
cfg.name = appName;
cfg.main = cfg.main || './entry.mjs';
cfg.compatibility_date = declaredCompatibilityDate;
cfg.compatibility_flags = [...new Set([...(cfg.compatibility_flags ?? []), 'nodejs_compat'])];
cfg.workers_dev = false;

// El dominio real, no el de pages.dev
cfg.routes = [{ pattern: `${siteUrl}/*`, zone_name: siteZone }];
if (process.env.CF_ACCOUNT_ID) cfg.account_id = process.env.CF_ACCOUNT_ID;

// --- 3. Vars: se anaden, nunca se reemplazan ----------------------------------
cfg.vars = { ...(cfg.vars ?? {}) };
cfg.vars.PUBLIC_SITE_URL = siteUrl;
cfg.vars.PUBLIC_SITE_ZONE = siteZone;

// Las vars del toml son la fuente de verdad del runtime.
const tomlVars = {
  ENVIRONMENT: tomlValue('ENVIRONMENT'),
  APP_ID: tomlValue('APP_ID'),
  APP_NAME: tomlValue('APP_NAME'),
  DOMAIN: tomlValue('DOMAIN'),
  PUBLIC_DEMO: tomlValue('PUBLIC_DEMO'),
  // Entrega solo flota (src/lib/features.ts). Sin copiarla, el bundle depende del default.
  FLEET_ONLY: tomlValue('FLEET_ONLY'),
  XAVIER_URL: tomlValue('XAVIER_URL'),
};
for (const [k, v] of Object.entries(tomlVars)) {
  if (v === null) {
    console.error(`[normalize-wrangler] FALTA ${k} en wrangler.toml`);
    process.exit(1);
  }
  cfg.vars[k] = v;
}

// --- 4. Bindings: se conservan y se completan ---------------------------------
const d1Id = tomlBinding('d1_databases', 'SWAL_D1');
if (!d1Id) {
  console.error('[normalize-wrangler] FALTA el binding SWAL_D1 en wrangler.toml');
  process.exit(1);
}
const d1Name =
  toml.match(/\[\[d1_databases\]\][\s\S]*?database_name\s*=\s*"([^"]*)"/)?.[1] || 'gara-g';
cfg.d1_databases = [{ binding: 'SWAL_D1', database_name: d1Name, database_id: d1Id }];

const r2Name = tomlBinding('r2_buckets', 'SWAL_R2');
if (r2Name) {
  cfg.r2_buckets = [{ binding: 'SWAL_R2', bucket_name: r2Name }];
} else {
  console.error('[normalize-wrangler] FALTA el binding SWAL_R2 en wrangler.toml');
  process.exit(1);
}

// KV: el adapter trae el binding SESSION sin id (lo resuelve el deploy por nombre),
// y el toml trae el id. Se fusiona en una sola entrada con id.
const kvFromAdapter = Array.isArray(cfg.kv_namespaces) ? [...cfg.kv_namespaces] : [];
const kvIdFromToml = tomlBinding('kv_namespaces', 'SESSION');
const sessionFromAdapter = kvFromAdapter.find((k) => k.binding === 'SESSION');

if (kvIdFromToml) {
  cfg.kv_namespaces = [{ binding: 'SESSION', id: kvIdFromToml }];
} else if (sessionFromAdapter) {
  cfg.kv_namespaces = [{ binding: 'SESSION', id: sessionFromAdapter.id }];
} else {
  console.error('[normalize-wrangler] FALTA el binding SESSION (KV)');
  process.exit(1);
}

// Workers AI: el asistente del expediente (src/garage/assistant). En el toml queda
// comentado a proposito: con [ai] activo, @cloudflare/vite-plugin entra en modo proxy
// remoto durante `astro build` (ver scripts/build-workers.js). Se agrega aqui, al bundle
// que se despliega, y la comprobacion de abajo exige que este.
cfg.ai = { binding: 'AI' };

// Workers Rate Limiting (no usa KV: no gasta sus 1 000 escrituras/dia de Workers Free).
// Los consume src/pages/api/sync/[id].ts para acotar el abuso de R2 del respaldo cifrado.
// Los namespace_id son enteros (como string) unicos en la cuenta; `period` solo admite 10 o 60.
// Limites: ver la cabecera de la ruta. Se declaran aqui y no en el toml para no alterar
// `astro build` (igual que AI).
const SYNC_RATE_LIMITS = [
  { name: 'SYNC_RATE_LIMITER', namespace_id: '71001', simple: { limit: 120, period: 60 } },
  { name: 'SYNC_CREATE_LIMITER', namespace_id: '71002', simple: { limit: 3, period: 60 } },
  { name: 'SYNC_UPDATE_LIMITER', namespace_id: '71003', simple: { limit: 20, period: 60 } },
  // Credenciales TURN (src/pages/api/mesh/ice.ts): cada emision es trafico facturable, 10/min por IP.
  // Si dice que no, el endpoint responde STUN-only (no 429).
  { name: 'MESH_ICE_LIMITER', namespace_id: '71004', simple: { limit: 10, period: 60 } },
];
cfg.ratelimits = [
  ...(Array.isArray(cfg.ratelimits) ? cfg.ratelimits : []).filter(
    (r) => !SYNC_RATE_LIMITS.some((s) => s.name === r.name),
  ),
  ...SYNC_RATE_LIMITS,
];

// --- Secretos del Worker (no se pueden verificar en build: viven en Cloudflare, no en el bundle) ---
// MESH_ROOM_SECRET: de el se derivan la sala y la clave AES de la telemetria en vivo
// (src/pages/api/mesh/room-key.ts). Sin el, ese endpoint responde 503 en produccion y la
// grafica queda en modo local (falla cerrado, no cae a una sala sin cifrar). Por eso NO se
// hace fallar el build; es un paso manual del despliegue, una sola vez:
//     openssl rand -base64 48 | wrangler secret put MESH_ROOM_SECRET
const REQUIRED_RUNTIME_SECRETS = ['MESH_ROOM_SECRET'];
// Opcionales: TURN_KEY_ID y TURN_KEY_API_TOKEN (Cloudflare Realtime TURN, src/pages/api/mesh/ice.ts).
// Sin ellos la malla usa solo STUN, como antes; al crearlos se activa el relay sin redeploy de codigo.
const OPTIONAL_RUNTIME_SECRETS = ['TURN_KEY_ID', 'TURN_KEY_API_TOKEN'];

// --- 5. Comprobaciones: un deploy sin esto rompe la app en silencio -----------
const problems = [];
if (cfg.vars.ENVIRONMENT !== 'production')
  problems.push('ENVIRONMENT != production (se reabre el fallback de admin)');
if (cfg.vars.DOMAIN !== 'gara-g.swal.network')
  problems.push(`DOMAIN inesperado: ${cfg.vars.DOMAIN}`);
if (!cfg.d1_databases?.length) problems.push('sin D1');
if (!cfg.r2_buckets?.length) problems.push('sin R2');
if (!cfg.kv_namespaces?.length) problems.push('sin KV SESSION');
if (cfg.ai?.binding !== 'AI') problems.push('sin binding AI (el asistente responde 503)');
for (const want of SYNC_RATE_LIMITS) {
  const got = cfg.ratelimits.find((r) => r.name === want.name);
  if (!got || !got.namespace_id || !(got.simple?.limit > 0) || ![10, 60].includes(got.simple?.period))
    problems.push(`sin limitador ${want.name} (el respaldo cifrado quedaria abierto al abuso de R2)`);
}
if (!cfg.vars.XAVIER_URL) problems.push('sin XAVIER_URL (la memoria de agentes queda muda)');

if (problems.length) {
  console.error(`[normalize-wrangler] DEPLOY NO SEGURO:\n  - ${problems.join('\n  - ')}`);
  process.exit(1);
}

writeFileSync(wranglerJsonPath, JSON.stringify(cfg, null, 2));
console.log(`[normalize-wrangler] wrote ${wranglerJsonPath}`);
console.log(
  `[normalize-wrangler] name=${cfg.name} workers_dev=false routes=${siteUrl}/* zone=${siteZone}`,
);
console.log(
  `[normalize-wrangler] bindings: D1=${d1Id} R2=${r2Name} KV=${cfg.kv_namespaces.map((k) => k.binding).join(',')} AI=${cfg.ai.binding} ratelimits=${cfg.ratelimits.map((r) => r.name).join(',')}`,
);
console.log(`[normalize-wrangler] ENVIRONMENT=${cfg.vars.ENVIRONMENT} DOMAIN=${cfg.vars.DOMAIN}`);
console.log(
  `[normalize-wrangler] RECUERDA (no verificable en build): secretos del Worker requeridos: ${REQUIRED_RUNTIME_SECRETS.join(', ')} -> wrangler secret put <NOMBRE>`,
);
console.log(
  `[normalize-wrangler] OPCIONALES (sin ellos solo STUN; no falla el build): ${OPTIONAL_RUNTIME_SECRETS.join(', ')} -> wrangler secret put <NOMBRE>`,
);
