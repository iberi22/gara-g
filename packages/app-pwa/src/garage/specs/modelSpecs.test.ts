/**
 * modelSpecs.test.ts — Venta de la tabla de medidas por modelo.
 *
 * Que protege este test:
 *   - NINGUN numero sin fuente: toda entrada cita al menos una URL https real.
 *   - Plausibilidad fisica: un 3D con medidas imposibles se ve roto aunque compile, asi que
 *     largo, ancho, alto y entre ejes se acotan por familia.
 *   - Coherencia interna: entre ejes y ancho menores que el largo, trocha menor que el ancho,
 *     y la rueda mas estrecha que la carroceria y por debajo de su techo.
 *   - Llantas parseables por el kit 3D (`templates/common/units.ts`), con aspecto y rin en
 *     rangos reales, y los rines de camion sin truncar.
 *   - Cobertura: todo modelo de `src/lib/vehicleCatalog.ts` tiene entrada o esta en
 *     MISSING_SPECS con motivo. Este es el test que hace fallar el build cuando se agrega un
 *     modelo al catalogo al que nadie le midio la ficha.
 *   - Busqueda: `findModelSpec` ignora mayusculas, tildes y espacios, y elige la generacion
 *     que cubre el ano pedido.
 */
import { describe, expect, it } from 'vitest';
import { VEHICLE_CATALOG } from '../../lib/vehicleCatalog';
import type { BodyType, ModelSpecEntry, TireSize, VehicleFamily } from '../contracts';
import { formatTireSize, parseTireSize, tireDiameterMm } from '../templates/common/units';
import { MISSING_SPECS, MODEL_SPECS, findModelSpec } from './modelSpecs';

/** Rango plausible por familia, en mm. Acota el 3D a vehiculos que existen. */
interface FamilyRange {
  length: [number, number];
  width: [number, number];
  height: [number, number];
  wheelbase: [number, number];
}

const FAMILY_RANGES: Record<VehicleFamily, FamilyRange> = {
  moto: { length: [1600, 2600], width: [600, 950], height: [900, 1500], wheelbase: [1100, 1700] },
  // Los falsetes con techo alto llegan a 2.7 m, asi que el tope de "car" no puede ser el de un
  // sedan. Lo que interesa es que el rango siga atrapando medidas absurdas.
  car: { length: [3500, 6000], width: [1500, 2200], height: [1200, 2800], wheelbase: [2300, 4400] },
  heavy: {
    length: [5000, 13000],
    width: [1900, 2700],
    height: [2000, 4200],
    wheelbase: [2800, 6500],
  },
  // Maquinaria: largo con el equipo en pose de exhibicion; "entre ejes" = oruga en el suelo.
  machinery: { length: [4000, 11000], width: [2000, 3700], height: [2800, 4500], wheelbase: [2000, 6500] },
};

const BODIES_BY_FAMILY: Record<VehicleFamily, BodyType[]> = {
  moto: ['naked', 'sport', 'scooter', 'trail'],
  car: ['sedan', 'hatchback', 'suv', 'pickup', 'van'],
  heavy: ['truck', 'flatbed', 'dump', 'tractor'],
  machinery: ['excavator', 'backhoe', 'wheel_loader', 'dozer', 'grader', 'roller'],
};

// ── Helpers ───────────────────────────────────────────────────────────────────────────

const label = (e: { make: string; model: string }): string => `${e.make} ${e.model}`;
const key = (e: { make: string; model: string }): string => `${e.make}|${e.model}`;

const CATALOG_MODELS = VEHICLE_CATALOG.flatMap((mk) => mk.models);
const CATALOG_BY_KEY = new Map(CATALOG_MODELS.map((m) => [key(m), m]));
const SPEC_KEYS = new Set(MODEL_SPECS.map(key));
const MISSING_KEYS = new Set(MISSING_SPECS.map(key));

/** Acota `value` a su rango, con mensaje que senale vehiculo y medida. */
const expectInRange = (
  value: number,
  [min, max]: readonly [number, number],
  what: string,
  who: string,
): void => {
  expect(value, `${who}: ${what} fuera de [${min}, ${max}]`).toBeGreaterThanOrEqual(min);
  expect(value, `${who}: ${what} fuera de [${min}, ${max}]`).toBeLessThanOrEqual(max);
};

/** Recorre las dos llantas de una entrada, para no repetir el par delantera/trasera. */
const forEachTire = (e: ModelSpecEntry, fn: (t: TireSize, pos: string) => void): void => {
  fn(e.tireFront, 'delantera');
  fn(e.tireRear, 'trasera');
};

// ── Fuentes ───────────────────────────────────────────────────────────────────────────

describe('MODEL_SPECS: fuentes', () => {
  it('cada entrada cita al menos una fuente https, sin repetir', () => {
    for (const e of MODEL_SPECS) {
      expect(e.sources.length, `${label(e)} sin fuentes`).toBeGreaterThanOrEqual(1);
      for (const src of e.sources)
        expect(src, `${label(e)}: fuente no https`).toMatch(/^https:\/\//);
      expect(new Set(e.sources).size, `${label(e)}: fuentes repetidas`).toBe(e.sources.length);
    }
  });

  it('no hay entradas duplicadas de marca, modelo y anos', () => {
    const seen = new Set<string>();
    for (const e of MODEL_SPECS) {
      const k = `${key(e)}|${e.yearFrom ?? '-'}|${e.yearTo ?? '-'}`;
      expect(seen.has(k), `entrada duplicada: ${k}`).toBe(false);
      seen.add(k);
    }
  });
});

// ── Datos obligatorios ───────────────────────────────────────────────────────────────

describe('MODEL_SPECS: datos obligatorios', () => {
  it('toda medida es un numero finito y positivo', () => {
    for (const e of MODEL_SPECS) {
      for (const [k, v] of Object.entries(e.dims)) {
        expect(Number.isFinite(v), `${label(e)}: dims.${k} no finito`).toBe(true);
        expect(v, `${label(e)}: dims.${k} no positivo`).toBeGreaterThan(0);
      }
    }
  });

  it('el rango de anos es coherente y la carroceria pertenece a la familia', () => {
    for (const e of MODEL_SPECS) {
      expect(e.yearFrom, `${label(e)}: yearFrom ausente o imposible`).toBeGreaterThan(1950);
      expect(e.yearTo, `${label(e)}: yearTo ausente o < yearFrom`).toBeGreaterThanOrEqual(
        e.yearFrom ?? 1951,
      );
      expect(BODIES_BY_FAMILY[e.family], `${label(e)}: ${e.body} no es de ${e.family}`).toContain(
        e.body,
      );
    }
  });
});

// ── Plausibilidad fisica ─────────────────────────────────────────────────────────────

describe('MODEL_SPECS: plausibilidad fisica', () => {
  it('largo, ancho, alto y entre ejes caen en el rango de su familia', () => {
    for (const e of MODEL_SPECS) {
      const r = FAMILY_RANGES[e.family];
      expectInRange(e.dims.lengthMm, r.length, 'largo', label(e));
      expectInRange(e.dims.widthMm, r.width, 'ancho', label(e));
      expectInRange(e.dims.heightMm, r.height, 'alto', label(e));
      expectInRange(e.dims.wheelbaseMm, r.wheelbase, 'entre ejes', label(e));
    }
  });

  it('el entre ejes y el ancho son menores que el largo', () => {
    for (const e of MODEL_SPECS) {
      expect(e.dims.wheelbaseMm, `${label(e)}: entre ejes >= largo`).toBeLessThan(e.dims.lengthMm);
      expect(e.dims.widthMm, `${label(e)}: ancho >= largo`).toBeLessThan(e.dims.lengthMm);
    }
  });

  it('las trochas, cuando estan publicadas, caben dentro del ancho', () => {
    for (const e of MODEL_SPECS) {
      const { trackFrontMm: front, trackRearMm: rear, widthMm } = e.dims;
      if (front === undefined || rear === undefined) continue;
      // La trocha se mide entre el centro de las huellas, asi que es menor que el ancho.
      expectInRange(front, [1, widthMm], 'trocha delantera', label(e));
      expectInRange(rear, [1, widthMm], 'trocha trasera', label(e));
    }
  });

  it('la altura al piso cabe bajo el techo, y el sillin solo existe en motos', () => {
    for (const e of MODEL_SPECS) {
      const { groundClearanceMm: clearance, seatHeightMm: seat, heightMm } = e.dims;
      if (clearance !== undefined)
        expectInRange(clearance, [61, heightMm], 'altura al piso', label(e));
      if (seat !== undefined) {
        expect(e.family, `${label(e)}: sillin en un no-moto`).toBe('moto');
        expectInRange(seat, [301, heightMm], 'altura de sillin', label(e));
      }
    }
  });
});

// ── Llantas ───────────────────────────────────────────────────────────────────────────

describe('MODEL_SPECS: llantas', () => {
  /**
   * `parseTireSize` (units.ts) solo acepta el rin entero (`\d{2}`), asi que no puede leer un
   * 17.5" ni un 22.5" de camion. La forma de la medida se valida siempre; el round-trip con el
   * parser del kit solo aplica a rines enteros. Ver LIMITACIONES 1 en REPORT.md: es la unica
   * medida que `units.ts` no sabe expresar con decimales.
   */
  const checkTire = (t: TireSize, who: string): void => {
    const text = formatTireSize(t);
    expect(text, `${who}: medida con forma rara`).toMatch(/^\d{2,3}\/\d{2,3}R\d{1,2}(\.\d)?$/);
    expectInRange(t.aspectPct, [30, 110], 'aspecto', who);
    expectInRange(t.rimIn, [10, 24], 'rin', who);
    expectInRange(t.widthMm, [81, 449], 'ancho de llanta', who);

    if (!Number.isInteger(t.rimIn)) return;
    const parsed = parseTireSize(text);
    expect(parsed, `${who}: ${text} no la entiende el kit 3D`).not.toBeNull();
    expect(parsed?.widthMm, `${who}: ancho`).toBe(t.widthMm);
    expect(parsed?.aspectPct, `${who}: aspecto`).toBe(t.aspectPct);
    expect(parsed?.rimIn, `${who}: rin`).toBe(t.rimIn);
  };

  it('cada llanta esta en rango y la mide el kit 3D', () => {
    for (const e of MODEL_SPECS) forEachTire(e, checkTire);
  });

  it('la rueda es mas estrecha que el vehiculo y cabe bajo su techo', () => {
    for (const e of MODEL_SPECS) {
      forEachTire(e, (t, pos) => {
        expect(t.widthMm, `${label(e)} ${pos}: llanta mas ancha que el vehiculo`).toBeLessThan(
          e.dims.widthMm,
        );
        expect(
          tireDiameterMm(t),
          `${label(e)} ${pos}: rueda mas alta que el vehiculo`,
        ).toBeLessThan(e.dims.heightMm);
      });
    }
  });

  it('los rines de camion se guardan como decimales reales, no truncados', () => {
    const rims = new Set(MODEL_SPECS.flatMap((e) => [e.tireFront.rimIn, e.tireRear.rimIn]));
    // Si 17.5 o 22.5 se truncan a entero, la rueda sale visiblemente mal dimensionada.
    expect(rims.has(17.5), 'ningun rin de 17.5" en la tabla').toBe(true);
    expect(rims.has(22.5), 'ningun rin de 22.5" en la tabla').toBe(true);
  });
});

// ── Cobertura del catalogo ────────────────────────────────────────────────────────────

describe('Cobertura del catalogo', () => {
  it('todo modelo tiene entrada o esta en MISSING_SPECS con motivo', () => {
    const sinCubrir = CATALOG_MODELS.filter(
      (m) => !SPEC_KEYS.has(key(m)) && !MISSING_KEYS.has(key(m)),
    );
    expect(sinCubrir.map(label), 'modelos del catalogo sin ficha ni motivo').toEqual([]);
  });

  it('ninguna entrada es huerfana ni contradictoria', () => {
    expect(
      MODEL_SPECS.filter((e) => !CATALOG_BY_KEY.has(key(e))).map(label),
      'entradas sin modelo en el catalogo',
    ).toEqual([]);
    expect(
      MISSING_SPECS.filter((m) => SPEC_KEYS.has(key(m))).map(label),
      'modelos a la vez en MODEL_SPECS y MISSING_SPECS',
    ).toEqual([]);
  });

  it('todo motivo de MISSING_SPECS explica por que no entra', () => {
    for (const m of MISSING_SPECS) {
      expect(m.reason.trim().length, `${label(m)}: motivo vacio`).toBeGreaterThan(10);
    }
  });

  it('toda entrada cubre al menos un ano de los que ofrece el catalogo', () => {
    for (const e of MODEL_SPECS) {
      const cm = CATALOG_BY_KEY.get(key(e));
      if (cm === undefined) throw new Error(`${label(e)} no esta en el catalogo`);
      const overlap = cm.yearsAvailable.filter(
        (y) => (e.yearFrom ?? 0) <= y && y <= (e.yearTo ?? 9999),
      );
      expect(overlap.length, `${label(e)} no cubre ningun ano de yearsAvailable`).toBeGreaterThan(
        0,
      );
    }
  });
});

// ── Busqueda ──────────────────────────────────────────────────────────────────────────

describe('findModelSpec', () => {
  it('encuentra por marca y modelo exactos', () => {
    expect(findModelSpec('Toyota', 'Hilux')).toBeDefined();
    expect(findModelSpec('Honda', 'CB 160F')).toBeDefined();
  });

  it('ignora mayusculas, minusculas, espacios y el guion de la marca', () => {
    const hilux = findModelSpec('Toyota', 'Hilux');
    expect(findModelSpec('toyota', 'hilux')).toBe(hilux);
    expect(findModelSpec('TOYOTA', 'HILUX')).toBe(hilux);
    expect(findModelSpec('MERCEDES-BENZ', 'sprinter')).toBeDefined();
    expect(findModelSpec('mercedesbenz', 'sprinter')).toBeDefined();
    expect(findModelSpec('Honda', 'CB160F')).toBe(findModelSpec('Honda', 'CB 160F'));
  });

  it('devuelve undefined sin marca, sin modelo o para un modelo ajeno', () => {
    expect(findModelSpec(undefined, 'Hilux')).toBeUndefined();
    expect(findModelSpec('Toyota', undefined)).toBeUndefined();
    expect(findModelSpec(undefined, undefined)).toBeUndefined();
    expect(findModelSpec('Ferrari', 'Fiat 500')).toBeUndefined();
  });

  it('elige la generacion que cubre el ano pedido', () => {
    const e = findModelSpec('Toyota', 'Hilux', 2021);
    expect(e).toBeDefined();
    expect(e?.yearFrom ?? 9999).toBeLessThanOrEqual(2021);
    expect(e?.yearTo ?? 0).toBeGreaterThanOrEqual(2021);
  });

  it('fuera de todo rango devuelve la primera entrada, nunca otra marca', () => {
    expect(findModelSpec('Toyota', 'Hilux', 1990)).toBe(findModelSpec('Toyota', 'Hilux'));
    expect(findModelSpec('Yamaha', 'FZ16', 2022)?.model).toBe('FZ16');
  });

  it('encuentra todos los modelos del catalogo que si tienen ficha', () => {
    for (const m of CATALOG_MODELS) {
      if (MISSING_KEYS.has(key(m))) continue;
      const year = m.yearsAvailable[Math.floor(m.yearsAvailable.length / 2)];
      expect(findModelSpec(m.make, m.model, year), `${label(m)} (${year})`).toBeDefined();
    }
  });
});
