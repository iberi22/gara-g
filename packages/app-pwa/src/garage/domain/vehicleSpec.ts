import { type VehicleType, findModel, normalizeVehicleType } from '../../lib/vehicleCatalog';
/**
 * vehicleSpec.ts — Traduce la fila de `vehicle` a la `VehicleSpec` que consume el motor 3D.
 *
 * El usuario solo escribe marca, modelo y anio. La spec sale por este orden:
 *   1. Tabla de medidas por modelo (`specs/modelSpecs.ts`, con fuentes): es la ficha tecnica
 *      real y manda sobre cualquier valor por defecto.
 *   2. Tipo del catalogo (`bodyForCatalogType`) + medidas por defecto de la plantilla de
 *      esa carroceria (`defaultSpec` del registry): aproximacion razonable, sin inventar
 *      medidas concretas de un modelo.
 *   3. Si no hay ni marca ni modelo, moto naked: es lo unico que el registry siempre sabe
 *      construir.
 *
 * Pintura: si el vehiculo tiene `color`/`paint` se respeta (es eleccion del usuario); si
 * no, se elige un color de una paleta sobria por hash del id, de modo que el mismo
 * vehiculo siempre se ve igual y dos vehiculos del mismo tenant no salen del mismo tono.
 * El acabado se deduce del color: los oscuros van en `metallic`, los claros en `gloss`.
 */
import type { BodyType, PaintFinish, PaintSpec, VehicleFamily, VehicleSpec } from '../contracts';
import { findModelSpec } from '../specs/modelSpecs';
import { bodyForCatalogType, defaultSpec } from '../templates/registry';
import { applyBuild3d, sanitizeBuild3d } from './build3d';
import { type VehicleRow, normalizeText, num, str, tidy } from './records';

/** Paleta sobria: grises, azuletes y verdes apagados. Nada que parezca un logo. */
const PALETTE: readonly string[] = [
  '#3b4a5a',
  '#2f3b34',
  '#4a4a4a',
  '#5b5348',
  '#2c3e50',
  '#3d4c3f',
  '#6b7280',
  '#37474f',
];

/**
 * `vehicle.type` del seed es texto libre en espanol ('camioneta', 'camión', 'sedán') y no
 * siempre el `VehicleType` del catalogo. normalizeVehicleType() resuelve tildes y alias;
 * 'camioneta' se deja sin resolver a proposito: en Colombia lo mismo es una pickup que un
 * campero, y lo decide la marca/modelo del catalogo (con pickup como ultimo recurso).
 */
function catalogTypeOf(vehicle: VehicleRow): VehicleType | undefined {
  const raw = normalize(vehicle.type);
  if (raw.startsWith('camioneta')) return undefined;
  return normalizeVehicleType(raw) ?? normalizeVehicleType(raw.split(' ')[0]);
}

/** Sin tildes y en minusculas, para comparar el tipo de catalogo ('CAMION' ~ 'camion'). */
const normalize = (v: unknown): string => normalizeText(typeof v === 'string' ? v : '');

function hashInt(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/** Amarillo de obra: el color que se espera de la maquinaria si el usuario no eligio otro. */
const MACHINERY_PAINT = '#f2b200';

function paintFor(vehicle: VehicleRow, fallbackId: string, family?: VehicleFamily): PaintSpec {
  const own = str(vehicle.color) ?? str(vehicle.paint);
  const baseColor = own && /^#[0-9a-f]{6}$/i.test(own) ? own.toLowerCase() : undefined;
  if (baseColor) return { baseColor, finish: finishFor(baseColor) };
  if (family === 'machinery') return { baseColor: MACHINERY_PAINT, finish: 'gloss' };
  return { baseColor: PALETTE[hashInt(fallbackId) % PALETTE.length], finish: 'metallic' };
}

/**
 * Un oscuro se ve mejor en metalico y un claro en brillo. El umbral sale de la luminancia
 * perceptual (Rec. 601), no del hex: comparar el hex al azar daria parches incoherentes.
 */
function finishFor(hex: string): PaintFinish {
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum < 0.45 ? 'metallic' : 'gloss';
}

/** Familia y carroceria del vehiculo, sin decidir medidas. */
export function bodyFor(vehicle: VehicleRow): { family: VehicleFamily; body: BodyType } {
  const catalogType = catalogTypeOf(vehicle);
  if (catalogType) return bodyForCatalogType(catalogType);

  // Sin `type` util: el catalogo sabe el tipo de la mayoria de los modelos que manages.
  const make = str(vehicle.make);
  const model = str(vehicle.model);
  if (make && model) {
    const catalog = findModel(make, model);
    if (catalog) return bodyForCatalogType(catalog.type);
  }
  if (normalize(vehicle.type).startsWith('camioneta')) return bodyForCatalogType('pickup');
  return bodyForCatalogType('moto');
}

/**
 * Spec completa del vehiculo. `id` solo se usa para el color determinista cuando el
 * usuario no escribio uno (asi dos filas sin pintar no salen del mismo tono).
 */
export function specForVehicle(vehicle: VehicleRow, id = ''): VehicleSpec {
  const make = str(vehicle.make);
  const model = str(vehicle.model);
  const year = num(vehicle.year);

  const modelSpec = findModelSpec(make, model, year);
  const { family, body } = modelSpec
    ? { family: modelSpec.family, body: modelSpec.body }
    : bodyFor(vehicle);

  const base: VehicleSpec = modelSpec
    ? {
        family: modelSpec.family,
        body: modelSpec.body,
        dims: { ...modelSpec.dims },
        tireFront: { ...modelSpec.tireFront },
        tireRear: { ...modelSpec.tireRear },
        paint: { baseColor: '#9aa3ad', finish: 'metallic' },
      }
    : defaultSpec(body, family);

  const paint = paintFor(vehicle, str(vehicle.id) ?? id, family);
  return applyBuild3d({ ...base, paint }, sanitizeBuild3d(vehicle.build3d, base.family));
}

/** Etiqueta corta "Toyota Hilux 2022" para aria-labels y capturas. */
export function specLabelOf(vehicle: VehicleRow): string {
  return tidy(
    [
      str(vehicle.make),
      str(vehicle.model),
      num(vehicle.year) ? String(num(vehicle.year)) : undefined,
    ]
      .filter(Boolean)
      .join(' '),
  );
}
