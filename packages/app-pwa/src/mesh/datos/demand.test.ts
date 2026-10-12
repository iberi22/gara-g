import { describe, expect, it } from 'vitest';
import { DEFAULT_MARKET_PREFS } from './market';
import {
  type DemandContext,
  EphemeralId,
  aggregateDemand,
  buildDemandSignals,
  demandCategoryKey,
  dueBucket,
  dueLabel,
  parseDemand,
  yearBucket,
} from './demand';
import type { VehicleClass } from './offer';
import { BOGOTA, DAY, NOW, hilux, moto } from './testkit';
import type { Need, OwnerVehicle } from './vehicles';

const consentAll = {
  ...DEFAULT_MARKET_PREFS,
  categories: [...DEFAULT_MARKET_PREFS.categories, ...['taller', 'repuestos', 'aseguradora', 'lubricentro', 'llanteria'].map((c) => demandCategoryKey(c as never))],
};
const ctx = (over: Partial<DemandContext> = {}): DemandContext => ({
  prefs: consentAll,
  enabled: true,
  detail: 'basic',
  region: BOGOTA,
  now: NOW,
  sid: 'abcdef012345',
  ...over,
});

describe('buildDemandSignals', () => {
  it('construye una senal por necesidad cercana, la mas urgente primero', () => {
    const v = hilux({
      needs: [
        { key: 'aceite', remaining: 800, unit: 'km' },
        { key: 'llantas', remaining: -50, unit: 'km' },
        { key: 'frenos', remaining: 90_000, unit: 'km' }, // lejos: no se publica
      ],
    });
    const out = buildDemandSignals([v], ctx());
    expect(out.map((s) => s.need)).toEqual(['llantas', 'aceite']);
    expect(out[0]).toMatchObject({ cat: 'llanteria', due: 0, cls: 'liviano', cell: BOGOTA, brand: 'toyota' });
    expect(out[1]).toMatchObject({ cat: 'lubricentro', due: 2 }); // 800 km -> "menos de 1000"
  });

  it('por defecto no publica modelo ni anio; con detalle completo si, en cubo de 5 anios', () => {
    const basic = buildDemandSignals([hilux()], ctx())[0];
    expect(basic.model).toBeUndefined();
    expect(basic.yearBucket).toBeUndefined();
    const full = buildDemandSignals([hilux()], ctx({ detail: 'full' }))[0];
    expect(full.model).toBe('hilux');
    expect(full.yearBucket).toBe('2015-2019');
  });

  it('consentimiento apagado -> nada', () => {
    expect(buildDemandSignals([hilux()], ctx({ enabled: false }))).toEqual([]);
    expect(buildDemandSignals([hilux()], ctx({ prefs: { ...consentAll, enabled: false } }))).toEqual([]);
    expect(buildDemandSignals([hilux()], ctx({ region: null }))).toEqual([]);
    // por defecto las categorias de demanda estan apagadas aunque el interruptor este encendido
    expect(buildDemandSignals([hilux()], ctx({ prefs: DEFAULT_MARKET_PREFS }))).toEqual([]);
  });

  it('solo las categorias permitidas', () => {
    const soloLlantas = { ...consentAll, categories: [...DEFAULT_MARKET_PREFS.categories, demandCategoryKey('llanteria')] };
    const v = hilux({ needs: [{ key: 'aceite', remaining: 300, unit: 'km' }, { key: 'llantas', remaining: 300, unit: 'km' }] });
    expect(buildDemandSignals([v], ctx({ prefs: soloLlantas })).map((s) => s.cat)).toEqual(['llanteria']);
  });

  it('respeta el horario', () => {
    const noche = { ...consentAll, schedule: { startHour: 22, endHour: 23, daysOfWeek: [0, 1, 2, 3, 4, 5, 6] } };
    // NOW = 15:00 UTC: fuera de 22-23 en cualquier zona horaria razonable de la prueba? no: depende de TZ local
    const hora = new Date(NOW).getHours();
    const dentro = hora >= 22 && hora < 23;
    expect(buildDemandSignals([hilux()], ctx({ prefs: noche })).length > 0).toBe(dentro);
    const todo = { ...consentAll, schedule: { startHour: 0, endHour: 24, daysOfWeek: [0, 1, 2, 3, 4, 5, 6] } };
    expect(buildDemandSignals([hilux()], ctx({ prefs: todo })).length).toBeGreaterThan(0);
    const nuncaDias = { ...consentAll, schedule: { startHour: 0, endHour: 24, daysOfWeek: [] } };
    expect(buildDemandSignals([hilux()], ctx({ prefs: nuncaDias }))).toEqual([]);
  });

  it('no repite senales iguales (dos vehiculos iguales no delatan que son dos)', () => {
    expect(buildDemandSignals([hilux({ id: 'a' }), hilux({ id: 'b' })], ctx())).toHaveLength(1);
  });

  it('maquinaria en horas y documentos en dias usan sus propios cubos', () => {
    const m = hilux({ cls: 'maquinaria', usage: 'h', needs: [{ key: 'aceite', remaining: 40, unit: 'h' }, { key: 'seguro', remaining: 20, unit: 'dias' }] });
    const out = buildDemandSignals([m], ctx());
    expect(out.find((s) => s.need === 'aceite')).toMatchObject({ unit: 'h', due: 2 });
    expect(out.find((s) => s.need === 'seguro')).toMatchObject({ unit: 'dias', due: 2, cat: 'aseguradora' });
  });

  it('buckets y etiquetas', () => {
    expect([-1, 0, 500, 501, 1000, 2500, 5000, 5001].map((n) => dueBucket(n, 'km'))).toEqual([0, 1, 1, 2, 2, 3, 4, 5]);
    expect(dueLabel(2, 'km')).toBe('en menos de 1000 km');
    expect(dueLabel(0, 'km')).toBe('ya vencido');
    expect(yearBucket(2018)).toBe('2015-2019');
  });
});

describe('privacidad de la senal (propiedad sobre vehiculos al azar)', () => {
  // Generador determinista (mulberry32) para que un fallo se pueda repetir.
  function rng(seed: number) {
    return () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const NEEDS = ['aceite', 'llantas', 'frenos', 'bateria', 'filtros', 'seguro', 'revision'] as const;
  const CLASSES: VehicleClass[] = ['moto', 'liviano', 'pesado', 'maquinaria'];
  const WHITELIST = new Set(['v', 'sid', 'cat', 'need', 'cls', 'brand', 'model', 'yearBucket', 'unit', 'due', 'cell', 'day']);

  it('nunca contiene placa, VIN, km exactos, nombre ni coordenadas', () => {
    const r = rng(42);
    for (let i = 0; i < 200; i++) {
      const plate = `ABC${Math.floor(r() * 900 + 100)}`;
      const vin = Array.from({ length: 17 }, () => 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789'[Math.floor(r() * 33)]).join('');
      const odo = 1_000_003 + Math.floor(r() * 8_000_000); // 7 digitos: no coincide con ningun cubo ni anio
      const remaining = 1234.567 + Math.floor(r() * 4000);
      const lat = 4.5 + r();
      const lon = -74.5 + r();
      const name = `Mi-${Math.floor(r() * 1e6)}-querido`;
      const v = {
        id: `veh-${i}`,
        name,
        cls: CLASSES[Math.floor(r() * 4)],
        make: 'Toyota',
        model: 'Hilux',
        year: 1990 + Math.floor(r() * 35),
        usage: 'km',
        odometer: odo,
        needs: [{ key: NEEDS[Math.floor(r() * NEEDS.length)], remaining, unit: 'km' } as Need],
        plate,
        vin,
        lat,
        lon,
      } as OwnerVehicle & Record<string, unknown>;
      for (const detail of ['basic', 'full'] as const) {
        const signals = buildDemandSignals([v], ctx({ detail }));
        for (const s of signals) {
          const json = JSON.stringify(s);
          expect(Object.keys(s).every((k) => WHITELIST.has(k))).toBe(true);
          for (const secret of [plate, vin, name, v.id, String(odo), String(remaining), String(Math.round(remaining)), String(lat).slice(0, 6), String(lon).slice(0, 7)]) {
            expect(json).not.toContain(secret);
          }
          // lo unico "geografico" es la region de 4 letras
          expect(s.cell).toBe(BOGOTA);
          expect(s.cell).toHaveLength(4);
          // y el dia va redondeado
          expect(s.day % DAY).toBe(0);
          // los km salen en cubo (entero 0..5), nunca el numero
          expect(Number.isInteger(s.due) && s.due >= 0 && s.due <= 5).toBe(true);
        }
      }
    }
  });
});

describe('EphemeralId', () => {
  it('rota cada dia y no se parece al nodo', () => {
    const e = new EphemeralId();
    const a = e.current(NOW);
    expect(e.current(NOW + 1000)).toBe(a);
    const b = e.current(NOW + DAY);
    expect(b).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe('parseDemand / aggregateDemand', () => {
  const sig = buildDemandSignals([hilux()], ctx())[0];

  it('parseDemand reconstruye solo lo valido y rechaza lo raro', () => {
    expect(parseDemand(sig)).toEqual(sig);
    expect(parseDemand({ ...sig, plate: 'ABC123' })).not.toHaveProperty('plate');
    expect(parseDemand({ ...sig, cat: 'x' })).toBeNull();
    expect(parseDemand({ ...sig, cell: 'toolong' })).toBeNull();
    expect(parseDemand({ ...sig, sid: 'no-hex' })).toBeNull();
    expect(parseDemand(null)).toBeNull();
  });

  it('un cubo con menos de k emisores distintos se suprime', () => {
    const mk = (from: string) => ({ sid: from, signal: sig });
    expect(aggregateDemand([mk('a'), mk('b')])).toEqual([]);
    expect(aggregateDemand([mk('a'), mk('b'), mk('c'), mk('a')])).toEqual([{ cat: 'lubricentro', need: 'aceite', cls: 'liviano', count: 3 }]);
  });

  it('moto y camioneta son cubos distintos', () => {
    const m = buildDemandSignals([moto({ needs: [{ key: 'llantas', remaining: 100, unit: 'km' }] })], ctx())[0];
    const rows = aggregateDemand([...['a', 'b', 'c'].map((f) => ({ sid: f, signal: sig })), ...['d', 'e', 'f'].map((f) => ({ sid: f, signal: m }))]);
    expect(rows).toHaveLength(2);
  });
});
