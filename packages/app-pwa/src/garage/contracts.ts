/**
 * contracts.ts — Contratos compartidos del Garage 3D.
 *
 * Es el UNICO sitio donde viven los tipos que cruzan islas: motor 3D, plantillas
 * parametricas, dominio (salud de piezas, compromisos, historial), API, foro/wiki,
 * shop (subasta de anuncios), telemetria y UI. Si una isla necesita un tipo nuevo
 * que otra consume, se agrega aqui; los tipos privados de una isla se quedan en ella.
 *
 * Convenciones del espacio 3D (las respetan todas las plantillas):
 *   - Unidades: metros. Las medidas de entrada vienen en mm (fichas tecnicas) y se
 *     convierten una sola vez con mm() de templates/common/units.ts.
 *   - +Y arriba, suelo en y = 0, el frente del vehiculo mira a +X, ancho sobre Z
 *     (+Z = lado izquierdo del conductor), el centro de la distancia entre ejes en x = 0.
 *
 * Este fichero solo tiene tipos y constantes puras: lo importan tanto el Worker (API)
 * como el navegador, asi que no puede importar valores de three.
 */
import type { Object3D } from 'three/webgpu';

// ---------------------------------------------------------------------------
// Identidad del vehiculo y medidas
// ---------------------------------------------------------------------------

/**
 * 'heavy' = camiones de carretera (furgon, estacas, volqueta, tractomula).
 * 'machinery' = maquinaria amarilla de obra: se mide por HORAS de motor (horometro), no por km.
 */
export type VehicleFamily = 'moto' | 'car' | 'heavy' | 'machinery';
export type MotoBody = 'naked' | 'sport' | 'scooter' | 'trail';
export type CarBody = 'sedan' | 'hatchback' | 'suv' | 'pickup' | 'van';
/** truck = furgon; flatbed = estacas; dump = volqueta; tractor = tractomula. */
export type HeavyBody = 'truck' | 'flatbed' | 'dump' | 'tractor';
/** Excavadora de orugas, retroexcavadora, cargador de llantas, bulldozer, motoniveladora y vibrocompactador. */
export type MachineryBody = 'excavator' | 'backhoe' | 'wheel_loader' | 'dozer' | 'grader' | 'roller';
export type BodyType = MotoBody | CarBody | HeavyBody | MachineryBody;

/** Unidad del contador de uso: km para todo lo que rueda en via, horas para maquinaria. */
export type UsageUnit = 'km' | 'h';

/** Medida de llanta. "205/55R16" → { widthMm: 205, aspectPct: 55, rimIn: 16 }. */
export interface TireSize {
  widthMm: number;
  aspectPct: number;
  rimIn: number;
}

/** Medidas publicas de ficha tecnica, en mm. Lo opcional lo completa la plantilla. */
export interface VehicleDimensions {
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  wheelbaseMm: number;
  trackFrontMm?: number;
  trackRearMm?: number;
  groundClearanceMm?: number;
  /** Solo motos. */
  seatHeightMm?: number;
}

export type PaintFinish = 'gloss' | 'metallic' | 'matte' | 'pearl' | 'satin';

export interface PaintSpec {
  /** Hex "#rrggbb". */
  baseColor: string;
  finish: PaintFinish;
  /** Color de detalles: rines, franjas, calipers. */
  accentColor?: string;
}

/** Especificacion completa que consume una plantilla para construir el modelo. */
export interface VehicleSpec {
  family: VehicleFamily;
  body: BodyType;
  dims: VehicleDimensions;
  tireFront: TireSize;
  tireRear: TireSize;
  /**
   * Parametros de forma normalizados 0..1 propios de cada plantilla
   * (ej. { tankVolume: 0.7, roofSlope: 0.4 }). Los ausentes toman su default.
   * Cada plantilla los declara en VehicleTemplate.shapeParams.
   */
  shape?: Record<string, number>;
  paint: PaintSpec;
  /** Variante elegida por ranura: { exhaust: 'underbelly', rim_front: 'spokes_5' }. */
  variants?: Record<string, string>;
}

/** Entrada de la tabla de medidas por modelo (src/garage/specs/modelSpecs.ts). */
export interface ModelSpecEntry {
  make: string;
  model: string;
  family: VehicleFamily;
  body: BodyType;
  /** Rango de anios al que aplican estas medidas. */
  yearFrom?: number;
  yearTo?: number;
  dims: VehicleDimensions;
  tireFront: TireSize;
  tireRear: TireSize;
  /** URLs de las fichas de donde salieron las medidas. Sin fuente no entra. */
  sources: string[];
}

/** Armado 3D por vehiculo (se guarda en la fila del vehiculo; se sanea antes de usarse). */
export interface VehicleBuild3d {
  v: 1;
  body?: BodyType;
  dims?: Partial<VehicleDimensions>;
  tireFront?: TireSize;
  tireRear?: TireSize;
  shape?: Record<string, number>;
  variants?: Record<PartSlotId, string>;
}

// ---------------------------------------------------------------------------
// Piezas
// ---------------------------------------------------------------------------

export type PartSlotId = string;

export type PartCategory =
  | 'motor'
  | 'frenos'
  | 'suspension'
  | 'llantas'
  | 'transmision'
  | 'electrico'
  | 'filtro'
  | 'liquido'
  | 'carroceria'
  | 'iluminacion'
  | 'escape'
  | 'chasis'
  | 'hidraulico';

export interface PartSlotDef {
  id: PartSlotId;
  label: string;
  category: PartCategory;
  families: VehicleFamily[];
  /** Toda plantilla de esas familias debe construir esta ranura. */
  required: boolean;
  /** Familias donde, pese a `required`, la ranura es opcional (llantas en maquinaria de orugas). */
  optionalIn?: VehicleFamily[];
  /** Pieza interna: oculta en modo 'beauty', visible en 'xray'. */
  internal?: boolean;
}

export type PartHealthStatus = 'ok' | 'warn' | 'critical' | 'overdue' | 'unknown';

/** Estado de una pieza para un vehiculo concreto (lo calcula garage/domain). */
export interface PartState {
  slotId: PartSlotId;
  /** Nombre de la pieza tal como la conoce el usuario: "Pastillas freno delantero". */
  label: string;
  category: PartCategory;
  /** 0..100; null si no hay datos para estimarla. */
  healthPct: number | null;
  status: PartHealthStatus;
  lifeKm?: number;
  kmSinceService?: number;
  lastServiceDate?: string;
  lastServiceKm?: number;
  nextDueKm?: number;
  nextDueDate?: string;
  estCostCOP?: number;
}

// ---------------------------------------------------------------------------
// Compromisos, historial e indicadores
// ---------------------------------------------------------------------------

export type CommitmentUrgency = 'overdue' | 'soon' | 'planned';

/** Algo que el vehiculo "debe": cambio de pieza, mantenimiento o documento. */
export interface Commitment {
  id: string;
  vehicleId: string;
  kind: 'part_change' | 'maintenance' | 'document' | 'inspection';
  title: string;
  slotId?: PartSlotId;
  dueKm?: number;
  dueDate?: string;
  /** Negativo = vencido. */
  remainingKm?: number;
  remainingDays?: number;
  urgency: CommitmentUrgency;
  status: 'pending' | 'done';
  source: 'maintenance' | 'catalog' | 'document';
  estCostCOP?: number;
}

export type HistoryKind = 'maintenance' | 'part_change' | 'fuel' | 'document' | 'alert' | 'dtc' | 'note';

export interface HistoryEvent {
  id: string;
  vehicleId: string;
  /** ISO 8601. */
  at: string;
  kind: HistoryKind;
  title: string;
  detail?: string;
  km?: number;
  costCOP?: number;
  slotIds?: PartSlotId[];
}

export type Tone = 'ok' | 'warn' | 'critical' | 'neutral' | 'info';

/** Indicador lateral del HUD. `value` ya viene formateado para mostrar. */
export interface Indicator {
  id: string;
  label: string;
  value: string;
  unit?: string;
  tone: Tone;
  hint?: string;
  /** 0..1 para dibujar un anillo o barra; ausente = sin barra. */
  progress?: number;
}

// ---------------------------------------------------------------------------
// Telemetria (APK → PWA) y monitoreo
// ---------------------------------------------------------------------------

export interface TelemetrySample {
  vin: string;
  /** ISO 8601. */
  ts: string;
  speedKmh?: number;
  rpm?: number;
  coolantC?: number;
  fuelPct?: number;
  batteryV?: number;
  odometerKm?: number;
  lat?: number;
  lon?: number;
  /** Codigos OBD-II activos, ej. ["P0301"]. */
  dtc?: string[];
  source: 'apk' | 'obd2' | 'manual';
}

export interface MonitoringState {
  vin: string;
  /** true si hubo una muestra en los ultimos ONLINE_WINDOW_S segundos. */
  connected: boolean;
  lastSeen?: string;
  latest?: TelemetrySample;
  /** Ultimas muestras, la mas vieja primero. */
  series: TelemetrySample[];
}

/** Ventana para considerar "en linea" al vehiculo (APK enviando). */
export const ONLINE_WINDOW_S = 120;

// ---------------------------------------------------------------------------
// Version (llave del foro y la wiki)
// ---------------------------------------------------------------------------

/**
 * Una "version" es marca + modelo + generacion (rango de anios) + variante.
 * El foro y la wiki se agrupan por `key`, no por modelo: "Yamaha MT-09 SP
 * 2021-2023" y "Yamaha MT-09 2017-2020" son espacios distintos.
 */
export interface VersionRef {
  /** Slug estable: "yamaha-mt-09-sp-2021-2023". Lo produce domain/versionKey.ts. */
  key: string;
  make: string;
  model: string;
  yearFrom?: number;
  yearTo?: number;
  variant?: string;
  /** Texto para mostrar: "Yamaha MT-09 SP (2021–2023)". */
  label: string;
}

// ---------------------------------------------------------------------------
// Garage (lo que pinta la vista principal)
// ---------------------------------------------------------------------------

export interface GarageVehicle {
  id: string;
  plate?: string;
  vin?: string;
  /** Nombre que escribio el usuario. La marca solo aparece como texto, nunca en el 3D. */
  name: string;
  make?: string;
  model?: string;
  year?: number;
  status: 'active' | 'maintenance' | 'idle';
  spec: VehicleSpec;
  version: VersionRef;
  /**
   * Unidad del contador de uso. En maquinaria es 'h' (horometro) y entonces `odometerKm`
   * y TODOS los campos *Km de sus piezas, compromisos e historial van en horas: el
   * calculo de vida util es el mismo, solo cambia la unidad que se muestra.
   */
  usageUnit: UsageUnit;
  odometerKm?: number;
  overallHealthPct: number | null;
  indicators: { left: Indicator[]; right: Indicator[] };
  parts: PartState[];
  /** Ordenados por urgencia: vencidos primero. */
  commitments: Commitment[];
}

/** GET /api/garage/vehicles */
export interface GarageSnapshot {
  vehicles: GarageVehicle[];
  generatedAt: string;
}

/** GET /api/garage/vehicle/:id */
export interface VehicleDetail {
  vehicle: GarageVehicle;
  history: HistoryEvent[];
}

// ---------------------------------------------------------------------------
// Comunidad: foro y wiki por version
// ---------------------------------------------------------------------------

export interface ForumThread {
  id: string;
  versionKey: string;
  title: string;
  body: string;
  authorId: string;
  authorName: string;
  createdAt: string;
  lastActivityAt: string;
  replyCount: number;
  tags: string[];
  pinned?: boolean;
  locked?: boolean;
}

export interface ForumPost {
  id: string;
  threadId: string;
  versionKey: string;
  body: string;
  authorId: string;
  authorName: string;
  createdAt: string;
}

export interface WikiSection {
  id: string;
  title: string;
  /** Texto plano con saltos de linea; la UI lo escapa al renderizar. */
  body: string;
  /** 'catalog' = generada desde el catalogo, solo lectura. */
  source: 'catalog' | 'community';
  editable: boolean;
  updatedAt?: string;
  updatedBy?: string;
}

export interface WikiPage {
  versionKey: string;
  version: VersionRef;
  sections: WikiSection[];
  revision: number;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Shop: anuncios por subasta
// ---------------------------------------------------------------------------

/** Lugares donde se muestra un anuncio. */
export type AdSlot = 'shop_feed' | 'part_context' | 'garage_banner';

export interface AdTargeting {
  families?: VehicleFamily[];
  bodies?: BodyType[];
  makes?: string[];
  models?: string[];
  versionKeys?: string[];
  cities?: string[];
  /** Mostrar cuando el usuario mira una pieza de esta categoria (ej. 'frenos'). */
  partCategories?: PartCategory[];
}

export interface AdCreative {
  title: string;
  body: string;
  imageUrl?: string;
  ctaLabel: string;
  /** Solo https. */
  url: string;
  advertiserName: string;
}

export type AdCampaignStatus = 'draft' | 'pending_review' | 'active' | 'paused' | 'exhausted' | 'rejected';

export interface AdCampaign {
  id: string;
  advertiserId: string;
  name: string;
  status: AdCampaignStatus;
  creative: AdCreative;
  targeting: AdTargeting;
  /** cpm: precio por mil impresiones; cpc: precio por clic. En pesos colombianos. */
  pricing: { model: 'cpm' | 'cpc'; bidCOP: number };
  dailyBudgetCOP: number;
  totalBudgetCOP: number;
  startDate?: string;
  endDate?: string;
  freqCapPerUserDay: number;
  createdAt: string;
}

export interface Advertiser {
  id: string;
  name: string;
  kind: 'parts_store' | 'workshop' | 'service' | 'dealer' | 'other';
  city?: string;
  contactEmail: string;
  /** Saldo prepagado. La subasta no sirve campanas de un anunciante sin saldo. */
  balanceCOP: number;
  verified: boolean;
  ownerUserId: string;
}

/** Contexto de una peticion de anuncio. No lleva datos personales: solo el vehiculo y la ciudad. */
export interface AdContext {
  slot: AdSlot;
  family?: VehicleFamily;
  body?: BodyType;
  make?: string;
  model?: string;
  versionKey?: string;
  city?: string;
  partCategory?: PartCategory;
  /** HMAC del id de usuario: sirve para el tope de frecuencia sin guardar quien es. */
  userHash: string;
}

export interface ServedAd {
  campaignId: string;
  creative: AdCreative;
  sponsoredLabel: 'Patrocinado';
  position: number;
  /** Token firmado que se manda de vuelta en impresion y clic. */
  token: string;
}

/** Publicacion organica (no pagada) del shop, enfocada en la marca o version. */
export interface ShopPost {
  id: string;
  kind: 'offer' | 'news' | 'service';
  title: string;
  body: string;
  make?: string;
  versionKey?: string;
  imageUrl?: string;
  url?: string;
  advertiserId?: string;
  createdAt: string;
}

/** GET /api/garage/shop?vehicleId=… */
export interface ShopFeed {
  sponsored: ServedAd[];
  posts: ShopPost[];
}

// ---------------------------------------------------------------------------
// Motor 3D y plantillas
// ---------------------------------------------------------------------------

export type ViewMode = 'beauty' | 'health' | 'xray';
export type QualityTier = 'high' | 'medium' | 'low';
export type RenderBackend = 'webgpu' | 'webgl2';

export interface EngineStats {
  backend: RenderBackend;
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  dpr: number;
  tier: QualityTier;
}

/**
 * Escenario: 'studio' = estudio claro de configurador (ciclorama, softboxes, luz de
 * contorno; el estilo de referencia del producto), 'garage' = garage oscuro de juego.
 */
export type StageTheme = 'studio' | 'garage';

/** Punto proyectado a pantalla, en px CSS relativos a la esquina superior izquierda del canvas. */
export interface ScreenPoint {
  x: number;
  y: number;
  /** false si el punto queda detras de la camara o fuera del canvas. */
  visible: boolean;
}

/**
 * Puntos del vehiculo en pantalla para dibujar cotas tipo plano tecnico (largo, alto,
 * entre ejes). Salen del bounding box y de los ejes del modelo construido; el VALOR que
 * se escribe en la cota sale de la ficha (spec.dims), no de estos puntos.
 */
export interface DimensionAnchors {
  /** Extremos del largo a la altura del techo (para la cota superior). */
  frontTop: ScreenPoint;
  rearTop: ScreenPoint;
  /** Extremos del largo a nivel del piso. */
  frontGround: ScreenPoint;
  rearGround: ScreenPoint;
  /** Punto mas alto y su proyeccion al piso (para la cota de alto). */
  top: ScreenPoint;
  topGround: ScreenPoint;
  /** Centros de los ejes delantero y trasero (cota de entre ejes). */
  axleFront: ScreenPoint;
  axleRear: ScreenPoint;
}

/** Fachada del motor. La UI solo habla con esto; nunca toca three directamente. */
export interface GarageEngineApi {
  /** Cambia el escenario sin reconstruir el vehiculo. */
  setTheme(theme: StageTheme): void;
  /** Anclas de cotas del vehiculo actual con la camara actual; null si no hay vehiculo. */
  projectAnchors(): DimensionAnchors | null;
  /** Posicion en pantalla de una pieza (su focusPoint o el centro de su bbox). */
  projectSlot(slotId: PartSlotId): ScreenPoint | null;
  /** Avisa (como maximo una vez por frame) cuando cambian camara, tamaño o vehiculo. */
  onViewChange(cb: () => void): () => void;
  mount(canvas: HTMLCanvasElement): Promise<{ backend: RenderBackend }>;
  /** Cambia el vehiculo en el tornamesa. direction: 1 = siguiente (entra por la derecha). */
  showVehicle(spec: VehicleSpec, opts?: { direction?: 1 | -1 }): Promise<void>;
  /** Reconstruye el vehiculo actual in situ con otra spec (camara intacta). No-op sin vehiculo. */
  updateVehicle(spec: VehicleSpec): void;
  setPartStates(states: PartState[]): void;
  setViewMode(mode: ViewMode): void;
  /** Encuadra la camara en una pieza; null vuelve a la vista general. */
  focusPart(slotId: PartSlotId | null): void;
  /** Devuelve la funcion para desuscribirse. */
  onPartSelected(cb: (slotId: PartSlotId | null) => void): () => void;
  setPaint(paint: PaintSpec): void;
  resize(): void;
  getStats(): EngineStats;
  dispose(): void;
}

/** Kit de materiales compartidos (templates/common/materials.ts). */
export interface MaterialKit {
  paint(spec: PaintSpec): unknown;
  accent(spec: PaintSpec): unknown;
  rubber(): unknown;
  metal(kind: 'steel' | 'aluminum' | 'dark' | 'brushed'): unknown;
  chrome(): unknown;
  plastic(kind: 'black' | 'gray' | 'textured'): unknown;
  glass(kind: 'clear' | 'tinted' | 'visor'): unknown;
  light(kind: 'head' | 'tail' | 'turn' | 'drl'): unknown;
  carbon(): unknown;
  seat(): unknown;
  dispose(): void;
}

export interface TemplateContext {
  materials: MaterialKit;
  /** 'low' para movil de gama baja: menos segmentos, sin detalles finos. */
  lod: 'high' | 'low';
}

export interface ShapeParamDef {
  id: string;
  label: string;
  /** Valor por defecto en 0..1. */
  default: number;
  hint?: string;
}

export interface BuiltVehicle {
  /** Raiz del modelo; cada ranura es un hijo llamado `part:<slotId>`. */
  root: Object3D;
  parts: Map<PartSlotId, Object3D>;
  /** Punto (metros, espacio del vehiculo) al que mira la camara al enfocar la pieza. */
  focusPoints: Record<PartSlotId, [number, number, number]>;
  triangles: number;
}

export interface VehicleTemplate {
  /** "moto-naked", "car-sedan", ... */
  id: string;
  family: VehicleFamily;
  body: BodyType;
  /** Nombre generico, sin marcas: "Moto naked", "Sedan compacto". */
  label: string;
  defaults: Omit<VehicleSpec, 'paint' | 'variants' | 'shape'>;
  shapeParams: ShapeParamDef[];
  /** Variantes por ranura que la plantilla sabe construir: { exhaust: ['stock', 'underbelly'] }. */
  variants: Record<PartSlotId, string[]>;
  build(spec: VehicleSpec, ctx: TemplateContext): BuiltVehicle;
}

/** Presupuestos de render. Los tests de plantillas y el motor los hacen cumplir. */
export const RENDER_BUDGET = {
  /** Triangulos por vehiculo en LOD high / low. */
  vehicleTrianglesHigh: 90_000,
  vehicleTrianglesLow: 35_000,
  /** Draw calls de la escena completa (garage + vehiculo). */
  sceneDrawCalls: 120,
  /** Objetivo de frame: 60 fps. */
  targetFrameMs: 16.7,
} as const;
