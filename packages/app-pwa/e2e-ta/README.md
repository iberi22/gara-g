# GARA-G Tester-Army E2E Suite (`gara-g-app-pwa`)

This directory contains the `tester-army/e2e` smoke test suite for GARA-G (vehicle and fleet workshop local-first PWA).

## Requirements & Prerequisites

- **Node.js**: Node `^22.22.3 || >=24.8.0` (e.g. Node 24).
- **Package Manager**: `pnpm@10.34.7` (or corepack enabled).

## Setup & Installation

From the repository root or `packages/app-pwa`:

```bash
# Enable corepack and prepare pnpm if needed
corepack enable && corepack prepare pnpm@10.34.7 --activate

# Install workspace dependencies
pnpm install
```

## How to Build & Run Tests

### 1. Local Target (`local`)

Build the app bundle first, then run the test runner:

```bash
# Build the application
pnpm --filter gara-g-app-pwa build

# Run the local E2E suite
cd packages/app-pwa
pnpm run e2e:ta
```

*Note on sandbox dev server fallback*: The `local` target in `e2e.config.ts` uses `pnpm exec astro dev --host 127.0.0.1 --port {port}` because `astro preview` in Cloudflare adapter mode requires Cloudflare authentication in non-interactive environments.

### 2. Live Target (`live`)

Run read-only smoke checks against the live production environment (`https://gara-g.swal.network`):

```bash
cd packages/app-pwa
pnpm run e2e:ta:live
```

---

## Offline coverage scope (test 5)

Test 5 is an **offline readiness** check, not an offline reproduction: it verifies that the
service worker controls the page and that the app shell is in the Cache Storage that
`public/sw.js` uses as last resort (`caches.match('/')`). It cannot cut the network:
Playwright routes do not see requests handled by the service worker, and `public/sw.js`
serves navigations network-first, so aborting routes would leave the reload online and the
test would pass even with a broken offline fallback.

Real offline behaviour — the network actually cut with `context.setOffline(true)` — is
covered by the Playwright specs:

- `tests/e2e/offline-local-first.spec.ts`
- `tests/e2e/offline-queue.spec.ts`

(The CI `e2e` job in `.github/workflows/ci.yml` runs `offline-local-first.spec.ts`;
`offline-queue.spec.ts` is currently left out of that job because it is red locally as well.)

---

## Sandbox Run Results Summary

Target execution counts measured on `origin/main` at `1cec6de`:

| Journey | Local (`pnpm run e2e:ta`) | Live (`pnpm run e2e:ta:live`) |
| --- | --- | --- |
| 1. landing opens with the main heading | PASSED | PASSED |
| 2. guest mode opens the fleet area without an account | PASSED | PASSED |
| 3. onboarding `/fleet/bienvenida` advances through its steps (mutating, `local/`) | PASSED | SKIPPED |
| 4. a guest can create a vehicle and see it listed (mutating, `local/`) | PASSED | SKIPPED |
| 5. offline readiness: the service worker controls the page and the shell is cached (readiness only, see scope above) | PASSED | PASSED |
| 6. PWA manifest and service worker are served | PASSED | PASSED |

**Total**: 6/6 passed (local), 4/4 passed (live). Zero real app bugs found.

---

## Persona Charters for Agentic Bug Bash (`e2e explore`)

1. **Independent Mechanic / Sole Proprietor ("Don Mario")**:
   Explores local-first features without creating an account; tests creating multiple vehicles, logging quick maintenance tasks in the garage, and verifying data stays stored across browser reloads.

2. **Fleet Operations Manager ("Valeria")**:
   Visits `/fleet/bienvenida` to configure a multi-vehicle fleet profile, toggles various modules in settings, and verifies navigation links and locked feature prompts respond appropriately in guest mode.

3. **Field Driver ("Carlos")**:
   Tests mobile responsiveness, offline local-first behavior, and service worker shell caching while navigating between garage and catalog views with poor or blocked connectivity.

4. **Privacy-Conscious Transport Owner ("Esteban")**:
   Evaluates data security modes (local vs. encrypted cloud backup), inspects offline storage warnings in onboarding, and tests backup setup/restore workflows.

5. **Fleet Analyst / Administrator ("Loreto")**:
   Navigates through fleet catalog overview, verifies proper Chilean market defaults (CLP currency, Chilean license plate inputs), and checks PWA installability indicators and manifest assets.
