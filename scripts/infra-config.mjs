// scripts/infra-config.mjs — Single place that says where the Cloudflare config lives.
//
// The public repository ships TEMPLATES only (wrangler.example.toml,
// packages/app-pwa/config/staging-resources.example.json). The real files (account,
// D1/KV ids, bucket names) are kept by the owner in the private infra repository and are
// gitignored here. A deploy copies them into place before building.
//
// Lookup order for each file:
//   1. the real file at its usual path (copied in by the deploy),
//   2. the same path under private/infra/ (owner checkout with the private overlay),
//   3. the committed template (public checkout: build and tests still work, the bundle
//      is NOT deployable because every id is a placeholder).
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function lookup(relReal, relExample) {
  const candidates = [
    { path: join(repoRoot, relReal), kind: 'real' },
    { path: join(repoRoot, 'private', 'infra', relReal), kind: 'private' },
    { path: join(repoRoot, relExample), kind: 'example' },
  ];
  return candidates.find((c) => existsSync(c.path)) ?? candidates[candidates.length - 1];
}

/** Where the wrangler config comes from: `{ path, kind: 'real' | 'private' | 'example' }`. */
export function wranglerToml() {
  return lookup('wrangler.toml', 'wrangler.example.toml');
}

/** Where the staging resource ids come from: `{ path, kind }`. */
export function stagingResources() {
  return lookup(
    'packages/app-pwa/config/staging-resources.json',
    'packages/app-pwa/config/staging-resources.example.json',
  );
}

/** Production resource ids declared in the wrangler config. */
export function productionIds(toml = readFileSync(wranglerToml().path, 'utf-8')) {
  const block = (section, binding) => {
    const re = new RegExp(`\\[\\[${section}\\]\\]([\\s\\S]*?)(?=\\n\\[|$)`, 'g');
    for (const [, body] of toml.matchAll(re)) {
      if (new RegExp(`binding\\s*=\\s*"${binding}"`).test(body)) return body;
    }
    return '';
  };
  const field = (body, key) => body.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, 'm'))?.[1];
  return {
    d1: field(block('d1_databases', 'SWAL_D1'), 'database_id'),
    d1Name: field(block('d1_databases', 'SWAL_D1'), 'database_name'),
    r2: field(block('r2_buckets', 'SWAL_R2'), 'bucket_name'),
    kvSession: field(block('kv_namespaces', 'SESSION'), 'id'),
    kvSwal: field(block('kv_namespaces', 'SWAL_KV'), 'id'),
  };
}

/** Staging resource ids (`d1_database_id`, `d1_database_name`, `r2_bucket_name`, `kv`). */
export function stagingIds() {
  return JSON.parse(readFileSync(stagingResources().path, 'utf-8'));
}
