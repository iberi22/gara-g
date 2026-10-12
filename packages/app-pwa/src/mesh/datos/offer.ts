/**
 * offer.ts — La oferta de un vendedor (taller, repuestos, aseguradora, lubricentro,
 * llanteria) y su validacion estricta.
 *
 * Por que estricta: la oferta llega de un desconocido por la malla y se muestra en la
 * pantalla del dueno. `parseOffer` NUNCA devuelve el objeto recibido: reconstruye uno nuevo
 * solo con los campos conocidos, ya limpios y dentro de limites. Lo que sobra se ignora y lo
 * que no cabe se rechaza (no se trunca: una oferta cortada a medias engana).
 *
 * Alineacion con edge-mesh (`DataOffer` de namespaces/offers-gossip.ts): `id`, `title` y
 * `createdAt`/`active` tienen el mismo sentido (created_at, active); el vendedor
 * (`seller_node`) NO viaja en la oferta: es el `from` del mensaje, que solo es confiable si
 * `verified` (firma ML-DSA-65 contra el nodo). `offerTags` da el equivalente de `tags`.
 * `license`, `content_hash` y `size` son de datasets y no aplican a una oferta de servicio;
 * M1 los rellena al mapear si hace falta.
 *
 * GARA-G NO es una pasarela de pagos: no cobra, no retiene ni liquida nada entre clientes y
 * prestadores; solo los conecta. El pago se acuerda directamente (`contact`: como llegar al
 * prestador) o con el token de la red SWAL (`acceptsSwalToken`: solo un aviso del prestador).
 * `payoutGara` es un campo heredado de ofertas viejas: se sigue leyendo para no rechazarlas,
 * pero ya no se publica, ni se muestra, ni pesa en el emparejamiento.
 */
import { isRegionCell } from './topics';

export const OFFER_CATEGORIES = ['taller', 'repuestos', 'aseguradora', 'lubricentro', 'llanteria'] as const;
export type OfferCategory = (typeof OFFER_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<OfferCategory, string> = {
  taller: 'Taller',
  repuestos: 'Repuestos',
  aseguradora: 'Aseguradora',
  lubricentro: 'Lubricentro',
  llanteria: 'Llantería',
};

/** Aviso fijo del mercado (decision del dueno de GARA-G, 2026-10-03). Va en /fleet/mercado y /fleet/mercado/vender. */
export const PAYMENTS_NOTICE =
  'GARA-G no cobra ni procesa pagos entre clientes y prestadores: los conecta. El pago se acuerda directamente o con el token de la red SWAL.';

export const VEHICLE_CLASSES = ['moto', 'liviano', 'pesado', 'maquinaria'] as const;
export type VehicleClass = (typeof VEHICLE_CLASSES)[number];

export const CLASS_LABELS: Record<VehicleClass, string> = {
  moto: 'moto',
  liviano: 'vehículo liviano',
  pesado: 'camión o vehículo pesado',
  maquinaria: 'maquinaria',
};

/** Lo que un vehiculo puede necesitar pronto. Es el vocabulario comun de oferta y demanda. */
export const NEED_KEYS = ['aceite', 'llantas', 'frenos', 'bateria', 'filtros', 'seguro', 'revision'] as const;
export type NeedKey = (typeof NEED_KEYS)[number];

export const NEED_LABELS: Record<NeedKey, string> = {
  aceite: 'Cambio de aceite',
  llantas: 'Llantas',
  frenos: 'Frenos',
  bateria: 'Batería',
  filtros: 'Filtros',
  seguro: 'Seguro / SOAT',
  revision: 'Revisión general',
};

/** Que categoria de vendedor atiende cada necesidad (la primera es la principal). */
export const NEED_CATEGORIES: Record<NeedKey, OfferCategory[]> = {
  aceite: ['lubricentro', 'taller'],
  llantas: ['llanteria', 'taller'],
  frenos: ['taller', 'repuestos'],
  bateria: ['repuestos', 'taller'],
  filtros: ['lubricentro', 'repuestos', 'taller'],
  seguro: ['aseguradora'],
  revision: ['taller'],
};

// --- Limites ---------------------------------------------------------------

export const LIMITS = {
  /** Tamano maximo del JSON de la oferta. Una oferta de servicio no necesita mas. */
  maxBytes: 4096,
  idMin: 8,
  idMax: 64,
  vendor: 60,
  title: 80,
  description: 500,
  listItems: 20,
  listItem: 40,
  maxRadiusKm: 200,
  maxPriceCop: 1_000_000_000,
  maxPayoutGara: 1_000_000,
  /** Largo maximo del contacto (enlace https, tel: o wa.me). */
  contact: 200,
  /** Una oferta vive como mucho 90 dias: lo que dura mas es spam o se olvida. */
  maxDurationMs: 90 * 24 * 60 * 60 * 1000,
  minYear: 1950,
  maxYear: 2100,
  maxWithinKm: 100_000,
} as const;

export interface OfferTarget {
  /** Vacio = cualquier clase. Lo mismo para marcas y modelos. */
  classes: VehicleClass[];
  brands: string[];
  models: string[];
  years?: { from: number; to: number };
  /** Ventana de uso: "aceite a los 5 000 km" = la necesidad vence en <= withinKm (o ya vencio). */
  need?: NeedKey;
  withinKm?: number;
  /** Rango de odometro del vehiculo (solo vehiculos en km). */
  odometer?: { min: number; max: number };
}

export interface VendorOffer {
  id: string;
  vendor: string;
  category: OfferCategory;
  title: string;
  description: string;
  /** Precio en COP, entero. */
  priceCop?: number;
  /** Descuento 1..100. */
  discountPct?: number;
  target: OfferTarget;
  /** Celda p4 donde atiende, y hasta cuantos km a la redonda. */
  region: string;
  radiusKm: number;
  validFrom: number;
  validUntil: number;
  createdAt: number;
  /** Como acordar con el prestador: `https://...`, `tel:+57...` o `https://wa.me/57...`. Ver `parseContact`. */
  contact?: string;
  /** El prestador dice que acepta el token de la red SWAL. Solo un aviso: GARA-G no lo verifica ni lo procesa. */
  acceptsSwalToken?: boolean;
  /** @deprecated Heredado: se acepta al leer ofertas viejas pero no se publica ni se muestra. */
  payoutGara?: number;
  /** false = el vendedor la retiro (misma id, mismo emisor). */
  active: boolean;
}

export interface OfferEnvelope {
  v: 1;
  offer: VendorOffer;
}

export type OfferError =
  | 'forma'
  | 'tamano'
  | 'id'
  | 'categoria'
  | 'texto'
  | 'precio'
  | 'contacto'
  | 'targeting'
  | 'region'
  | 'vigencia'
  | 'expirada';

export type ParseResult = { ok: true; offer: VendorOffer } | { ok: false; error: OfferError; detail?: string };

const fail = (error: OfferError, detail?: string): ParseResult => ({ ok: false, error, detail });

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Texto limpio: sin caracteres de control (salvo salto de linea), NFC, recortado. null si no es valido. */
function cleanText(v: unknown, max: number, min = 1): string | null {
  if (typeof v !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const s = v.normalize('NFC').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '').trim();
  return s.length >= min && s.length <= max ? s : null;
}

function intIn(v: unknown, min: number, max: number): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null;
}

function numIn(v: unknown, min: number, max: number): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null;
}

function stringList(v: unknown, fold: boolean): string[] | null {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > LIMITS.listItems) return null;
  const out: string[] = [];
  for (const item of v) {
    const s = cleanText(item, LIMITS.listItem);
    if (s === null) return null;
    const val = fold ? foldText(s) : s;
    if (!out.includes(val)) out.push(val);
  }
  return out;
}

export type ContactKind = 'whatsapp' | 'tel' | 'web';

export const CONTACT_KIND_LABELS: Record<ContactKind, string> = {
  whatsapp: 'WhatsApp',
  tel: 'Teléfono',
  web: 'Sitio web',
};

/**
 * Contacto del prestador, validado de forma estricta: llega firmado pero de un desconocido y
 * termina en un `href`. Solo se aceptan `https:` (sitio o wa.me), y `tel:` con digitos. Nada de
 * `javascript:`, `data:`, `http:` ni credenciales en la URL. Devuelve la forma canonica o null.
 */
export function parseContact(v: unknown): { value: string; kind: ContactKind } | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (s.length === 0 || s.length > LIMITS.contact) return null;
  // Cualquier espacio, caracter de control o comilla/angular se rechaza: no es una URL limpia.
  if (/[\s\u0000-\u001F\u007F"'<>\\`]/.test(s)) return null;

  if (/^tel:/i.test(s)) {
    const m = /^tel:(\+?)(\d{7,15})$/i.exec(s);
    return m ? { value: `tel:${m[1]}${m[2]}`, kind: 'tel' } : null;
  }
  if (!/^https:\/\//i.test(s)) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase();
  if (!host.includes('.') || host.endsWith('.')) return null;
  if (host === 'wa.me') {
    const m = /^\/(\d{7,15})\/?$/.exec(u.pathname);
    if (!m) return null;
    // Solo el numero: el texto prellenado (?text=) lo escribe el cliente, no el prestador.
    return { value: `https://wa.me/${m[1]}`, kind: 'whatsapp' };
  }
  return { value: u.href, kind: 'web' };
}

/** Minusculas sin acentos: "Hilux", "hilux" y "HILUX" son la misma marca/modelo. */
export function foldText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

function parseTarget(raw: unknown): OfferTarget | null {
  const t = raw === undefined ? {} : raw;
  if (!isObj(t)) return null;
  const classes: VehicleClass[] = [];
  if (t.classes !== undefined) {
    if (!Array.isArray(t.classes) || t.classes.length > VEHICLE_CLASSES.length) return null;
    for (const c of t.classes) {
      if (!(VEHICLE_CLASSES as readonly unknown[]).includes(c)) return null;
      if (!classes.includes(c as VehicleClass)) classes.push(c as VehicleClass);
    }
  }
  const brands = stringList(t.brands, true);
  const models = stringList(t.models, true);
  if (!brands || !models) return null;
  const out: OfferTarget = { classes, brands, models };

  if (t.years !== undefined) {
    if (!isObj(t.years)) return null;
    const from = intIn(t.years.from, LIMITS.minYear, LIMITS.maxYear);
    const to = intIn(t.years.to, LIMITS.minYear, LIMITS.maxYear);
    if (from === null || to === null || from > to) return null;
    out.years = { from, to };
  }
  if (t.need !== undefined) {
    if (!(NEED_KEYS as readonly unknown[]).includes(t.need)) return null;
    const within = intIn(t.withinKm, 0, LIMITS.maxWithinKm);
    if (within === null) return null;
    out.need = t.need as NeedKey;
    out.withinKm = within;
  } else if (t.withinKm !== undefined) {
    return null; // una ventana sin necesidad no significa nada
  }
  if (t.odometer !== undefined) {
    if (!isObj(t.odometer)) return null;
    const min = intIn(t.odometer.min, 0, 10_000_000);
    const max = intIn(t.odometer.max, 0, 10_000_000);
    if (min === null || max === null || min > max) return null;
    out.odometer = { min, max };
  }
  return out;
}

/**
 * Valida y normaliza una oferta recibida (o escrita por el vendedor). `now` es el reloj
 * del llamador: una oferta vencida se rechaza aqui, para que ni se guarde.
 */
export function parseOffer(raw: unknown, now: number): ParseResult {
  if (!isObj(raw)) return fail('forma');
  let size: number;
  try {
    size = new TextEncoder().encode(JSON.stringify(raw)).length;
  } catch {
    return fail('forma'); // referencia circular, BigInt...
  }
  if (size > LIMITS.maxBytes) return fail('tamano', `${size} bytes`);

  const id = cleanText(raw.id, LIMITS.idMax, LIMITS.idMin);
  if (id === null || !/^[A-Za-z0-9_-]+$/.test(id)) return fail('id');

  if (!(OFFER_CATEGORIES as readonly unknown[]).includes(raw.category)) return fail('categoria');
  const category = raw.category as OfferCategory;

  const vendor = cleanText(raw.vendor, LIMITS.vendor);
  const title = cleanText(raw.title, LIMITS.title, 3);
  const description = raw.description === undefined ? '' : cleanText(raw.description, LIMITS.description, 0);
  if (vendor === null || title === null || description === null) return fail('texto');

  let priceCop: number | undefined;
  if (raw.priceCop !== undefined) {
    const p = intIn(raw.priceCop, 0, LIMITS.maxPriceCop);
    if (p === null) return fail('precio', 'priceCop');
    priceCop = p;
  }
  let discountPct: number | undefined;
  if (raw.discountPct !== undefined) {
    const d = numIn(raw.discountPct, 1, 100);
    if (d === null) return fail('precio', 'discountPct');
    discountPct = d;
  }
  let payoutGara: number | undefined;
  if (raw.payoutGara !== undefined) {
    const g = numIn(raw.payoutGara, 0, LIMITS.maxPayoutGara);
    if (g === null) return fail('precio', 'payoutGara');
    payoutGara = g;
  }

  let contact: string | undefined;
  if (raw.contact !== undefined) {
    const c = parseContact(raw.contact);
    if (c === null) return fail('contacto');
    contact = c.value;
  }
  if (raw.acceptsSwalToken !== undefined && typeof raw.acceptsSwalToken !== 'boolean') return fail('forma', 'acceptsSwalToken');

  const target = parseTarget(raw.target);
  if (!target) return fail('targeting');

  if (!isRegionCell(raw.region)) return fail('region');
  const radiusKm = numIn(raw.radiusKm, 1, LIMITS.maxRadiusKm);
  if (radiusKm === null) return fail('region', 'radiusKm');

  const validFrom = intIn(raw.validFrom, 0, Number.MAX_SAFE_INTEGER);
  const validUntil = intIn(raw.validUntil, 0, Number.MAX_SAFE_INTEGER);
  const createdAt = intIn(raw.createdAt, 0, Number.MAX_SAFE_INTEGER);
  if (validFrom === null || validUntil === null || createdAt === null) return fail('vigencia');
  if (validUntil <= validFrom || validUntil - validFrom > LIMITS.maxDurationMs) return fail('vigencia');
  if (validUntil <= now) return fail('expirada');
  if (typeof raw.active !== 'boolean') return fail('forma', 'active');

  const offer: VendorOffer = {
    id,
    vendor,
    category,
    title,
    description,
    target,
    region: raw.region,
    radiusKm,
    validFrom,
    validUntil,
    createdAt,
    active: raw.active,
  };
  if (priceCop !== undefined) offer.priceCop = priceCop;
  if (discountPct !== undefined) offer.discountPct = discountPct;
  if (contact !== undefined) offer.contact = contact;
  if (raw.acceptsSwalToken === true) offer.acceptsSwalToken = true;
  if (payoutGara !== undefined) offer.payoutGara = payoutGara;
  return { ok: true, offer };
}

/** Etiquetas planas (equivalente a `DataOffer.tags` de edge-mesh) para que M1 mapee o busque. */
export function offerTags(o: VendorOffer): string[] {
  const tags: string[] = [`cat:${o.category}`];
  for (const c of o.target.classes) tags.push(`cls:${c}`);
  for (const b of o.target.brands) tags.push(`brand:${b}`);
  if (o.target.need) tags.push(`need:${o.target.need}`);
  return tags;
}

/** ¿Tiene alguna segmentacion de vehiculo? Sin ella la oferta es "general" para toda la ciudad. */
export function isTargeted(t: OfferTarget): boolean {
  return (
    t.classes.length > 0 || t.brands.length > 0 || t.models.length > 0 || !!t.years || !!t.need || !!t.odometer
  );
}

// --- Limitador de ritmo ------------------------------------------------------

/**
 * Ventana deslizante por clave. Sirve en las dos puntas: el vendedor no puede inundar la
 * sala (publicacion) y el receptor no se deja inundar por un nodo (recepcion), porque un
 * emisor malicioso se salta el limite del lado vendedor. Reloj inyectable.
 */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    private max: number,
    private windowMs: number,
    private now: () => number = () => Date.now(),
  ) {}

  /** true y cuenta el golpe si aun hay cupo; false si ya se paso. */
  allow(key: string): boolean {
    const t = this.now();
    const recent = (this.hits.get(key) ?? []).filter((x) => t - x < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(t);
    this.hits.set(key, recent);
    // Acota la memoria: un atacante con mil ids no debe crecer el mapa sin limite.
    if (this.hits.size > 2000) {
      for (const [k, v] of this.hits) if (v.every((x) => t - x >= this.windowMs)) this.hits.delete(k);
    }
    return true;
  }
}
