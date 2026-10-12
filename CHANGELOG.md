# Changelog

All notable changes to the GARA-G project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] — 2026-10-03

### Changed
- **El mercado conecta, no cobra.** GARA-G no procesa pagos entre clientes y prestadores: el pago se acuerda
  directamente o con el token de la red SWAL. Aviso visible en el mercado, al vender y en la portada; se retira
  `payoutGara` de la interfaz (las ofertas antiguas que lo traen se siguen leyendo).

### Added
- Ofertas con un contacto para acordar (telefono, WhatsApp o web, validado y revalidado al mostrarlo) y la marca
  "Acepta token SWAL".
- Pestana **"Todo para tus vehiculos"** en `/fleet/mercado`: por cada vehiculo del garage, lo que puede necesitar o
  portar, con lo proximo a necesitar primero y las ofertas que le sirven. Funciona sin cuenta.

### Fixed
- La version de cache del service worker no cambiaba entre releases (se hasheaba solo `sw.js`).

## [0.1.0] — 2026-10-03

Primera version publica de la PWA: gratis, usable sin cuenta, con las dos redes de GARA-G sobre edge-mesh.

### Added
- **Tema TALLER** en toda la app (claro y oscuro), onboarding y preferencias de menu y paneles (#1019).
- **Portada gratuita** y **modo local sin cuenta**: garage 3D, catalogo y ajustes sobre IndexedDB (#1020).
- **Respaldo cifrado de extremo a extremo sin cuenta** (`/fleet/respaldo`): el servidor solo guarda texto
  cifrado; limites por IP y por respaldo con el binding de rate limiting de Workers y prueba de trabajo al crear.
- **edge-mesh** incrustado como submodulo (`cores/edge-mesh`, solo en el navegador) (#1021).
- **Red V2V de navegacion** (`/fleet/radar`): balizas y peligros firmados entre vehiculos cercanos, riesgo de
  colision por tiempo al punto de maximo acercamiento, alerta de voz; identidad de red desechable que rota cada 10 min.
- **Red de datos / mercado** (`/fleet/mercado`, `/fleet/mercado/vender`): ofertas firmadas, demanda anonima con
  consentimiento, agregados de navegacion con privacidad diferencial.
- Geocercas que se crean, editan y borran con teclado.

### Changed
- La telemetria en vivo se sincroniza por edge-mesh en una sala cifrada (AES-GCM) cuya clave solo entrega
  `/api/mesh/room-key` a una sesion de ese tenant; se retiran `y-webrtc` e `y-indexeddb`.
- Leaflet sale del bundle (antes de unpkg); la version visible del menu sale de `package.json`.

### Fixed
- Accesibilidad (auditoria UX, wave 32): los 9 P0 cerrados — modal de flotas con foco, selector de interfaz con
  nombre y estado, menu movil con foco e `inert`, botones de solo icono con nombre; contraste AA medido bajo el
  tema, areas tactiles de 44 px, `prefers-reduced-motion`, toasts que se anuncian, tablas con `scope`/`caption`.
- Datos honestos: sin graficas inventadas en analitica ni demo presentada como respuesta de la IA; la eficiencia
  de combustible se calcula por tanque lleno; errores de carga visibles en vez de listas vacias.
- `/fuel` no cargaba; el calendario de mantenimiento marcaba manana como hoy despues de las 19:00.
- Paginas prerenderizadas que perdian la sesion; desbordes a 360 px y 768 px.

### Requiere antes de desplegar
- `wrangler secret put MESH_ROOM_SECRET` (>= 32 caracteres). Sin el, la telemetria en vivo queda solo local.

## [Unreleased] — verificado 2026-09-05

### Added
- Wave-12 Phase 5 P1: offline outbox queue, CSV export RFC4180, OBD2 Bluetooth + simulador, dashboard SVG charts, live tracking map, notification center + alert fan-out + push stub (#916-921, #930)
- Maintenance calendar real: nextKm/nextDate, estados vencido/próximo, grid mensual SSR (#874)
- VehicleTable + validadores VIN/placa Colombia-Mercosur (#877)
- Landing pública + 3 interfaces (admin/AUI socio/game NFS) en rama feat/ux-landing-3interfaces (pendiente merge)
- features.json recalibrado a % REAL: 75.9% sobre 46 features con evidencia por item

### Fixed
- tracking.astro: marcadores de conflicto del merge wave-12 (servía 500) + columnas/liveRows reconstruidos
- Dependabot npm 16→3 via pnpm.overrides (#905, #922); workspace Rust resoluble + cargo check 0 errors
- PRs vacíos de Jules cerrados como superseded (#912, #927)

### Known gaps (wave-13 #932-941)
- E2E baseline 28/77: testids viejos vs UI rediseñada, catalogJson ReferenceError, fuentes mixtas, /fleet público sin gate
- Rust `cargo test` se cuelga en infrastructure::db (entorno); voice/native excluido del gate (toolchain espeak)

### Added
- CHANGELOG.md file following Keep a Changelog standard

### Changed
- Consolidated lockfiles to pnpm (pnpm-lock.yaml)
- Removed package-lock.json and yarn.lock

### Fixed
- Resolved dependency override conflicts (ws, vitest)
- Fixed 8 security vulnerabilities in dependencies
- Renamed jest.config.js to jest.config.cjs for ESM compatibility

### Removed
- Unused DB stubs and orphaned test files
- Generated files from mobile directory

## [1.0.0-rc.1] — 2026-06-16

### Added
- Enterprise Dashboard — 5 pages with sidebar, nav items, analytics
- GPS Live Tracking with WebSocket updates
- Geofencing system with zone entry/exit alerts
- Route Optimization with Google Routes API + GeneticTSP
- ML Predictive Analytics (NSGA-II optimizer)
- Compliance Dashboard with scoring and audit automation
- AI Assistant with Gemini 2.5 Pro for fleet insights
- Staking UI with VestingVault, RewardDistributor contracts
- Governance with OpenZeppelin DAO framework
- DePIN Nodes pages (overview, node list, node detail)
- V2V Mesh Protocol with Ed25519 signatures
- Dashcam with circular buffer recording
- Video Editor (trim, merge, overlay via FFmpeg)
- GPS Telemetry Overlay on video
- Seatbelt Detection (Rust + Flutter)
- ADAS/FCW Engine (Rust)
- Lane Tracking (Hough Transform + Kalman filter)
- DMS (Driver Monitor System)
- OBD-II Diagnostics
- Voice/Safety Agent
- Rust NDK cross-compilation for ARM64
- APK build environment (Flutter + Rust NDK)

### Changed
- Monorepo structure with pnpm workspaces
- Full crate Rust rewrite (50 source files, hexagonal architecture)
- Enterprise tracking backend API
- Predictive analytics data layer
- Community/Forum backend implementation
- Multi-Fleet Dashboard initial implementation
- Subscription Management system
- Enhanced error boundaries in enterprise components

### Fixed
- Next.js build and compilation errors
- Backend test failures and infra sanitization
- Firebase mocks and compliance tests
- RewardDistributor withdrawal limits (security)
- Empty states and error handling in all enterprise pages

### Security
- Added CSP nonces
- Firebase Auth configuration
- Rate limiter (Firestore hybrid + memory)
- Environment variable validation
- Dependency audit and vulnerability fixes

## [0.9.0] — 2026-06-12

### Added
- Android NDK cross-compilation (cargo-ndk + abiFilters arm64-v8a)
- FFmpeg Kit integration in Flutter
- Video editing service (trim, merge, overlay, export)
- Golden tests for principal screens
- E2E integration tests for mobile app
- Unit tests for mobile screens and services
- Rust test suite (31 files: ADAS, V2V, seatbelt, copilot, etc.)
- Monitoring and health checks (Sentry)
- Changelog generator setup

### Changed
- Dashcam refactored with foreground service
- Rust crate completed with hexagonal architecture
- V2V bypass for field testing
- Mobile screens with loading/error/empty states

## [0.8.0] — 2026-06-10

### Added
- Solana migration (Anchor programs)
- Data marketplace contracts
- DePIN rewards flow
- Withdrawal limits and cooldowns in RewardDistributor
- Full audit and architectural refocus for DePIN

### Changed
- Migrated EVM → Solana
- Unified Anchor programs

## [0.7.0] — Initial Release

### Added
- V2V communication system
- Mobile app core (Flutter + Rust)
- Data marketplace smart contracts
- Cloud Run hybrid architecture
- Firebase integration
- Fleet management dashboard
- Driver management system
- Organization management
- Multi-tenant enterprise architecture

[Unreleased]: https://github.com/iberi22/gara-g/compare/v1.0.0-rc.1...HEAD
[1.0.0-rc.1]: https://github.com/iberi22/gara-g/compare/v0.9.0...v1.0.0-rc.1
[0.9.0]: https://github.com/iberi22/gara-g/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/iberi22/gara-g/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/iberi22/gara-g/releases/tag/v0.7.0

## [0.3.0] - 2026-09-02 — Deploy Cloudflare Workers (Fleet Management live)

### Added
- **Fleet Management UI completa** (11 páginas server-rendered Astro+Svelte5):
  `/fleet` (dashboard KPIs), `/fleet/fleets`, `/fleet/vehicles`, `/fleet/drivers`,
  `/fleet/maintenance`, `/fleet/fuel-logs`, `/fleet/documents`, `/fleet/geofences`,
  `/fleet/alerts`, `/fleet/tracking`, `/fleet/analytics`
- **REST CRUD genérico**: `/api/fleet/[entity]` para 9 entidades (vehicle, fleet,
  driver, maintenance, fuelLog, document, geofence, alert, telemetry) +
  `/api/fleet/stats` para KPIs agregados
- **Seed demo-flota**: 102 entidades realistas (10 vehículos, 5 conductores,
  20 mantenimientos, 30 fuel-logs, 8 documentos, 4 geocercas, 12 alertas,
  50 telemetrías) con instance_id `demo-flota`
- **40 nuevos e2e Playwright** cubriendo dashboard, navegación, CRUD REST,
  tracking en vivo y analytics

### Fixed
- `wrangler.toml`: configurado como Worker SSR (main + assets dir),
  removidos bindings D1 ficticios (`SWAL_DOMAIN_D1` con ID inexistente)
- `@astrojs/cloudflare@14`: añadido `scripts/strip-fake-d1.sh` para limpiar
  el `dist/server/wrangler.json` post-build antes del deploy (workaround para
  el bug del adapter que mete bindings D1 con IDs placeholder)
- `tests/manifest.test.ts`: actualizado para reflejar el deploy como Worker
  (`gara-g.iberi22.workers.dev`) en vez de Pages
- Workflow `.github/workflows/deploy-cloudflare.yml`: reescrito para usar
  `wrangler deploy` (correcto para SSR) con smoke tests post-deploy

### Deploy
- **Producción**: https://gara-g.iberi22.workers.dev (Worker SSR activo)
- **Preview**: https://gara-g-preview.iberi22.workers.dev
- **Smoke tests**: 13/13 rutas devuelven 200 con datos seed reales

## [0.3.1] - 2026-09-02 — Workers deploy (Pages inviable para SSR)

### Cambiado
- `wrangler.toml`: configuración como Worker (sin `pages_build_output_dir`)
- `astro.config.mjs site`: `gara-g.pages.dev` → `gara-g.iberi22.workers.dev`
- `scripts/strip-fake-d1.sh` → `scripts/prepare-deploy.sh`: script unificado
  con TARGET=workers|pages, limpia SWAL_DOMAIN_D1 + previews + python_modules
  y restaura main + assets según el target

### Por qué Workers, no Pages
- Pages Functions: límite 1MB por función, sin ESM imports dinámicos
- Worker bundle SSR de @astrojs/cloudflare@14: ~3MB (necesita compute)
- Workers soporta bundles grandes y SSR completo

### Deploy activo
- Producción: https://gara-g.iberi22.workers.dev (13/13 rutas 200)
- Workflow: `.github/workflows/deploy-cloudflare.yml` con TARGET=workers

## [0.4.0] - 2026-09-02 — Pages.dev static deploy

### Cambiado
- `astro.config.mjs output`: 'server' → 'static' (Pages no soporta SSR completo)
- `astro.config.mjs site`: 'https://gara-g.iberi22.workers.dev' → 'https://gara-g.pages.dev'
- `wrangler.toml`: configuración para Pages (sin `pages_build_output_dir`,
  sin `main`/`assets` ya que Pages detecta el output automáticamente)
- `.github/workflows/deploy-cloudflare.yml`: Pages deploy + smoke tests
- `playwright.config.ts`: BASE_URL configurable; CI usa gara-g.pages.dev
- `tests/e2e/fleet-crud.spec.ts`: reescrito — sin tests de APIs REST (es estático)
- `tests/e2e/fleet-dashboard.spec.ts`: navegación con trailing slash correcto

### Deploy
- Producción: https://gara-g.pages.dev (12/12 páginas 200, pre-renderizadas)
- Worker gara-g anterior: borrado (ya no aplica)
- Build: 992KB total, todas las páginas fleet + dashboard pre-renderizadas

### Trade-offs
- Pierde: APIs REST /api/fleet/* (CRUD dinámico, POST/PATCH/DELETE)
- Mantiene: 11 páginas UI con datos seed visibles (fleets, vehicles, drivers, etc.)
- Si quieres CRUD runtime: volver a output:'server' con Workers.dev (Workers.dev soporta SSR completo)
