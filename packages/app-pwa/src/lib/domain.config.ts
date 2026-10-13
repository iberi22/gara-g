// domain.config.ts — UNICO archivo obligatorio para una app nueva.
// GARA-G (DePIN PWA agentico) — entidades base + fleet extended para parque automotor (pay-per-use 5% + mesh-only 0$)

export const domainConfig = {
  appId: 'gara-g',
  appName: 'Gara-G Gestión de Flotas',
  // La PK de D1 es (instance_id, entity, id): este identificador decide que filas
  // ve cada usuario. Es el UNICO lugar donde debe escribirse el literal; el resto
  // del codigo importa DEFAULT_INSTANCE_ID de aqui. Antes vivia duplicado en
  // lib/xavier.ts y como default de prop en 5 componentes Svelte, que es como se
  // desincronizo y `locals.tenant` acabo cayendo al fallback.
  instanceId: 'gara-g-default-instance',
  entities: [
    {
      name: 'vehicle',
      label: 'Vehicle',
      fields: ['plate', 'vin', 'make', 'model', 'year', 'status', 'fleetId', 'type', 'capacity', 'soatExpiry', 'tecnoExpiry', 'photoUrl'],
      xavierKind: 'vehicle',
    },
    {
      name: 'fleet',
      label: 'Fleet',
      fields: ['name', 'organizationId', 'region', 'tags', 'managerId'],
      xavierKind: 'fleet',
    },
    {
      name: 'telemetry',
      label: 'Telemetry',
      fields: ['vin', 'timestamp', 'speed', 'rpm', 'coolantTemp', 'fuelLevel', 'latitude', 'longitude', 'troubleCodes', 'odometer', 'hours'],
      xavierKind: 'telemetry',
    },
    // Fleet extended (parque automotor completo) — reusable en forks flota-camiones
    {
      name: 'driver',
      label: 'Driver',
      fields: ['name', 'cedula', 'licenseCategory', 'licenseExpiry', 'phone', 'status', 'fleetId', 'vehicleId'],
      xavierKind: 'driver',
    },
    {
      name: 'maintenance',
      label: 'Maintenance',
      fields: ['vehicleId', 'type', 'km', 'date', 'cost', 'workshop', 'nextKm', 'nextDate', 'status', 'notes'],
      xavierKind: 'maintenance',
    },
    {
      name: 'fuelLog',
      label: 'FuelLog',
      fields: ['vehicleId', 'driverId', 'date', 'km', 'gallons', 'cost', 'station', 'kmPerGallon'],
      xavierKind: 'fuelLog',
    },
    {
      name: 'document',
      label: 'Document',
      fields: ['vehicleId', 'driverId', 'kind', 'fileHash', 'r2Key', 'expiry', 'status'],
      xavierKind: 'document',
    },
    {
      name: 'geofence',
      label: 'Geofence',
      fields: ['name', 'fleetId', 'polygon', 'type', 'alertOnEnter', 'alertOnExit'],
      xavierKind: 'geofence',
    },
    {
      name: 'alert',
      label: 'Alert',
      fields: ['vehicleId', 'fleetId', 'kind', 'severity', 'message', 'acknowledged'],
      xavierKind: 'alert',
    },
    {
      name: 'notification',
      label: 'Notification',
      fields: ['userId', 'kind', 'title', 'body', 'readAt', 'severity'],
      xavierKind: 'notification',
    },
    // RBAC: users for multi-tenant auth. Stored in `entity` table with entity='user'.
    // Fields: email (text), passwordHash (PBKDF2 base64 'salt:hash'), role ('admin'|'operator'|'observer'), active (bool).
    {
      name: 'user',
      label: 'Usuario',
      labelPlural: 'Usuarios',
      icon: '👤',
      fields: ['email', 'passwordHash', 'role', 'active'],
      xavierKind: 'user',
    },
    // Preferencias de interfaz por usuario (lib/prefs.config.ts): modulos del menu y paneles.
    // id = `pref:<userId>`; fuera del mapa RBAC, solo /api/prefs la toca y siempre con el
    // usuario de la sesion.
    { name: 'preference', label: 'Preference', fields: ['userId', 'prefs'], xavierKind: 'preference' },
    // Garage 3D (docs/garage/ARCHITECTURE.md). Viven en instancias compartidas entre
    // tenants (COMMUNITY_INSTANCE_ID / ADS_INSTANCE_ID) y NO estan en el mapa RBAC:
    // la ruta generica /api/fleet/[entity] las rechaza; solo /api/garage/* las toca.
    { name: 'forumThread', label: 'ForumThread', fields: ['versionKey', 'title', 'body', 'authorId', 'authorName', 'lastActivityAt', 'replyCount', 'tags', 'pinned', 'locked', 'deleted'], xavierKind: 'forumThread' },
    { name: 'forumPost', label: 'ForumPost', fields: ['threadId', 'versionKey', 'body', 'authorId', 'authorName', 'deleted'], xavierKind: 'forumPost' },
    { name: 'wikiSection', label: 'WikiSection', fields: ['versionKey', 'sectionId', 'title', 'body', 'revision', 'updatedBy'], xavierKind: 'wikiSection' },
    { name: 'wikiRevision', label: 'WikiRevision', fields: ['versionKey', 'sectionId', 'revision', 'body', 'updatedBy'], xavierKind: 'wikiRevision' },
    { name: 'adAdvertiser', label: 'AdAdvertiser', fields: ['name', 'kind', 'city', 'contactEmail', 'balanceCOP', 'verified', 'ownerUserId'], xavierKind: 'adAdvertiser' },
    { name: 'adCampaign', label: 'AdCampaign', fields: ['advertiserId', 'name', 'status', 'creative', 'targeting', 'pricing', 'dailyBudgetCOP', 'totalBudgetCOP', 'startDate', 'endDate', 'freqCapPerUserDay'], xavierKind: 'adCampaign' },
    { name: 'adStat', label: 'AdStat', fields: ['campaignId', 'day', 'impressions', 'clicks', 'spendCOP', 'freq'], xavierKind: 'adStat' },
    { name: 'adClick', label: 'AdClick', fields: ['campaignId', 'tokenId', 'chargedCOP'], xavierKind: 'adClick' },
    { name: 'shopPost', label: 'ShopPost', fields: ['kind', 'title', 'body', 'make', 'versionKey', 'imageUrl', 'url', 'advertiserId'], xavierKind: 'shopPost' },
  ] as const,
  aui: {
    enabled: true,
    allowAgentTheme: true,
  },
  // pay-per-use 5% + mesh-only gratis: 1 camion = 100 camiones mismo precio (solo consumo R2/D1/AI)
  // mesh-only: 0$ (datos P2P Yjs replicados en otros nodos gara-g sin Cloudflare)
  // payg: infra 100% + AI*1.10 + 5% handling, sin fee por vehiculo/entidad
  billing: {
    tier: 'payg' as const, // 'free' | 'mesh-only' | 'payg' | 'payg-managed' (legacy 'socio' -> 'payg')
    //
    // Nombre VISIBLE del tier de facturacion. El identificador sigue siendo `payg` y "socio"
    // solo sobrevive en nombres internos (socioGate.ts, isSocioUser, la bandera demo) que no se
    // muestran: la interfaz no debe ofrecer ni nombrar un tier "Socio", que ya no existe.
    // Lo importan la insignia del conmutador, el gate de la AUI y ProBadge.
    tierLabel: 'PAYG',
    mode: 'swal-managed' as const, // 'mesh-only' | 'self-managed' | 'swal-managed'
  },
} as const;

/**
 * Nombre visible del tier de facturacion ("PAYG"). Fuente unica para las insignias y los
 * textos del gate: el literal no se repite en ningun componente.
 */
export const TIER_LABEL: string = domainConfig.billing.tierLabel;

/**
 * Tenant canónico de la app. Todo el código lo importa de aquí en vez de repetir
 * el literal: 16 ficheros lo tenían escrito a mano, y esa duplicación es
 * exactamente lo que dejó que `locals.tenant` acabara usando un valor distinto
 * al de la sesión.
 */
export const DEFAULT_INSTANCE_ID = domainConfig.instanceId;

/**
 * Instancias compartidas del Garage 3D (docs/garage/ARCHITECTURE.md): el foro y la wiki
 * de una version son de todos sus dueños, y los anunciantes pujan por usuarios de todos
 * los tenants. Nunca salen de la sesion ni de la request: son constantes del servidor.
 */
export const COMMUNITY_INSTANCE_ID = 'gara-g-community';
export const ADS_INSTANCE_ID = 'gara-g-ads';
export type DomainConfig = typeof domainConfig;
export type DomainEntityName = (typeof domainConfig.entities)[number]['name'];
