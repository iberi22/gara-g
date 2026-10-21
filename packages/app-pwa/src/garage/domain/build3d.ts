/**
 * build3d.ts — Armado 3D por vehiculo: saneo de lo guardado en la fila y aplicacion sobre
 * la spec base. Lo guardado es input no confiable (importadores, formularios): todo lo
 * invalido se descarta en silencio, nunca lanza. La pintura jamas se toca aqui.
 */
import type {
  BodyType,
  TireSize,
  VehicleBuild3d,
  VehicleDimensions,
  VehicleFamily,
  VehicleSpec,
} from '../contracts';
import type { VehicleType } from '../../lib/vehicleCatalog';
import { defaultSpec, getTemplate, TEMPLATES } from '../templates/registry';

type Range = { min: number; max: number };
type DimKey = 'lengthMm' | 'widthMm' | 'heightMm' | 'wheelbaseMm';

/** Rangos plausibles (mm) por familia. */
export const FAMILY_DIM_RANGES: Record<VehicleFamily, Record<DimKey, Range>> = {
  moto: {
    lengthMm: { min: 1500, max: 2700 },
    widthMm: { min: 500, max: 1100 },
    heightMm: { min: 800, max: 1700 },
    wheelbaseMm: { min: 1000, max: 1800 },
  },
  car: {
    lengthMm: { min: 2800, max: 5900 },
    widthMm: { min: 1400, max: 2200 },
    heightMm: { min: 1100, max: 2200 },
    wheelbaseMm: { min: 1800, max: 3800 },
  },
  heavy: {
    lengthMm: { min: 4500, max: 20000 },
    widthMm: { min: 1800, max: 2600 },
    heightMm: { min: 2000, max: 4500 },
    wheelbaseMm: { min: 2500, max: 9000 },
  },
  machinery: {
    lengthMm: { min: 3000, max: 12000 },
    widthMm: { min: 1500, max: 4500 },
    heightMm: { min: 1800, max: 4500 },
    wheelbaseMm: { min: 1000, max: 6500 },
  },
};

const DIM_KEYS = Object.keys(FAMILY_DIM_RANGES.car) as DimKey[];

const isRec = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const KNOWN_BODIES = new Set<string>(TEMPLATES.map((t) => t.body));

function cleanTire(raw: unknown): TireSize | undefined {
  if (!isRec(raw)) return undefined;
  const { widthMm, aspectPct, rimIn } = raw;
  if (!fin(widthMm) || !fin(aspectPct) || !fin(rimIn)) return undefined;
  if (widthMm < 60 || widthMm > 450) return undefined;
  if (aspectPct < 25 || aspectPct > 110) return undefined;
  if (rimIn < 8 || rimIn > 24.5) return undefined;
  return { widthMm, aspectPct, rimIn };
}

export function sanitizeBuild3d(raw: unknown, family: VehicleFamily): VehicleBuild3d | undefined {
  if (!isRec(raw) || raw.v !== 1) return undefined;
  const out: VehicleBuild3d = { v: 1 };

  if (typeof raw.body === 'string' && KNOWN_BODIES.has(raw.body)) out.body = raw.body as BodyType;

  if (isRec(raw.dims)) {
    const dims: Partial<VehicleDimensions> = {};
    for (const k of DIM_KEYS) {
      const v = raw.dims[k];
      const r = FAMILY_DIM_RANGES[family][k];
      if (fin(v) && v >= r.min && v <= r.max) dims[k] = v;
    }
    if (dims.wheelbaseMm !== undefined && dims.lengthMm !== undefined && dims.wheelbaseMm >= dims.lengthMm) {
      dims.wheelbaseMm = undefined;
    }
    for (const k of DIM_KEYS) if (dims[k] === undefined) delete dims[k];
    if (Object.keys(dims).length) out.dims = dims;
  }

  const tf = cleanTire(raw.tireFront);
  if (tf) out.tireFront = tf;
  const tr = cleanTire(raw.tireRear);
  if (tr) out.tireRear = tr;

  if (isRec(raw.shape)) {
    const shape: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw.shape)) if (fin(v)) shape[k] = Math.min(1, Math.max(0, v));
    if (Object.keys(shape).length) out.shape = shape;
  }

  if (isRec(raw.variants)) {
    const variants: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw.variants)) if (typeof v === 'string') variants[k] = v;
    if (Object.keys(variants).length) out.variants = variants;
  }

  return Object.keys(out).length > 1 ? out : undefined;
}

const sameDims = (a: VehicleDimensions, b: VehicleDimensions): boolean =>
  JSON.stringify(a, Object.keys(a).sort()) === JSON.stringify(b, Object.keys(b).sort());

export function applyBuild3d(base: VehicleSpec, b?: VehicleBuild3d): VehicleSpec {
  if (!b) return base;
  let spec: VehicleSpec = { ...base };

  if (b.body && b.body !== base.body) {
    const t = getTemplate(b.body);
    if (t.body === b.body && t.family === base.family) {
      const fromDefaults = sameDims(base.dims, defaultSpec(base.body, base.family).dims);
      spec.body = b.body;
      if (fromDefaults) {
        const d = defaultSpec(b.body, base.family);
        spec = { ...spec, dims: d.dims, tireFront: d.tireFront, tireRear: d.tireRear };
      }
    }
  }

  if (b.dims) spec.dims = { ...spec.dims, ...b.dims };
  if (b.tireFront) spec.tireFront = { ...b.tireFront };
  if (b.tireRear) spec.tireRear = { ...b.tireRear };

  const t = getTemplate(spec.body, spec.family);
  if (b.shape) {
    const ids = new Set(t.shapeParams.map((p) => p.id));
    const shape: Record<string, number> = { ...spec.shape };
    for (const [k, v] of Object.entries(b.shape)) if (ids.has(k)) shape[k] = v;
    if (Object.keys(shape).length) spec.shape = shape;
  }
  if (b.variants) {
    const variants: Record<string, string> = { ...spec.variants };
    for (const [slot, v] of Object.entries(b.variants)) if (t.variants[slot]?.includes(v)) variants[slot] = v;
    if (Object.keys(variants).length) spec.variants = variants;
  }
  return spec;
}

/** Tipo del catalogo que corresponde a una carroceria (inverso de bodyForCatalogType). */
export function catalogTypeForBody(family: VehicleFamily, body: BodyType): VehicleType {
  switch (body) {
    case 'sedan':
    case 'hatchback':
      return 'sedan';
    case 'suv':
      return 'suv';
    case 'pickup':
      return 'pickup';
    case 'van':
      return 'van';
    case 'naked':
    case 'sport':
    case 'scooter':
    case 'trail':
      return 'moto';
    case 'truck':
      return 'camion';
    case 'flatbed':
      return 'estacas';
    case 'dump':
      return 'volqueta';
    case 'tractor':
      return 'tractomula';
    case 'excavator':
      return 'excavadora';
    case 'backhoe':
      return 'retroexcavadora';
    case 'wheel_loader':
      return 'cargador';
    case 'dozer':
      return 'bulldozer';
    case 'grader':
      return 'motoniveladora';
    case 'roller':
      return 'vibrocompactador';
    default:
      return family === 'moto' ? 'moto' : 'sedan';
  }
}
