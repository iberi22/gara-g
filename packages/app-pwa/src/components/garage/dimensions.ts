/**
 * dimensions.ts — Cotas de plano tecnico del configurador y su geometria de dibujo.
 *
 * La ronda 3 del HUD pide el lenguaje visual de un configurador de producto: sobre el
 * escenario hay un plano tecnico (linea, cuadricula, cruces fiduciales) y encima una capa
 * de COTAS dibujadas en SVG que siguen al vehiculo mientras se orbita la camara.
 *
 * Aqui vive toda la parte pura y testeable de esa capa:
 *   - `formatMm` / `buildDimensionCotas`: el VALOR que se escribe en la cota sale de la ficha
 *     tecnica (`spec.dims`, en mm), nunca de medir la pantalla; el separador de miles sale del
 *     mercado activo (lib/market.ts).
 *   - `buildBlueprintGeometry`: la silueta de alzado del plano (ruedas, ejes, linea de techo)
 *     derivada de las medidas de la ficha, para que el dibujo de fondo encaje con el 3D.
 *   - `anchorFor` / `fallbackAnchor`: el punto de pantalla de cada cota. Con el motor
 *     proyeccionando (`engine.projectAnchors()`) se usa su punto; sin el, se usa una
 *     disposicion sintetica centrada, de modo que las cotas se ven igual y el HUD no depende
 *     de que el metodo exista todavia.
 */
import type { DimensionAnchors, ScreenPoint, TireSize, VehicleDimensions } from '../../garage/contracts';
import { formatNumber } from '../../lib/market';

export type DimensionId = 'length' | 'height' | 'wheelbase';

/** Una cota lista para dibujar: etiqueta, valor en mm y el texto ya formateado. */
export interface DimensionCota {
  id: DimensionId;
  /** Etiqueta corta en mayusculas ("LARGO", "ALTO", "ENTRE EJES"). */
  label: string;
  valueMm: number;
  /** Texto para el SVG, p. ej. "4.620 mm". */
  text: string;
}

/**
 * Formatea una medida en mm con el separador de miles del mercado.
 * 4620 -> "4.620 mm"; 0/NaN/null -> "—".
 */
export function formatMm(mm: number | undefined | null, opts: { unit?: boolean } = {}): string {
  if (mm === undefined || mm === null || !Number.isFinite(mm)) return '—';
  const rounded = Math.round(mm);
  const text = formatNumber(Math.abs(rounded));
  const sign = rounded < 0 ? '−' : '';
  return `${sign}${text}${opts.unit === false ? '' : ' mm'}`;
}

/**
 * Construye las tres cotas de la ficha tecnica, en el orden en que se dibujan:
 * largo (arriba), alto (izquierda) y entre ejes (abajo).
 */
export function buildDimensionCotas(dims: VehicleDimensions): DimensionCota[] {
  return [
    { id: 'length', label: 'LARGO', valueMm: dims.lengthMm, text: formatMm(dims.lengthMm) },
    { id: 'height', label: 'ALTO', valueMm: dims.heightMm, text: formatMm(dims.heightMm) },
    { id: 'wheelbase', label: 'ENTRE EJES', valueMm: dims.wheelbaseMm, text: formatMm(dims.wheelbaseMm) },
  ];
}

/** Punto de pantalla que corresponde a cada cota. */
export function anchorFor(anchors: DimensionAnchors | null | undefined, id: DimensionId): ScreenPoint | null {
  if (!anchors) return null;
  switch (id) {
    case 'length':
      return anchors.frontTop.visible ? anchors.frontTop : anchors.rearTop;
    case 'height':
      return anchors.top.visible ? anchors.top : null;
    case 'wheelbase':
      return anchors.axleRear.visible ? anchors.axleRear : anchors.axleFront;
    default:
      return null;
  }
}

/** Par de puntos (inicio, fin) de la linea de cota. */
export function anchorPair(
  anchors: DimensionAnchors | null | undefined,
  id: DimensionId,
): { a: ScreenPoint; b: ScreenPoint } | null {
  if (!anchors) return null;
  switch (id) {
    case 'length':
      return { a: anchors.rearTop, b: anchors.frontTop };
    case 'height':
      return { a: anchors.topGround, b: anchors.top };
    case 'wheelbase':
      return { a: anchors.axleRear, b: anchors.axleFront };
    default:
      return null;
  }
}

/**
 * Disposicion sintetica de las cotas cuando el motor aun no proyecta: mantiene el mismo
 * esquema (largo arriba, alto a la izquierda, entre ejes abajo) centrado en el lienzo.
 * Sirve tambien de red de seguridad si el anclaje real sale del lienzo.
 */
export function fallbackAnchor(id: DimensionId, width: number, height: number): ScreenPoint {
  const pad = Math.max(18, Math.min(width, height) * 0.05);
  const ground = height - pad * 1.6;
  const top = pad * 1.4;
  const center = width / 2;
  switch (id) {
    case 'length':
      return { x: center, y: top, visible: true };
    case 'height':
      return { x: pad, y: (top + ground) / 2, visible: true };
    case 'wheelbase':
      return { x: center, y: ground, visible: true };
    default:
      return { x: center, y: height / 2, visible: true };
  }
}

// ---------------------------------------------------------------------------
// Geometria del plano tecnico de fondo
// ---------------------------------------------------------------------------

export interface BlueprintGeometry {
  /** Ancho y alto del lienzo virtual del plano (unidades SVG). */
  viewBox: { width: number; height: number };
  /** Y del suelo en unidades SVG. */
  groundY: number;
  /** Escala px-SVG por mm. */
  scale: number;
  frontAxleX: number;
  rearAxleX: number;
  frontWheelR: number;
  rearWheelR: number;
  roofY: number;
  centerX: number;
}

const BLUEPRINT_W = 1000;
const BLUEPRINT_H = 520;
/** Margen lateral reservado para las cotas (largo a la derecha, alto a la izquierda). */
const BLUEPRINT_MARGIN = 150;

/**
 * Diametro exterior de una llanta en mm (rin en pulgadas + dos veces el flanco del
 * neumático, que es `widthMm * aspectPct / 100`).
 */
export function tireOuterMm(tire: TireSize): number {
  const rimMm = tire.rimIn * 25.4;
  return rimMm + 2 * tire.widthMm * (tire.aspectPct / 100);
}

/**
 * Silueta de alzado del plano, en el mismo sistema que el 3D: frente a +X, suelo en y = 0,
 * centros de ejes a ±wheelbase/2. Se usa solo para el dibujo SVG de fondo, pero sale de las
 * medidas de la ficha para que el plano case con el modelo que se ve encima.
 */
export function buildBlueprintGeometry(dims: VehicleDimensions, tireFront: TireSize, tireRear: TireSize): BlueprintGeometry {
  const usable = BLUEPRINT_W - BLUEPRINT_MARGIN * 2;
  const scale = usable / Math.max(1, dims.lengthMm);
  const centerX = BLUEPRINT_W / 2;
  const groundY = BLUEPRINT_H - 110;
  const halfWheelbase = (dims.wheelbaseMm * scale) / 2;

  return {
    viewBox: { width: BLUEPRINT_W, height: BLUEPRINT_H },
    groundY,
    scale,
    frontAxleX: centerX + halfWheelbase,
    rearAxleX: centerX - halfWheelbase,
    frontWheelR: Math.max(6, (tireOuterMm(tireFront) * scale) / 2),
    rearWheelR: Math.max(6, (tireOuterMm(tireRear) * scale) / 2),
    roofY: groundY - dims.heightMm * scale,
    centerX,
  };
}