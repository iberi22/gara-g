/**
 * mockPanels.ts — Datos de demostración y respaldo para los paneles del HUD.
 *
 * Suministra datos enriquecidos para Historial, Wiki, Foro y Shop cuando las
 * rutas de la API aún no existen o no hay conectividad.
 */
import type {
  ForumPost,
  ForumThread,
  HistoryEvent,
  ServedAd,
  ShopFeed,
  ShopPost,
  WikiPage,
  WikiSection,
} from '../../garage/contracts';

// ---------------------------------------------------------------------------
// 1. Historial de eventos
// ---------------------------------------------------------------------------

export const MOCK_HISTORY_EVENTS: Record<string, HistoryEvent[]> = {
  'mock-moto-1': [
    {
      id: 'h-moto1-1',
      vehicleId: 'mock-moto-1',
      at: '2026-09-15T14:30:00Z',
      kind: 'part_change',
      title: 'Cambio de kit de arrastre',
      detail: 'Cadena DID 428HD reforzada + piñón y catalina relación original',
      km: 25100,
      costCOP: 180000,
      slotIds: ['drive'],
    },
    {
      id: 'h-moto1-2',
      vehicleId: 'mock-moto-1',
      at: '2026-08-02T10:00:00Z',
      kind: 'maintenance',
      title: 'Mantenimiento preventivo 25.000 km',
      detail: 'Sincronización de carburador/inyección, calibración de válvulas y filtro de aire',
      km: 25000,
      costCOP: 95000,
      slotIds: ['engine', 'air_filter'],
    },
    {
      id: 'h-moto1-3',
      vehicleId: 'mock-moto-1',
      at: '2026-06-20T16:15:00Z',
      kind: 'part_change',
      title: 'Pastillas delanteras sinterizadas',
      detail: 'Reemplazo de pastillas marca Brembo serie carbono-cerámica',
      km: 20170,
      costCOP: 60000,
      slotIds: ['brake_front'],
    },
    {
      id: 'h-moto1-4',
      vehicleId: 'mock-moto-1',
      at: '2026-05-10T08:00:00Z',
      kind: 'document',
      title: 'Renovación Revisión Técnico-Mecánica',
      detail: 'Planta de Revisión Técnica Calama aprobada sin observaciones',
      km: 19500,
      costCOP: 215000,
    },
    {
      id: 'h-moto1-5',
      vehicleId: 'mock-moto-1',
      at: '2026-04-12T11:20:00Z',
      kind: 'fuel',
      title: 'Tanqueo extra 120 L',
      detail: 'Estación Primax Autopista Norte',
      km: 19120,
      costCOP: 64000,
    },
  ],
  'mock-car-1': [
    {
      id: 'h-car1-1',
      vehicleId: 'mock-car-1',
      at: '2026-08-10T09:00:00Z',
      kind: 'maintenance',
      title: 'Mantenimiento de 60.000 km',
      detail: 'Aceite 0W-20 Full Sintético, filtro de aceite y filtro de cabina',
      km: 60200,
      costCOP: 420000,
      slotIds: ['engine_oil', 'oil_filter'],
    },
    {
      id: 'h-car1-2',
      vehicleId: 'mock-car-1',
      at: '2026-05-18T14:00:00Z',
      kind: 'part_change',
      title: 'Batería 12V 65Ah',
      detail: 'Batería MAC Silver Plus libre de mantenimiento',
      km: 55400,
      costCOP: 380000,
      slotIds: ['battery'],
    },
    {
      id: 'h-car1-3',
      vehicleId: 'mock-car-1',
      at: '2026-02-14T17:30:00Z',
      kind: 'document',
      title: 'Renovación Póliza Todo Riesgo',
      detail: 'Seguros Bolívar vigencia anual',
      km: 51200,
      costCOP: 2850000,
    },
  ],
};

export function getMockHistory(vehicleId: string): HistoryEvent[] {
  return MOCK_HISTORY_EVENTS[vehicleId] ?? [
    {
      id: `h-def-${vehicleId}-1`,
      vehicleId,
      at: new Date(Date.now() - 15 * 86400000).toISOString(),
      kind: 'maintenance',
      title: 'Revisión general y fluidos',
      detail: 'Chequeo de niveles, presión de neumáticos y luces',
      costCOP: 75000,
    },
  ];
}

// ---------------------------------------------------------------------------
// 2. Wiki por versión
// ---------------------------------------------------------------------------

export const MOCK_WIKI_SECTIONS: WikiSection[] = [
  {
    id: 'wiki-specs',
    title: 'Especificaciones Técnicas de Fábrica',
    body: 'Cilindrada: 153 cc\nPotencia: 14.0 HP @ 7.500 RPM\nTorque: 13.6 Nm @ 6.000 RPM\nAlimentación: Carburador Mikuni BS26 / Inyección electrónica (v2)\nCapacidad de tanque: 12 litros\nPeso en seco: 135 kg\nCapacidad de aceite: 1.000 ml (cambio periódico) / 1.200 ml (con desarme de motor)',
    source: 'catalog',
    editable: false,
    updatedAt: '2026-01-10T12:00:00Z',
  },
  {
    id: 'wiki-maintenance',
    title: 'Intervalos de Mantenimiento Recomendados',
    body: '• Cambio de aceite de motor: Cada 3.000 km (mineral) o 5.000 km (sintético)\n• Filtro de aire: Limpieza cada 3.000 km, cambio cada 12.000 km\n• Bujía (NGK CPR8EA-9): Inspección cada 6.000 km, sustitución cada 12.000 km\n• Holgura de válvulas (frío): Admisión 0.08–0.12 mm, Escape 0.12–0.16 mm\n• Calibración de cadena: Holgura de 20 a 30 mm con piloto montado',
    source: 'catalog',
    editable: false,
    updatedAt: '2026-01-10T12:00:00Z',
  },
  {
    id: 'wiki-community-tips',
    title: 'Consejos de la Comunidad y Fallas Comunes',
    body: '1. Desgaste prematuro de cunas de dirección: Se recomienda reemplazar por rodamientos cónicos marca All Balls o KOYO para mayor durabilidad en vías colombianas.\n2. Vibración en farola delantera: Ajustar el tornillo inferior de soporte y colocar arandelas de goma antivibración.\n3. Presión óptima de llantas: 28 PSI adelante / 32 PSI atrás (con pasajero 34 PSI atrás).',
    source: 'community',
    editable: true,
    updatedAt: '2026-09-20T18:40:00Z',
    updatedBy: 'Carlos R. (Mecánico Maestro)',
  },
];

export function getMockWiki(versionKey: string): WikiPage {
  return {
    versionKey,
    version: {
      key: versionKey,
      make: 'Modelo',
      model: 'General',
      label: versionKey.replace(/-/g, ' ').toUpperCase(),
    },
    sections: MOCK_WIKI_SECTIONS,
    revision: 1,
    updatedAt: '2026-09-20T18:40:00Z',
  };
}

// ---------------------------------------------------------------------------
// 3. Foro por versión
// ---------------------------------------------------------------------------

export const MOCK_FORUM_THREADS: ForumThread[] = [
  {
    id: 'thread-1',
    versionKey: 'yamaha-fz16-2018-2024',
    title: '¿Qué aceite recomiendan para clima desértico (Calama - Antofagasta)?',
    body: 'Hola a todos. Hago trayectos semanales bajando a tierra caliente y noto que el motor calienta bastante en subida. ¿Es mejor pasar a Motul 7100 15W-50 o quedarme en Yamalube 10W-40?',
    authorId: 'usr-8812',
    authorName: 'Sebastián V.',
    createdAt: '2026-09-28T14:10:00Z',
    lastActivityAt: '2026-09-30T20:45:00Z',
    replyCount: 4,
    tags: ['aceite', 'temperatura', 'mantenimiento'],
    pinned: true,
  },
  {
    id: 'thread-2',
    versionKey: 'yamaha-fz16-2018-2024',
    title: 'Consumo promedio real en ciudad vs carretera',
    body: 'Llevo 6 meses con la moto y me está dando unos 30 a 32 km/L en Calama con tráfico pesado. ¿Qué cifras tienen ustedes?',
    authorId: 'usr-3341',
    authorName: 'Mariana G.',
    createdAt: '2026-09-24T09:30:00Z',
    lastActivityAt: '2026-09-25T11:00:00Z',
    replyCount: 7,
    tags: ['consumo', 'gasolina'],
  },
];

export const MOCK_FORUM_POSTS: Record<string, ForumPost[]> = {
  'thread-1': [
    {
      id: 'post-1-1',
      threadId: 'thread-1',
      versionKey: 'yamaha-fz16-2018-2024',
      body: 'Para ese uso mixto el 15W-50 100% sintético protege mucho mejor la caja y el embrague cuando el motor va a más de 95°C en subidas prolongadas.',
      authorId: 'usr-2001',
      authorName: 'David Motos',
      createdAt: '2026-09-28T16:00:00Z',
    },
    {
      id: 'post-1-2',
      threadId: 'thread-1',
      versionKey: 'yamaha-fz16-2018-2024',
      body: 'De acuerdo con David. Solo asegúrate de cambiarlo cada 3.500 km y usar siempre filtro original.',
      authorId: 'usr-9014',
      authorName: 'Felipe Gómez',
      createdAt: '2026-09-29T10:15:00Z',
    },
  ],
};

// ---------------------------------------------------------------------------
// 4. Shop y Anuncios patrocinados
// ---------------------------------------------------------------------------

export const MOCK_SERVED_ADS: ServedAd[] = [
  {
    campaignId: 'camp-motul-oil',
    creative: {
      title: 'Lubricante Motul 7100 10W-40 4T 100% Sintético',
      body: 'Protección extrema para motor y transmisión en el norte de Chile. Envío gratis en Calama y Antofagasta.',
      ctaLabel: 'Ver Oferta ($68.000)',
      url: 'https://ejemplo.com/repuestos/motul-7100',
      advertiserName: 'MotoStore Colombia Oficial',
    },
    sponsoredLabel: 'Patrocinado',
    position: 1,
    token: 'tok_ad_sample_oil_001',
  },
  {
    campaignId: 'camp-brembo-brakes',
    creative: {
      title: 'Pastillas Brembo Carbono-Cerámica Alta Duración',
      body: 'Frenado progresivo y sin ruidos. Compatibles con rines de serie.',
      ctaLabel: 'Comprar Kit ($75.000)',
      url: 'https://ejemplo.com/frenos/brembo-fz',
      advertiserName: 'Frenos & Discos SAS',
    },
    sponsoredLabel: 'Patrocinado',
    position: 2,
    token: 'tok_ad_sample_brakes_002',
  },
];

export const MOCK_SHOP_POSTS: ShopPost[] = [
  {
    id: 'sp-1',
    kind: 'offer',
    title: 'Combo Mantenimiento Mayor: Aceite + Filtros + Bujía',
    body: 'Kit completo certificado para modelos de 150 a 250 cc con 20% de descuento este mes.',
    make: 'Yamaha',
    createdAt: '2026-09-29T08:00:00Z',
  },
  {
    id: 'sp-2',
    kind: 'service',
    title: 'Diagnóstico Computarizado e Inyección en Taller Afiliado GARA-G',
    body: 'Escaneo OBD-II completo, limpieza de inyectores por ultrasonido y prueba de batería.',
    createdAt: '2026-09-20T14:00:00Z',
  },
];

export const MOCK_SHOP_FEED: ShopFeed = {
  sponsored: MOCK_SERVED_ADS,
  posts: MOCK_SHOP_POSTS,
};
