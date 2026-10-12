// cloud-overlay.mjs — How the optional (private) cloud module plugs into the app.
//
// The public app is local-first and complete on its own. Billing, payments, market settlement
// and on-chain anchoring live in a private overlay at the repo root (`private/`), which the
// public repository does not contain. This file is shared by astro.config.mjs and
// vitest.config.ts so both resolve the same way:
//
//   `@gara/cloud-impl`
//     - default ................................ src/cloud/local.ts (everything off)
//     - GARA_CLOUD=1 and private/ present ...... private/cloud/packages/app-pwa/src/cloud/impl.ts
//     - GARA_CLOUD=1 and private/ absent ....... hard error (a cloud build must not silently
//                                                 ship without its cloud module)
//   `@swal/econ-sdk` (only used by the private module)
//     - private/cores/swal-econ/packages/econ-sdk/src when present.
//
// Tests: when private/cloud exists its tests run with the app suite (they import the private
// modules directly), so the owner's checkout keeps the full suite; a public clone simply has
// fewer tests.
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(appDir, '..', '..');
const privateApp = join(repoRoot, 'private', 'cloud', 'packages', 'app-pwa');
const privateImpl = join(privateApp, 'src', 'cloud', 'impl.ts');
const econSdkSrc = join(repoRoot, 'private', 'cores', 'swal-econ', 'packages', 'econ-sdk', 'src', 'client.ts');
const localImpl = join(appDir, 'src', 'cloud', 'local.ts');

export function cloudOverlay(env = process.env) {
  const wanted = env.GARA_CLOUD === '1';
  if (wanted && !existsSync(privateImpl)) {
    throw new Error(
      `[cloud-overlay] GARA_CLOUD=1 pero falta el modulo cloud privado (${privateImpl}). ` +
        'Quita GARA_CLOUD para el build publico (local-first) o restaura private/.',
    );
  }
  const hasPrivate = existsSync(privateApp);
  const alias = { '@gara/cloud-impl': wanted ? privateImpl : localImpl };
  if (existsSync(econSdkSrc)) alias['@swal/econ-sdk'] = econSdkSrc;
  return {
    enabled: wanted,
    hasPrivate,
    alias,
    /** Test globs (relative to packages/app-pwa) of the private overlay, if present. */
    privateTests: hasPrivate ? ['../../private/cloud/packages/app-pwa/tests/**/*.test.ts'] : [],
  };
}
