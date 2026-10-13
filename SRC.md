# GARA-G Source Map

**Purpose:** A source map to help engineers and agents locate code in minutes.
*Rule:* Cloud-only code is not in the public tree.

## Packages and Ownership
- `packages/app-pwa`: Astro 7 + Svelte 5 PWA (the app)
- `packages/mobile-app`: Flutter pilot app
- `packages/mobile-app-native`: Rust native core
- `packages/shared`: Shared types and design tokens

## Key Entry Points
- **Pages:** `packages/app-pwa/src/pages/`
- **API Routes:** `packages/app-pwa/src/pages/api/`
- **Garage Domain:** `packages/app-pwa/src/garage/`
- **E2EE:** `packages/app-pwa/src/lib/e2ee/`

## Test Layout
- **E2E Tests:** `packages/app-pwa/tests/e2e/`
- **Unit Tests:** `packages/app-pwa/tests/`

## CI Workflows
- `.github/workflows/ci.yml`: Unified CI, lints, type checks, testing, build, public tree leak check, e2e local offline and guest modes.
- `.github/workflows/security.yml`: CodeQL analysis and dependabot alerts.
