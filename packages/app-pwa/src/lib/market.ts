/**
 * market.ts — UNICO sitio donde vive el mercado de la app: idioma, moneda, unidades,
 * vocabulario legal (documentos, licencias) y los ejemplos que se usan de relleno.
 *
 * Por que existe: la app nacio localizada para Colombia (COP, galones, SOAT/tecnomecanica,
 * cedula, placa) y la entrega es para una flota de camiones tolva en Chile (CLP, litros,
 * SOAP/revision tecnica/permiso de circulacion, RUT, patente). En vez de repartir el
 * reemplazo por 60 ficheros —que es como se vuelve a desincronizar—, el mercado es un dato:
 * se declara aqui una vez y todo el resto lo importa.
 *
 *   - El mercado por defecto de este despliegue es Chile (`es-CL`, `CLP`). Se puede cambiar
 *     sin tocar codigo con `PUBLIC_MARKET=CO` (o `CL`) en el entorno del Worker; sin la
 *     variable, Chile.
 *   - Los formateadores (`formatMoney`, `formatNumber`, `formatDate`, `formatVolume`,
 *     `formatEfficiency`) reciben el mercado como parametro opcional: los tests pueden pedir
 *     el otro mercado sin depender del entorno.
 *   - El MODELO DE DATOS no cambia: los campos siguen llamandose `cedula`, `gallons`,
 *     `soatExpiry`, `tecnoExpiry` y `kmPerGallon` porque renombrarlos rompe las filas ya
 *     guardadas, el SQL de la semilla y las APIs. Lo que cambia es como se LEEN y se
 *     MUESTRAN: `documentKindLabel()` traduce el tipo guardado, `volumeLiters()` entiende
 *     las dos unidades y las etiquetas salen de aqui.
 */

export type MarketId = 'CL' | 'CO';

/** Una clase de licencia de conducir con su etiqueta tal como se muestra. */
export interface MarketLicenseClass {
  value: string;
  label: string;
}

/** Fila de la demo del mercado (flota + region), para que el seed no invente un pais. */
export interface MarketDemoFleet {
  name: string;
  region: string;
}

/** Geocerca de la demo: nombre, poligono "lat,lng lat,lng ..." y comportamiento de alerta. */
export interface MarketDemoGeofence {
  name: string;
  polygon: string;
  type: string;
  alertOnEnter: boolean;
  alertOnExit: boolean;
}

/**
 * Centro y zoom por defecto de los mapas cuando no hay datos que encuadrar (la flota chilena
 * todavia no emite telemetria). Antes eran constantes de Bogota repartidas por LiveMap, el
 * mapa y el editor de geocercas y el simulador OBD2.
 */
export interface MarketMapCenter {
  lat: number;
  lng: number;
  /** Zoom de vista de region (el que usaba el mapa de geocercas de Bogota). */
  zoom: number;
}

export interface MarketConfig {
  id: MarketId;
  /** Nombre del mercado, para mensajes y documentacion. */
  label: string;
  /** Locale BCP-47 de TODOS los formateadores de la interfaz. */
  locale: string;
  /** Codigo ISO 4217 de la moneda. */
  currency: string;
  /** Decimales de la moneda (CLP no usa; COP tampoco). */
  currencyDecimals: number;

  /** Unidad de distancia. */
  distanceUnit: string;
  /** Unidad de volumen de combustible tal como se escribe junto al numero. */
  volumeUnit: string;
  /** Nombre del volumen para etiquetas y encabezados ("Litros"). */
  volumeUnitName: string;
  volumeDecimals: number;
  /** Unidad de rendimiento ("km/L"). */
  efficiencyUnit: string;
  /** Encabezado corto de la columna de rendimiento ("Km/L"). */
  efficiencyColumn: string;
  /** Frase de ayuda del rendimiento ("rendimiento km/L"). */
  efficiencyHelp: string;

  /** Como se llama la identificacion del vehiculo: "Patente" en Chile, "Placa" en Colombia. */
  vehicleIdLabel: string;
  vehicleIdPlaceholder: string;
  vehicleIdHelp: string;

  /** Como se llama la identificacion del conductor: "RUT" en Chile, "Cedula" en Colombia. */
  driverIdLabel: string;
  driverIdPlaceholder: string;
  driverIdHelp: string;

  /** Clases de licencia que ofrece el desplegable. */
  licenseClasses: readonly MarketLicenseClass[];
  /** Clase profesional tipica de un camion de carga (la que usa la demo y las alertas). */
  truckLicenseClass: string;

  /** Documentos obligatorios del vehiculo, en el vocabulario de este mercado. */
  documentKinds: readonly string[];
  /** Ejemplos del campo "tipo de documento". */
  documentTypesHint: string;
  /** Subtitulo de la pagina de documentos. */
  documentSubtitle: string;
  /**
   * Traduccion de los tipos guardados (incluidos los heredados del otro mercado) a la
   * etiqueta visible. La clave va normalizada (minusculas, sin tildes).
   */
  documentKindAliases: Readonly<Record<string, string>>;

  /** Ejemplos de relleno, para no poner una ciudad ni una estacion de otro pais. */
  fuelStationPlaceholder: string;
  cityPlaceholder: string;
  workshopPlaceholder: string;

  /** Datos de la demo del seed generico (lib/fleetSeed.ts). */
  demoFleets: readonly MarketDemoFleet[];
  demoFuelStations: readonly string[];
  /** Geocercas de la demo, con coordenadas coherentes con las ciudades de `demoFleets`. */
  demoGeofences: readonly MarketDemoGeofence[];
  /** Prefijo telefonico del mercado (para los telefonos ficticios de la demo). */
  phonePrefix: string;
  /** Puntos de paso de la demo del copiloto AUI (components/AuiInterface.svelte). */
  demoCheckpoints: readonly string[];

  /** Centro y zoom de los mapas cuando no hay nada que encuadrar. */
  mapCenter: MarketMapCenter;
  /**
   * Terminos que cambian de nombre entre mercados en los textos que se escriben UNA sola vez y
   * no se pueden reescribir campo a campo: prosa de la portada, nombres de modelo del
   * fabricante ("T800 Volqueta"), repuestos y etiquetas del catalogo. La clave es la forma
   * escrita en el dato, del plural largo al singular corto, para no dejar restos. Ver
   * `localizeText`.
   */
  vocabulary: Readonly<Record<string, string>>;
}

/**
 * Chile — mercado por defecto de esta entrega (flota de camiones tolva, mineria y
 * construccion, Calama/Antofagasta). CLP no usa decimales. Las licencias son las clases
 * profesionales de la Ley 18.290 art. 12 (Ley 19.495): A1-A3 transporte de personas, A4 carga
 * simple de mas de 3.500 kg y **A5 toda carga, simple o articulada** (cubre la tolva); B a F no profesionales.
 */
const CL: MarketConfig = {
  id: 'CL',
  label: 'Chile',
  locale: 'es-CL',
  currency: 'CLP',
  currencyDecimals: 0,

  distanceUnit: 'km',
  volumeUnit: 'L',
  volumeUnitName: 'Litros',
  volumeDecimals: 1,
  efficiencyUnit: 'km/L',
  efficiencyColumn: 'Km/L',
  efficiencyHelp: 'rendimiento km/L',

  vehicleIdLabel: 'Patente',
  vehicleIdPlaceholder: 'ABCD-12',
  vehicleIdHelp: 'Patente chilena actual ABCD-12 (o antigua AB-1234). En maquinaria es opcional.',

  driverIdLabel: 'RUT',
  driverIdPlaceholder: '12.345.678-9',
  driverIdHelp: 'RUT con digito verificador (modulo 11).',

  licenseClasses: [
    { value: 'A1', label: 'A1 — Taxis' },
    { value: 'A2', label: 'A2 — Taxis, ambulancias y transporte de personas (10 a 17 asientos)' },
    { value: 'A3', label: 'A3 — Taxis, buses y transporte de personas sin límite de asientos' },
    { value: 'A4', label: 'A4 — Vehículos de carga simple de más de 3.500 kg' },
    { value: 'A5', label: 'A5 — Todo vehículo de carga, simple o articulado (tracto-camión, tolva)' },
    { value: 'B', label: 'B — Particulares: hasta 9 asientos o carga hasta 3.500 kg' },
    { value: 'C', label: 'C — Motocicletas y vehículos motorizados de dos o tres ruedas' },
    { value: 'D', label: 'D — Maquinaria automotriz (tractores, grúas, retroexcavadoras)' },
    { value: 'E', label: 'E — Vehículos de tracción animal' },
    { value: 'F', label: 'F — Vehículos de Carabineros, FF.AA., PDI y Bomberos' },
  ],
  truckLicenseClass: 'A5',

  documentKinds: ['SOAP', 'Revisión Técnica (PRT)', 'Permiso de Circulación', 'Póliza de seguro'],
  documentTypesHint: 'SOAP, Revisión Técnica (PRT), Permiso de Circulación, Póliza…',
  documentSubtitle: 'SOAP, revisión técnica y permiso de circulación',
  documentKindAliases: {
    soap: 'SOAP',
    soat: 'SOAP',
    'revision tecnica': 'Revisión Técnica (PRT)',
    'revision tecnica prt': 'Revisión Técnica (PRT)',
    tecnomecanica: 'Revisión Técnica (PRT)',
    tecno: 'Revisión Técnica (PRT)',
    prt: 'Revisión Técnica (PRT)',
    'permiso de circulacion': 'Permiso de Circulación',
    'tarjeta de propiedad': 'Permiso de Circulación',
    'poliza de seguro': 'Póliza de seguro',
    'poliza todo riesgo': 'Póliza de seguro',
    poliza: 'Póliza de seguro',
  },

  fuelStationPlaceholder: 'Copec Calama',
  cityPlaceholder: 'p. ej. Antofagasta',
  workshopPlaceholder: 'Taller Calama',

  demoFleets: [
    { name: 'Antofagasta Norte', region: 'Antofagasta' },
    { name: 'Calama Faena', region: 'El Loa' },
    { name: 'Copiapó Logística', region: 'Atacama' },
  ],
  demoFuelStations: ['Copec', 'Shell', 'Petrobras'],
  demoGeofences: [
    {
      name: 'Centro de Distribución Antofagasta',
      polygon: '-23.6500,-70.4000 -23.6600,-70.4000 -23.6600,-70.4100 -23.6500,-70.4100',
      type: 'depot',
      alertOnEnter: false,
      alertOnExit: true,
    },
    {
      name: 'Cliente Norte - Faena Calama',
      polygon: '-22.4700,-68.9200 -22.4800,-68.9200 -22.4800,-68.9300 -22.4700,-68.9300',
      type: 'client',
      alertOnEnter: true,
      alertOnExit: false,
    },
    {
      name: 'Taller Autorizado Copiapó',
      polygon: '-27.3600,-70.3300 -27.3700,-70.3300 -27.3700,-70.3400 -27.3600,-70.3400',
      type: 'service',
      alertOnEnter: true,
      alertOnExit: false,
    },
    {
      name: 'Puerto de Mejillones',
      polygon: '-23.1000,-70.4400 -23.1100,-70.4400 -23.1100,-70.4500 -23.1000,-70.4500',
      type: 'port',
      alertOnEnter: true,
      alertOnExit: true,
    },
  ],
  phonePrefix: '+56 9',
  demoCheckpoints: ['Faena Mina Sur', 'Patio La Negra', 'Ruta 25 km 45', 'Base Logística Calama'],
  // Antofagasta, la base de la flota demo. El mismo punto de `demoGeofences[0]`.
  mapCenter: { lat: -23.65, lng: -70.4, zoom: 6 },
  // En Chile el camion de volco es "tolva" (o "camion tolva"), no "volqueta".
  vocabulary: {
    Volquetas: 'Tolvas',
    volquetas: 'tolvas',
    Volqueta: 'Tolva',
    volqueta: 'tolva',
  },
};

/**
 * Colombia — mercado de origen de la app. Se conserva completo para que el cambio de pais
 * sea una variable de entorno y no un reemplazo: los tests comprueban los dos.
 */
const CO: MarketConfig = {
  id: 'CO',
  label: 'Colombia',
  locale: 'es-CO',
  currency: 'COP',
  currencyDecimals: 0,

  distanceUnit: 'km',
  volumeUnit: 'gal',
  volumeUnitName: 'Galones',
  volumeDecimals: 1,
  efficiencyUnit: 'km/gal',
  efficiencyColumn: 'Km/Gal',
  efficiencyHelp: 'rendimiento km/galón',

  vehicleIdLabel: 'Placa',
  vehicleIdPlaceholder: 'ABC123',
  vehicleIdHelp: 'Placa colombiana ABC123 (carro), ABC12D (moto) o Mercosur ABC1D23.',

  driverIdLabel: 'Cédula',
  driverIdPlaceholder: '79.456.123',
  driverIdHelp: 'Cédula de ciudadanía.',

  licenseClasses: [
    { value: 'A1', label: 'A1 — Motos' },
    { value: 'B1', label: 'B1 — Carros' },
    { value: 'B2', label: 'B2 — Camionetas' },
    { value: 'C1', label: 'C1 — Camiones livianos' },
    { value: 'C2', label: 'C2 — Camiones pesados' },
    { value: 'C3', label: 'C3 — Tractocamiones' },
    { value: 'E1', label: 'E1 — Remolques' },
    { value: 'E2', label: 'E2 — Semirremolques' },
  ],
  truckLicenseClass: 'C2',

  documentKinds: ['SOAT', 'Tecnomecánica', 'Tarjeta de propiedad', 'Póliza todo riesgo'],
  documentTypesHint: 'SOAT, Tecnomecánica, Póliza, Tarjeta de propiedad…',
  documentSubtitle: 'SOAT, tecnomecánica, pólizas y más',
  documentKindAliases: {
    soat: 'SOAT',
    soap: 'SOAT',
    tecnomecanica: 'Tecnomecánica',
    'revision tecnica': 'Tecnomecánica',
    'revision tecnica prt': 'Tecnomecánica',
    tecno: 'Tecnomecánica',
    prt: 'Tecnomecánica',
    'tarjeta de propiedad': 'Tarjeta de propiedad',
    'permiso de circulacion': 'Tarjeta de propiedad',
    'poliza de seguro': 'Póliza todo riesgo',
    'poliza todo riesgo': 'Póliza todo riesgo',
    poliza: 'Póliza todo riesgo',
  },

  fuelStationPlaceholder: 'Terpel Av. El Dorado',
  cityPlaceholder: 'p. ej. Bogotá',
  workshopPlaceholder: 'Talleres del Norte',

  demoFleets: [
    { name: 'Bogotá Norte', region: 'Bogotá D.C.' },
    { name: 'Medellín Sur', region: 'Antioquia' },
    { name: 'Cali Logística', region: 'Valle del Cauca' },
  ],
  demoFuelStations: ['Terpel', 'Primax', 'Mobil'],
  demoGeofences: [
    {
      name: 'Centro de Distribución Bogotá',
      polygon: '4.7110,-74.0721 4.6510,-74.0721 4.6510,-74.1421 4.7110,-74.1421',
      type: 'depot',
      alertOnEnter: false,
      alertOnExit: true,
    },
    {
      name: 'Cliente Norte - Centro Comercial',
      polygon: '4.7350,-74.0500 4.7250,-74.0500 4.7250,-74.0400 4.7350,-74.0400',
      type: 'client',
      alertOnEnter: true,
      alertOnExit: false,
    },
    {
      name: 'Taller Autorizado Medellín',
      polygon: '6.2476,-75.5658 6.2376,-75.5658 6.2376,-75.5758 6.2476,-75.5758',
      type: 'service',
      alertOnEnter: true,
      alertOnExit: false,
    },
    {
      name: 'Puerto de Buenaventura',
      polygon: '3.8801,-77.0311 3.8601,-77.0311 3.8601,-77.0511 3.8801,-77.0511',
      type: 'port',
      alertOnEnter: true,
      alertOnExit: true,
    },
  ],
  phonePrefix: '+57',
  demoCheckpoints: ['Km 45 Vía al Mar', 'Base Logística Norte', 'Taller Central'],
  // Bogota, el centro que ya usaban los mapas de la app en Colombia.
  mapCenter: { lat: 4.6097, lng: -74.0817, zoom: 6 },
  // Colombia es el mercado donde estos terminos nacieron: nada que traducir.
  vocabulary: {},
};

export const MARKETS: Readonly<Record<MarketId, MarketConfig>> = { CL, CO };

/** Mercado por defecto cuando no hay configuracion: el de esta entrega. */
export const DEFAULT_MARKET_ID: MarketId = 'CL';

/** Normaliza un valor de entorno a un `MarketId` conocido. Sin dato, Chile. */
export function resolveMarketId(raw?: unknown): MarketId {
  let value = raw;
  if (value === undefined || value === null) {
    try {
      // Acceso ESTATICO a import.meta.env (Vite lo reescribe en SSR y en el bundle del
      // cliente). El acceso dinamico revienta el stream SSR en workerd.
      value = (import.meta as unknown as { env?: Record<string, string | undefined> }).env
        ?.PUBLIC_MARKET;
    } catch {
      /* sin import.meta.env: seguimos con process.env */
    }
  }
  if ((value === undefined || value === null) && typeof process !== 'undefined') {
    value = process.env?.PUBLIC_MARKET ?? process.env?.MARKET;
  }
  const v = String(value ?? '')
    .trim()
    .toUpperCase();
  if (v === 'CO' || v === 'COL' || v === 'COLOMBIA' || v === 'ES-CO') return 'CO';
  return DEFAULT_MARKET_ID;
}

/** Mercado por id, con Chile por defecto si el id no se reconoce. */
export function marketFor(id?: unknown): MarketConfig {
  return MARKETS[resolveMarketId(id)];
}

/** Mercado activo de la app. Todo lo que se muestra sale de aqui. */
export const MARKET: MarketConfig = marketFor();

/**
 * Ejemplo de poligono de geocerca del mercado: el de su primera geocerca demo. Es el que usan
 * la ayuda del formulario y el editor para no proponer coordenadas de otro pais.
 */
export function demoPolygon(market: MarketConfig = MARKET): string {
  return market.demoGeofences[0]?.polygon ?? '';
}

/**
 * Reemplaza el vocabulario del mercado en un texto escrito una sola vez (prosa de la portada,
 * nombres de modelo del fabricante, repuestos). Las claves de `vocabulary` van del plural largo
 * al singular corto: "Volquetas" se sustituye antes que "Volqueta" y no queda ningun resto.
 * Un mercado sin vocabulario (Colombia) devuelve el texto tal cual: no se inventa nada.
 */
export function localizeText(text: string, market: MarketConfig = MARKET): string {
  let out = text;
  for (const [from, to] of Object.entries(market.vocabulary)) {
    if (from === to || from === '') continue;
    out = out.split(from).join(to);
  }
  return out;
}

// ── Formateadores ─────────────────────────────────────────────────────────────
// Todos reciben el mercado como ultimo parametro (por defecto el activo) para que los
// tests puedan comprobar los dos sin depender del entorno.

const numberCache = new Map<string, Intl.NumberFormat>();

function numberFormat(locale: string, digits: number): Intl.NumberFormat {
  const key = `${locale}|${digits}`;
  let nf = numberCache.get(key);
  if (!nf) {
    nf = new Intl.NumberFormat(locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    numberCache.set(key, nf);
  }
  return nf;
}

/** Numero con los separadores del mercado. `28450` -> "28.450" en es-CL y es-CO. */
export function formatNumber(
  value: number | undefined | null,
  market: MarketConfig = MARKET,
): string {
  if (value === undefined || value === null || Number.isNaN(value)) return '—';
  return numberFormat(market.locale, 0).format(value);
}

/** Numero con decimales fijos (para volumen y rendimiento). */
export function formatDecimal(
  value: number | undefined | null,
  digits = 1,
  market: MarketConfig = MARKET,
): string {
  if (value === undefined || value === null || Number.isNaN(value)) return '—';
  return numberFormat(market.locale, digits).format(value);
}

/**
 * Monto en la moneda del mercado. CLP no lleva decimales: `186000` -> "$186.000".
 * El signo negativo es el menos matematico, igual que el resto de la interfaz.
 */
export function formatMoney(
  amount: number | undefined | null,
  market: MarketConfig = MARKET,
): string {
  if (amount === undefined || amount === null || Number.isNaN(amount)) return '—';
  const abs = numberFormat(market.locale, market.currencyDecimals).format(Math.abs(amount));
  return `${amount < 0 ? '−$' : '$'}${abs}`;
}

/** Fecha corta del mercado ("17 oct 2026"). Cadena vacia si no es una fecha valida. */
export function formatDate(
  value: string | Date | undefined | null,
  market: MarketConfig = MARKET,
): string {
  const date = toDate(value);
  if (!date) return '—';
  return new Intl.DateTimeFormat(market.locale, { dateStyle: 'medium' }).format(date);
}

/** Fecha y hora del mercado (avisos y bitacoras). */
export function formatDateTime(
  value: string | Date | undefined | null,
  market: MarketConfig = MARKET,
): string {
  const date = toDate(value);
  if (!date) return '—';
  return new Intl.DateTimeFormat(market.locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
    date,
  );
}

/** Mes y ano del mercado ("octubre de 2026"), para el calendario de mantenimiento. */
export function formatMonthYear(date: Date, market: MarketConfig = MARKET): string {
  return new Intl.DateTimeFormat(market.locale, { month: 'long', year: 'numeric' }).format(date);
}

/**
 * Volumen de combustible con su unidad: `1234.5` -> "1.234,5 L" en Chile.
 * Acepta el valor en la unidad del mercado; para leer un registro guardado en la otra
 * unidad, pasa antes por `volumeLiters`.
 */
export function formatVolume(
  value: number | undefined | null,
  market: MarketConfig = MARKET,
): string {
  if (value === undefined || value === null || Number.isNaN(value)) return '—';
  return `${formatDecimal(value, market.volumeDecimals, market)} ${market.volumeUnit}`;
}

/**
 * Rendimiento con su unidad: `6.5` -> "6,5 km/L" en Chile.
 * Acepta el rendimiento en distancia por unidad de volumen del mercado.
 */
export function formatEfficiency(
  value: number | undefined | null,
  market: MarketConfig = MARKET,
): string {
  if (value === undefined || value === null || Number.isNaN(value)) return '—';
  return `${formatDecimal(value, 1, market)} ${market.efficiencyUnit}`;
}

function toDate(value: string | Date | undefined | null): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// ── Unidades guardadas ────────────────────────────────────────────────────────

/** 1 galon US en litros. */
export const LITERS_PER_GALLON = 3.785411784;

/**
 * Litros de un registro de combustible, venga como venga.
 *
 * El modelo guarda `gallons` (asi nacio la app) y la semilla chilena guarda ademas `liters`.
 * La interfaz no tiene que saber cual de los dos trae la fila: si hay litros, esos; si no,
 * se convierten los galones. `null` cuando no hay ninguna de las dos.
 */
export function volumeLiters(row: { liters?: unknown; gallons?: unknown }): number | null {
  const liters = Number(row.liters);
  if (Number.isFinite(liters)) return liters;
  const gallons = Number(row.gallons);
  if (Number.isFinite(gallons)) return gallons * LITERS_PER_GALLON;
  return null;
}

/**
 * Valor del campo de volumen que se debe guardar para el mercado activo.
 * Chile guarda litros; Colombia guarda galones. Devuelve las dos formas para poder
 * escribir la fila sin perder compatibilidad con los datos anteriores.
 */
export function volumeFieldsFor(
  value: number,
  market: MarketConfig = MARKET,
): { liters: number; gallons: number } {
  if (market.volumeUnit === 'L') {
    const liters = Math.round(value * 100) / 100;
    return { liters, gallons: Math.round((liters / LITERS_PER_GALLON) * 100) / 100 };
  }
  const gallons = Math.round(value * 100) / 100;
  return { liters: Math.round(gallons * LITERS_PER_GALLON * 100) / 100, gallons };
}

/** Rendimiento en la unidad del mercado a partir de km/L. */
export function efficiencyFor(
  kmPerLiter: number | null,
  market: MarketConfig = MARKET,
): number | null {
  if (kmPerLiter === null || !Number.isFinite(kmPerLiter)) return null;
  return market.volumeUnit === 'L' ? kmPerLiter : kmPerLiter * LITERS_PER_GALLON;
}

// ── Vocabulario legal ─────────────────────────────────────────────────────────

/** Clave de comparacion de un tipo de documento: minusculas, sin tildes, espacios simples. */
export function normalizeKindKey(kind: string): string {
  return kind
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Etiqueta visible de un tipo de documento guardado, en el vocabulario del mercado.
 *
 * El modelo de datos no cambia (las filas siguen diciendo 'SOAT' o 'Tecnomecánica'); lo que
 * cambia es como se lee. Un tipo que no este en el mapa se muestra tal cual: nunca se inventa.
 */
export function documentKindLabel(kind: unknown, market: MarketConfig = MARKET): string {
  if (typeof kind !== 'string' || kind.trim() === '') return '—';
  const raw = kind.trim();
  return market.documentKindAliases[normalizeKindKey(raw)] ?? raw;
}
