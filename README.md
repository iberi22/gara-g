# GARA-G — PWA de gestión de flotas, local-first

**PWA de gestión de flotas vehiculares** (Astro 7 + Svelte 5). Gestiona vehículos, conductores,
mantenimiento, combustible, alertas, geocercas y documentos.

**Local-first:** la app funciona sin internet y sin backend. En modo invitado los datos viven en
el dispositivo (IndexedDB / Yjs) y el garage abre con un vehículo de ejemplo; las funciones en la
nube (cuenta, respaldo, sincronización) son opcionales.

**Live:** https://gara-g.swal.network

Licencia: [GNU AGPL-3.0](LICENSE).

---

## Stack

| Capa | Tecnología |
|------|-----------|
| Frontend PWA | Astro 7, Svelte 5, Tailwind 4 |
| Datos en el dispositivo | Yjs + IndexedDB (modo invitado / local) |
| Malla P2P | [`@swal/edge-mesh`](https://www.npmjs.com/package/@swal/edge-mesh) (npm) |
| UI / cifrado | [`@swal/ui`](https://www.npmjs.com/package/@swal/ui), [`@swal/vault`](https://www.npmjs.com/package/@swal/vault) (npm) |
| Backend opcional | Cloudflare Workers (SSR), D1, KV, R2 |
| Auth (opcional) | Cookie + sesión en KV |
| Testing | Vitest (unit), Playwright (E2E) |

---

## Funcionalidades

- **Modo invitado sin red:** bienvenida → "este dispositivo" → garage 3D con un vehículo de
  ejemplo → vista de la flota demo de solo lectura. Sin cuenta y sin peticiones al servidor de datos.
- **Flota (con cuenta):** vehículos, conductores, mantenimiento, combustible, alertas, geocercas
  (Leaflet), documentos cifrados (AES-GCM, R2), tracking y telemetría OBD2.
- **PWA:** service worker, manifest, instalable, funciona offline.
- **Roles:** admin, operator, observer, con permisos por acción.

### Módulo cloud opcional

Facturación, pagos y anclaje on-chain NO forman parte de este repositorio. La app habla con ellos
solo a través de `packages/app-pwa/src/cloud/`; la implementación por defecto
(`src/cloud/local.ts`) los apaga: las rutas de pago responden `404 {"error":"cloud disabled"}` y
la inferencia usa el camino local. Ver `packages/app-pwa/cloud-overlay.mjs`.

---

## URLs de la App

| Ruta | Descripción |
|------|-------------|
| `/` | Landing page |
| `/fleet/bienvenida` | Asistente de primer uso (elige dónde guardar los datos) |
| `/fleet/garage` | Garage (modo invitado o con cuenta) |
| `/fleet/garage/flota-demo-chile` | Flota demo de solo lectura |
| `/login` | Login de usuario |
| `/fleet` | Dashboard principal |
| `/fleet/vehicles` | Gestión de vehículos |
| `/fleet/drivers` | Gestión de conductores |
| `/fleet/maintenance` | Órdenes de mantenimiento |
| `/fleet/fuel-logs` | Registro de combustible |
| `/fleet/alerts` | Alertas de flota |
| `/fleet/geofences` | Geocercas (con mapa) |
| `/fleet/documents` | Documentos de flota |

---

## Desarrollo

```bash
pnpm install --frozen-lockfile

# Desarrollo local (packages/app-pwa). Para entrar como admin con cualquier
# cookie de sesión copia las vars de dev: ENVIRONMENT=development + DEV_ADMIN_SESSION=true.
# Sin ellas (o en staging/preview/production) hay que iniciar sesión de verdad.
cp packages/app-pwa/.dev.vars.example packages/app-pwa/.dev.vars
pnpm --filter gara-g-app-pwa dev

# Tests
pnpm test                                        # unit (Vitest)
pnpm --filter gara-g-app-pwa exec playwright test # E2E

# Build de la PWA
pnpm build:canon

# Comprobar que el árbol público no filtra ids de infraestructura ni secretos
bash scripts/check-public-tree.sh
```

### Configuración de Cloudflare (opcional)

El repositorio solo trae plantillas. Para desplegar tu propia instancia:

```bash
cp wrangler.example.toml wrangler.toml   # rellena tus ids de D1, KV y R2
cp packages/app-pwa/config/staging-resources.example.json \
   packages/app-pwa/config/staging-resources.json   # solo si usas un stage
```

Ambos ficheros están en `.gitignore`. Sin `wrangler.toml` el build usa la plantilla
(`scripts/infra-config.mjs`): compila y pasa los tests, pero el bundle no es desplegable.

---

## Arquitectura de Datos

### D1 — Entidades Genéricas

Esquema en `packages/app-pwa/drizzle/0001_gara_g_d1_schema.sql`: una tabla `entity` con
`(instance_id, entity, id)` como clave y los campos de cada entidad en JSON, aislada por tenant.

### Entidades Soportadas

| Entity | Campos clave |
|--------|-------------|
| `vehicle` | name, plate, brand, model, year, odometer, status, imageUrl |
| `driver` | name, email, phone, license, status, imageUrl |
| `maintenance` | vehicleId, type, description, cost, status, scheduledAt |
| `fuel_log` | vehicleId, liters, costPerLiter, odometer, location |
| `alert` | vehicleId, type, severity, message, acknowledged |
| `geofence` | name, type, coordinates, radius, color, active |
| `document` | name, type, vehicleId, url, expiresAt |
| `telemetry` | vehicleId, lat, lng, speed, odometer, fuelLevel, timestamp |
| `user` | email, password (PBKDF2), role, instanceId, name |
| `notification` | userId, kind, title, body, readAt, severity |

---

## API Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/auth/login` | Login, devuelve cookie con session token |
| POST | `/api/auth/logout` | Destruye session en KV |
| GET | `/api/fleet/me` | Usuario autenticado actual |
| GET | `/api/fleet/[entity]` | Lista entidades |
| POST | `/api/fleet/[entity]` | Crea entidad |
| PATCH | `/api/fleet/[entity]` | Actualiza entidad (header `x-http-method-override`) |
| DELETE | `/api/fleet/[entity]` | Elimina entidad |
| GET | `/api/fleet/files` | Lista archivos (query: entity, entityId) |
| POST | `/api/fleet/files` | Upload archivo a R2 |
| DELETE | `/api/fleet/files` | Elimina archivo de R2 + D1 |

---

## Estructura del Proyecto

```
gara-g/
├── packages/
│   ├── app-pwa/            # PWA Astro 7 + Svelte 5 (la app)
│   │   ├── src/cloud/      # frontera con el módulo cloud opcional (por defecto: apagado)
│   │   ├── src/            # páginas, componentes, garage 3D, malla, lib
│   │   ├── tests/          # Vitest + Playwright (tests/e2e)
│   │   └── config/         # plantilla de recursos de staging
│   ├── mobile-app/         # app Flutter (piloto)
│   ├── mobile-app-native/  # núcleo nativo (Rust)
│   └── shared/             # tipos y design tokens compartidos
├── docs/                   # documentación técnica
├── scripts/                # build, infra-config, public-tree / check-public-tree
└── wrangler.example.toml   # plantilla de Cloudflare
```

---

**GARA-G** — Southwest AI Labs (SWAL). Licenciado bajo GNU AGPL-3.0.
