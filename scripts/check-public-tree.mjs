#!/usr/bin/env node
// scripts/check-public-tree.mjs — implementation of scripts/check-public-tree.sh (see there).
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { productionIds, stagingIds, stagingResources, wranglerToml } from './infra-config.mjs';

const root = join(dirname(new URL(import.meta.url).pathname), '..');
process.chdir(root);

// --- 0. Public file list (same rule as scripts/public-tree.sh) --------------------------------
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf-8' })
  .split('\0')
  .filter((f) => f && !f.startsWith('private/'))
  .filter((f) => existsSync(f) && statSync(f).isFile()); // skips submodule gitlinks

// --- 1. Real infrastructure identifiers -----------------------------------------------------
// SHA-256 of the identifiers that must never be public: Cloudflare account id, production and
// staging D1 ids, the four KV namespace ids and the two R2 bucket names. Hashes, so this file
// can itself be public.
const REAL_ID_SHA256 = new Set([
  '3eeeb6ee59e2fab1c520c88caf05f7f2b6b0cc8f2995c670da5c7a01c4738ee4', // account
  '3d410d1b64a3a88802719980f0f2670e24bbbe0292ec99a461ddb7f88dc3698e', // D1 production
  '4e49dcaef6d94bfa38808019b709ce082c40ecb7ad13d6249754b69205bc3c08', // D1 staging
  '33b3850669a874de5394b47bc61ce1c0b455207dce1960819689e52ffe9332f4', // KV SESSION (prod)
  '64f78f97617eb6a1efaa77b713327c13b90086bc6fa7947c2774eed61dce0a1d', // KV SWAL_KV (prod)
  '7981f167a792fdebfacdf846318ea3e70c089781ce546e513d216593189b3cd0', // KV SESSION (staging)
  '6bf71bd031df26e429f8e3087ee4e2eb3d080359848b3dec97bb68ecbd5262ec', // KV SWAL_KV (staging)
  '01f4bb1ad8e0fe055e0503ce5441d3e0c6e2ab7091ce59b824480b72c507e693', // R2 bucket (prod)
  '72ccdd59c74889cd9516e2e0b7baca8aac7eb8484c2f58bb54021586dc1ddd56', // R2 bucket (staging)
]);
const sha = (s) => createHash('sha256').update(s).digest('hex');

// When the real config is available (owner checkout), its CURRENT ids are checked literally
// too, so a rotated id is caught even before the hash list above is updated.
const literalIds = new Set();
const w = wranglerToml();
if (w.kind !== 'example') {
  const { d1, r2, kvSession, kvSwal } = productionIds(); // ids, not the D1 *name*
  for (const v of [d1, r2, kvSession, kvSwal]) if (v && v.length >= 8) literalIds.add(v);
}
if (stagingResources().kind !== 'example') {
  const s = stagingIds();
  for (const v of [s.d1_database_id, s.r2_bucket_name, ...Object.values(s.kv ?? {})]) if (v) literalIds.add(v);
}

// --- 2. Forbidden strings (built from parts so this file does not match itself) -------------
const FORBIDDEN = [
  { what: 'demo admin password', needle: ['admin', '123'].join('') },
  { what: 'service account key reference', needle: ['service', 'account'].join('-') },
  { what: 'Google API key prefix', needle: ['AI', 'za'].join('') },
];

const findings = [];
const WORD = /[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*/g;

for (const file of files) {
  const buf = readFileSync(file);
  if (buf.includes(0)) continue; // binary
  const text = buf.toString('utf-8');
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    const where = `${file}:${i + 1}`;
    for (const f of FORBIDDEN) if (line.includes(f.needle)) findings.push(`${where}: ${f.what}`);
    for (const id of literalIds) if (line.includes(id)) findings.push(`${where}: real infra id (from private config)`);
    for (const m of line.matchAll(WORD)) {
      // Whole token and every run of 1..4 of its dash/underscore parts (catches an id or a
      // bucket name embedded in a longer token).
      const parts = m[0].split(/[-_]/);
      const seps = m[0].match(/[-_]/g) ?? [];
      for (let a = 0; a < parts.length; a++) {
        let cand = '';
        for (let b = a; b < Math.min(parts.length, a + 5); b++) {
          cand = b === a ? parts[a] : `${cand}${seps[b - 1]}${parts[b]}`;
          if (cand.length >= 8 && REAL_ID_SHA256.has(sha(cand))) {
            findings.push(`${where}: real infra id (hash match)`);
          }
        }
      }
    }
  });
}

// --- 3. gitleaks over the public files only -------------------------------------------------
let gitleaksStatus = 'skipped (SKIP_SECRET_SCAN=1)';
if (process.env.SKIP_SECRET_SCAN !== '1') {
  let bin = process.env.SECRET_SCAN_BIN || 'gitleaks';
  let probe = spawnSync(bin, ['version'], { encoding: 'utf-8' });
  if (probe.status !== 0 && !process.env.SECRET_SCAN_BIN) {
    // NixOS maintainers: fall back to the nixpkgs build when it is not on PATH.
    const nix = spawnSync('nix', ['build', 'nixpkgs#gitleaks', '--no-link', '--print-out-paths'], {
      encoding: 'utf-8',
    });
    const out = nix.status === 0 ? nix.stdout.trim().split('\n').pop() : '';
    if (out) {
      bin = join(out, 'bin', 'gitleaks');
      probe = spawnSync(bin, ['version'], { encoding: 'utf-8' });
    }
  }
  if (probe.status !== 0) {
    console.error(
      `[check-public-tree] gitleaks not found ("${bin}"). Install it or set SECRET_SCAN_BIN. ` +
        '(SKIP_SECRET_SCAN=1 skips this step locally; CI must run it.)',
    );
    process.exit(2);
  }
  const tmp = mkdtempSync(join(tmpdir(), 'gara-public-tree-'));
  try {
    for (const f of files) {
      mkdirSync(join(tmp, dirname(f)), { recursive: true });
      copyFileSync(f, join(tmp, f));
    }
    const r = spawnSync(
      bin,
      ['dir', tmp, '--config', join(root, '.gitleaks.toml'), '--no-banner', '--no-color', '--redact', '--verbose', '--exit-code', '1'],
      { encoding: 'utf-8' },
    );
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.replaceAll(`${tmp}/`, '');
    if (r.status === 1) {
      findings.push(`gitleaks findings:\n${out.trim()}`);
      gitleaksStatus = 'FINDINGS';
    } else if (r.status !== 0) {
      console.error(`[check-public-tree] gitleaks failed to run (exit ${r.status}):\n${out}`);
      process.exit(2);
    } else {
      gitleaksStatus = `clean (${probe.stdout.trim()})`;
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

console.log(`[check-public-tree] public files scanned: ${files.length}`);
console.log(`[check-public-tree] infra config used for literal ids: wrangler=${w.kind} staging=${stagingResources().kind}`);
console.log(`[check-public-tree] gitleaks: ${gitleaksStatus}`);
if (findings.length) {
  console.error(`[check-public-tree] FAIL: ${findings.length} finding(s)`);
  for (const f of findings) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('[check-public-tree] OK: no real infra ids, forbidden strings or gitleaks findings');
