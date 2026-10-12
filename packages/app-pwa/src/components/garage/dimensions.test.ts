/**
 * dimensions.test.ts — Pruebas del formato de cotas (miles + mm) y de la geometria del plano.
 */
import { describe, expect, it } from 'vitest';
import type { DimensionAnchors, TireSize, VehicleDimensions } from '../../garage/contracts';
import {
  anchorFor,
  anchorPair,
  buildBlueprintGeometry,
  buildDimensionCotas,
  fallbackAnchor,
  formatMm,
  tireOuterMm,
} from './dimensions';

const SEDAN_DIMS: VehicleDimensions = {
  lengthMm: 4620,
  widthMm: 1795,
  heightMm: 1440,
  wheelbaseMm: 2700,
};
const TIRE_F: TireSize = { widthMm: 205, aspectPct: 55, rimIn: 16 };
const TIRE_R: TireSize = { widthMm: 205, aspectPct: 55, rimIn: 16 };

function point(x: number, y: number, visible = true) {
  return { x, y, visible };
}

function anchors(overrides: Partial<DimensionAnchors> = {}): DimensionAnchors {
  return {
    frontTop: point(900, 120),
    rearTop: point(200, 130),
    frontGround: point(900, 500),
    rearGround: point(200, 500),
    top: point(540, 100),
    topGround: point(540, 500),
    axleFront: point(780, 480),
    axleRear: point(320, 480),
    ...overrides,
  };
}

describe('formatMm', () => {
  it('usa separador de miles colombiano y la unidad mm', () => {
    expect(formatMm(4620)).toBe('4.620 mm');
    expect(formatMm(1440)).toBe('1.440 mm');
    expect(formatMm(615)).toBe('615 mm');
  });

  it('permite quitar la unidad para usos compactos', () => {
    expect(formatMm(1990, { unit: false })).toBe('1.990');
  });

  it('usa el signo menos matemático en medidas negativas', () => {
    expect(formatMm(-350)).toBe('−350 mm');
  });

  it('devuelve guion para valores ausentes o no finitos', () => {
    expect(formatMm(null)).toBe('—');
    expect(formatMm(undefined)).toBe('—');
    expect(formatMm(Number.NaN)).toBe('—');
    expect(formatMm(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('buildDimensionCotas', () => {
  it('devuelve largo, alto y entre ejes con el valor de la ficha', () => {
    const cotas = buildDimensionCotas(SEDAN_DIMS);
    expect(cotas.map((c) => c.id)).toEqual(['length', 'height', 'wheelbase']);
    expect(cotas[0].valueMm).toBe(4620);
    expect(cotas[0].text).toBe('4.620 mm');
    expect(cotas[1].label).toBe('ALTO');
    expect(cotas[2].text).toBe('2.700 mm');
  });

  it('usa etiquetas en mayusculas sin tildes', () => {
    for (const cota of buildDimensionCotas(SEDAN_DIMS)) {
      expect(cota.label).toBe(cota.label.toUpperCase());
      expect(cota.label).not.toMatch(/[áéíóúñ]/i);
    }
  });
});

describe('anchorFor / anchorPair', () => {
  it('elige el anclaje de cada cota', () => {
    const a = anchors();
    expect(anchorFor(a, 'length')).toEqual(point(900, 120));
    expect(anchorFor(a, 'height')).toEqual(point(540, 100));
    expect(anchorFor(a, 'wheelbase')).toEqual(point(320, 480));
  });

  it('cae al extremo trasero si el delantero no es visible', () => {
    const a = anchors({ frontTop: point(900, 120, false) });
    expect(anchorFor(a, 'length')).toEqual(point(200, 130));
  });

  it('devuelve null sin anclajes (motor sin proyeccion)', () => {
    expect(anchorFor(null, 'length')).toBeNull();
    expect(anchorPair(undefined, 'height')).toBeNull();
  });

  it('el par de la cota une suelo y techo en el alto', () => {
    const pair = anchorPair(anchors(), 'height');
    expect(pair?.a).toEqual(point(540, 500));
    expect(pair?.b).toEqual(point(540, 100));
  });
});

describe('fallbackAnchor', () => {
  it('coloca el largo arriba, el alto a la izquierda y el entre ejes abajo', () => {
    const largo = fallbackAnchor('length', 1200, 700);
    const alto = fallbackAnchor('height', 1200, 700);
    const ejes = fallbackAnchor('wheelbase', 1200, 700);
    expect(largo.x).toBeCloseTo(600);
    expect(alto.x).toBeLessThan(largo.x);
    expect(ejes.y).toBeGreaterThan(largo.y);
  });
});

describe('tireOuterMm', () => {
  it('suma el rin en pulgadas y los dos flancos', () => {
    // 16" = 406.4 mm; flanco = 205 * 0.55 = 112.75 -> 406.4 + 225.5 = 631.9
    expect(tireOuterMm(TIRE_F)).toBeCloseTo(631.9, 1);
  });
});

describe('buildBlueprintGeometry', () => {
  it('deriva la silueta de las medidas de la ficha', () => {
    const g = buildBlueprintGeometry(SEDAN_DIMS, TIRE_F, TIRE_R);
    expect(g.centerX).toBe(500);
    // Los ejes quedan simetricos respecto al centro, separados por el entre ejes.
    expect(g.frontAxleX - g.rearAxleX).toBeCloseTo(2700 * g.scale, 5);
    expect(g.centerX - g.rearAxleX).toBeCloseTo(g.frontAxleX - g.centerX, 5);
    // El techo esta por encima del suelo y el largoUtil respeta la longitud.
    expect(g.roofY).toBeLessThan(g.groundY);
    expect(g.groundY - g.roofY).toBeCloseTo(1440 * g.scale, 5);
  });

  it('el ancho util es menor que el lienzo por el margen de cotas', () => {
    const g = buildBlueprintGeometry(SEDAN_DIMS, TIRE_F, TIRE_R);
    expect(4620 * g.scale).toBeLessThan(1000);
    expect(g.rearAxleX).toBeGreaterThan(0);
    expect(g.frontAxleX).toBeLessThan(1000);
  });

  it('el radio de rueda sale del diametro exterior de la llanta', () => {
    const g = buildBlueprintGeometry(SEDAN_DIMS, TIRE_F, TIRE_R);
    expect(g.frontWheelR).toBeCloseTo((tireOuterMm(TIRE_F) * g.scale) / 2, 5);
  });
});