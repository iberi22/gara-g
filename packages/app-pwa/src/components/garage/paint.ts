/**
 * paint.ts — Muestras de color y selector de acabado del configurador, con persistencia
 * por vehiculo.
 *
 * El LEFT COLUMN del diseno de referencia tiene la tarjeta "FINISH & TRIM": muestras
 * cuadradas con esquinas cortadas (la activa con marco naranja) y un pie con el nombre del
 * acabado. Aqui el acabado es el `PaintFinish` de contracts.ts, que el motor ya sabe pintar
 * con `setPaint`. La eleccion se guarda por vehiculo en `garage:paint:<vehicleId>` porque el
 * acabado es parte de la ficha personal del vehiculo, no una preferencia global, y se
 * reaplica al volver a ese vehiculo. Todo el acceso va en try/catch: en modo privado la
 * app puede bloquear localStorage y el HUD debe seguir funcionando.
 */
import type { PaintFinish, PaintSpec } from '../../garage/contracts';

export interface PaintSample {
  /** Hex "rrggbb" sin '#', para el CSS de la muestra. */
  hex: string;
  label: string;
}

export interface PaintOption {
  finish: PaintFinish;
  label: string;
  hint: string;
}

/** Muestras de color del estudio de GARA-G (naranja de la casa como acento). */
export const PAINT_SAMPLES: readonly PaintSample[] = [
  { hex: '14171c', label: 'Grafito' },
  { hex: '464d57', label: 'Gunmetal' },
  { hex: 'aeb6c2', label: 'Aluminio' },
  { hex: '1f4fd1', label: 'Azul' },
  { hex: '8a1c22', label: 'Rojo vino' },
  { hex: 'ff6a13', label: 'Naranja GARA-G' },
] as const;

export const PAINT_OPTIONS: readonly PaintOption[] = [
  { finish: 'gloss', label: 'BRILLANTE', hint: 'Barniz brillante estandar' },
  { finish: 'metallic', label: 'METALIZADO', hint: 'Particulas metálicas finas' },
  { finish: 'matte', label: 'MATE', hint: 'Mate sedoso, sin reflejos' },
  { finish: 'pearl', label: 'PERLADO', hint: 'Capa perla de triple coat' },
  { finish: 'satin', label: 'SATINADO', hint: 'Satinado de bajo brillo' },
] as const;

/** Quita el '#' y normaliza a 6 digitos en mayusculas; null si no es un hex válido. */
export function normalizeHex(color: string | undefined | null): string | null {
  if (!color) return null;
  const raw = color.trim().replace(/^#/, '');
  return /^[0-9a-fA-F]{6}$/.test(raw) ? raw.toUpperCase() : null;
}

/**
 * Completa la pintura actual con la eleccion del usuario: conserva el color base que ya
 * tenia el vehiculo salvo que se haya pedido otra muestra, y aplica el acabado elegido.
 */
export function buildPaintSpec(current: PaintSpec, sampleHex: string, finish: PaintFinish): PaintSpec {
  return {
    ...current,
    baseColor: `#${normalizeHex(sampleHex) ?? normalizeHex(current.baseColor) ?? '14171c'}`,
    finish,
  };
}

/** Clave de almacenamiento de la pintura por vehiculo. */
export function paintStorageKey(vehicleId: string): string {
  return `garage:paint:${vehicleId}`;
}

interface StoredPaint {
  hex: string;
  finish: PaintFinish;
}

/** Pintura guardada de un vehiculo, o null si no hay o esta corrupta. */
export function loadStoredPaint(vehicleId: string): StoredPaint | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(paintStorageKey(vehicleId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredPaint>;
    const hex = normalizeHex(parsed?.hex ?? null);
    const finish = parsed?.finish;
    const validFinish = PAINT_OPTIONS.some((o) => o.finish === finish);
    if (!hex || !validFinish) return null;
    return { hex, finish: finish as PaintFinish };
  } catch {
    return null;
  }
}

/** Guarda la pintura de un vehiculo. Devuelve false si el almacenamiento no lo permite. */
export function saveStoredPaint(vehicleId: string, hex: string, finish: PaintFinish): boolean {
  if (typeof localStorage === 'undefined') return false;
  const clean = normalizeHex(hex);
  if (!clean) return false;
  try {
    localStorage.setItem(paintStorageKey(vehicleId), JSON.stringify({ hex: clean, finish }));
    return true;
  } catch {
    return false;
  }
}

/** Etiqueta legible de un acabado. */
export function finishLabel(finish: PaintFinish): string {
  return PAINT_OPTIONS.find((o) => o.finish === finish)?.label ?? 'ACABADO';
}