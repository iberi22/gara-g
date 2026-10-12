# Garage 3D — arquitectura

Vista "juego" de GARA-G: el vehiculo del usuario en 3D (WebGPU, 60 fps), estado de cada pieza,
historial, proximos cambios, wiki y foro por version, shop con anuncios por subasta y monitoreo en
vivo desde la APK. Es parte de la PWA (`packages/app-pwa`), ruta **`/fleet/garage`**, y se embebe
en la app Flutter con un WebView (sin codigo Flutter por ahora).

## Islas (cada una con dueño y ficheros propios)

| Isla | Ficheros | Depende de |
|---|---|---|
| Contratos | `src/garage/contracts.ts`, `src/garage/parts.ts` | — |
| Kit 3D comun | `src/garage/templates/common/*` (geometria, materiales, rueda, unidades) | contratos |
| Plantillas moto | `src/garage/templates/moto/*` | kit comun |
| Plantillas carro/pesado | `src/garage/templates/car/*` | kit comun |
| Medidas por modelo | `src/garage/specs/modelSpecs.ts` | contratos |
| Motor 3D | `src/garage/engine/*` | contratos, registry |
| Dominio | `src/garage/domain/*` (salud de piezas, compromisos, historial, indicadores, versionKey, snapshot) | contratos, `lib/vehicleCatalog.ts`, `lib/domain.ts` |
| Telemetria | `src/garage/telemetry/*`, `src/pages/api/garage/telemetry/*` | contratos, entity `telemetry` |
| Comunidad | `src/garage/community/*`, `src/pages/api/garage/forum/*`, `src/pages/api/garage/wiki/*` | contratos, dominio (versionKey) |
| Shop | `src/garage/shop/*`, `src/pages/api/garage/ads/*`, `src/pages/api/garage/shop*`, `src/pages/fleet/garage/anunciantes.astro` | contratos |
| HUD | `src/components/garage/*`, `src/pages/fleet/garage/index.astro` | contratos, motor (fachada), API |
| Laboratorio | `src/garage/lab/*`, `src/pages/fleet/garage/lab.astro`, `scripts/garage-shot.mjs` | registry |

Skills que fijan las reglas de cada isla: `.claude/skills/garage3d-webgpu-engine`,
`garage3d-parametric-vehicles`, `garage3d-game-hud`.

## Datos

Todo vive en la tabla generica `entity` de D1 (`instance_id, entity, id, data JSON`) a traves de
`src/lib/domain.ts`. Lo del tenant (vehiculos, mantenimientos, telemetria) usa el `instanceId` de
la sesion. Lo **compartido entre tenants** usa instancias fijas:

| Instancia | Entidades | Por que |
|---|---|---|
| `gara-g-community` (`COMMUNITY_INSTANCE_ID`) | `forumThread`, `forumPost`, `wikiSection`, `wikiRevision` | el foro de una version es de todos los dueños de esa version |
| `gara-g-ads` (`ADS_INSTANCE_ID`) | `adAdvertiser`, `adCampaign`, `adStat`, `adClick`, `shopPost` | los anunciantes pujan por usuarios de todos los tenants |

Esas entidades **no** estan en el mapa RBAC: la ruta generica `/api/fleet/[entity]` las rechaza
(403) y solo se tocan desde `/api/garage/*`, que aplica sus propias reglas.

Limitacion conocida (MVP): `listEntities` trae todas las filas de una entidad y filtra en memoria.
Sirve para miles de hilos; para mas, mover foro/anuncios a tablas propias con indices (los helpers
de `community/` y `shop/` encapsulan el acceso para que el cambio sea local).

## API (`/api/garage/*`, todo exige sesion; el middleware ya devuelve 401 JSON en `/api/*`)

| Metodo y ruta | Respuesta / cuerpo | Quien |
|---|---|---|
| `GET /api/garage/vehicles` | `GarageSnapshot` del tenant | cualquier rol |
| `GET /api/garage/vehicle/:id` | `VehicleDetail` (vehiculo + historial completo) | cualquier rol |
| `GET /api/garage/telemetry/:vin` | `MonitoringState` (ultimas 60 muestras) | cualquier rol |
| `POST /api/garage/telemetry` | `{ samples: TelemetrySample[] }` (≤ 200) → `{ accepted }` | admin, operator |
| `GET /api/garage/forum/:versionKey?cursor=` | `{ threads: ForumThread[], nextCursor? }` | cualquier rol |
| `POST /api/garage/forum/:versionKey` | `{ title, body, tags? }` → `ForumThread` | cualquier rol |
| `GET /api/garage/forum/thread/:id` | `{ thread, posts: ForumPost[] }` | cualquier rol |
| `POST /api/garage/forum/thread/:id` | `{ body }` → `ForumPost` | cualquier rol (no si `locked`) |
| `PATCH /api/garage/forum/thread/:id` | `{ pinned?, locked?, deleted? }` | admin |
| `GET /api/garage/wiki/:versionKey` | `WikiPage` (secciones de catalogo + comunidad) | cualquier rol |
| `PUT /api/garage/wiki/:versionKey/:sectionId` | `{ body, baseRevision }` → `WikiPage` (409 si `baseRevision` viejo) | cualquier rol |
| `GET /api/garage/shop?vehicleId=` | `ShopFeed` (subasta `shop_feed`, hasta 3 patrocinados + publicaciones) | cualquier rol |
| `GET /api/garage/ads/serve?slot=&vehicleId=&partCategory=` | `{ ads: ServedAd[] }` | cualquier rol |
| `POST /api/garage/ads/impression` | `{ token }` → 204 (cobra CPM) | cualquier rol |
| `GET /api/garage/ads/click?t=` | 302 a la URL del anuncio (cobra CPC, una vez por token) | cualquier rol |
| `GET/POST /api/garage/ads/advertisers` | registrar / ver mi anunciante | cualquier rol |
| `GET/POST/PATCH /api/garage/ads/campaigns` | CRUD de mis campañas; enviar → `pending_review` | dueño del anunciante |
| `PATCH /api/garage/ads/campaigns/:id/review` | `{ decision: 'approve'|'reject' }` | admin |
| `POST /api/garage/ads/advertisers/:id/topup` | `{ amountCOP }` (recarga manual hasta integrar pasarela) | admin |
| `GET /api/garage/ads/campaigns/:id/stats` | impresiones, clics, gasto por dia | dueño, admin |

## Subasta de anuncios (shop)

- **Candidatas**: campañas `active`, dentro de fechas, con presupuesto diario y total disponibles,
  anunciante con saldo > 0, segmentacion compatible con el contexto (`AdContext`: familia,
  carroceria, marca, modelo, versionKey, ciudad, categoria de pieza) y bajo el tope de frecuencia
  del usuario (`userHash` = HMAC del userId; nunca se guarda el id en claro).
- **Puntaje**: `eCPM × relevancia`. eCPM = puja CPM, o puja CPC × pCTR × 1000. pCTR suavizado
  bayesiano `(clics + 1) / (impresiones + 100)` (prior 1 %). Relevancia por lo especifico de la
  segmentacion que coincide: versionKey 1.0 > modelo 0.9 > marca 0.8 > carroceria 0.7 > familia
  0.6 > sin segmentar 0.5; ×1.25 si coincide la categoria de pieza en `part_context`.
- **Precio**: segundo precio generalizado. Cada ganador paga lo minimo para conservar su puesto:
  `score_siguiente / (relevancia × (pCTR×1000 si CPC, 1 si CPM)) + 1 COP`, nunca mas que su puja
  y nunca menos que el piso (CPM 2.000 COP, CPC 150 COP).
- **Cobro**: CPM se cobra al registrar la impresion visible (≥ 50 % en pantalla ≥ 1 s), CPC al
  primer clic del token. El token va firmado (HMAC con `ADS_TOKEN_SECRET`; en dev una clave fija
  con aviso) y expira en 30 min.
- **Ritmo**: si el gasto del dia supera `fraccion_del_dia × presupuesto_diario × 1.2`, la campaña
  entra con probabilidad reducida (evita gastar todo en la mañana).
- **Transparencia**: todo anuncio lleva "Patrocinado" y el nombre del anunciante.
- Fuera de alcance por ahora: pasarela de pago (Wompi / Mercado Pago). El saldo lo recarga un admin.

## Foro y wiki por version

`versionKey` = slug de marca + modelo + variante + rango de años de la generacion
(`yamaha-fz16-2018-2024`). Lo genera `domain/versionKey.ts`, y es lo unico que ve el foro: dos
dueños del mismo modelo pero de generaciones distintas no comparten foro. La wiki mezcla
secciones generadas del catalogo (especificaciones, intervalos de mantenimiento, repuestos con
vida util; solo lectura) con secciones de comunidad editables con control de revision optimista.
Texto plano siempre; la UI lo escapa.

## Telemetria y WebView

La APK (Flutter) enviara lotes a `POST /api/garage/telemetry` con la cookie de sesion (dentro del
WebView) o por su propio cliente HTTP. Dentro del WebView puede ademas empujar muestras en vivo sin
red llamando `window.GaraBridge.pushTelemetry(sample)`, que emite el evento `gara:telemetry`
(`src/garage/telemetry/bridge.ts` documenta el contrato JS ↔ Flutter). El monitoreo considera
"en linea" una muestra de hace ≤ `ONLINE_WINDOW_S` (120 s).

## Fases siguientes

1. Ajuste de plantilla a fotos sin IA (ver `docs/garage/PHOTO-TO-3D.md`): silueta + escala desde
   la llanta + optimizador sobre los parametros de la plantilla. Mantiene las piezas separadas.
2. Pasarela de pago para anunciantes y panel de facturacion.
3. Tablas propias en D1 para foro y anuncios cuando el volumen lo pida.
4. WebView en la app Flutter apuntando a `/fleet/garage?embed=app`.
