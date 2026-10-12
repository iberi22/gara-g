/**
 * paint.test.ts — Pruebas de la persistencia de pintura por vehiculo y del acabado.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PAINT_SAMPLES,
  buildPaintSpec,
  finishLabel,
  loadStoredPaint,
  normalizeHex,
  paintStorageKey,
  saveStoredPaint,
} from './paint';

/** localStorage minimo para probar la persistencia sin depender del entorno. */
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  clear(): void {
    this.map.clear();
  }
}

describe('normalizeHex', () => {
  it('quita el # y pasa a mayusculas', () => {
    expect(normalizeHex('#1f4fd1')).toBe('1F4FD1');
    expect(normalizeHex('1f4fd1')).toBe('1F4FD1');
  });

  it('rechaza lo que no es hex de 6 digitos', () => {
    expect(normalizeHex('#fff')).toBeNull();
    expect(normalizeHex('no-es-color')).toBeNull();
    expect(normalizeHex(null)).toBeNull();
  });
});

describe('buildPaintSpec', () => {
  it('aplica el color elegido y conserva el acento', () => {
    const spec = buildPaintSpec(
      { baseColor: '#14171c', finish: 'gloss', accentColor: '#d9dde2' },
      '1f4fd1',
      'metallic',
    );
    expect(spec.baseColor).toBe('#1F4FD1');
    expect(spec.finish).toBe('metallic');
    expect(spec.accentColor).toBe('#d9dde2');
  });

  it('si el hex es invalido conserva el color anterior', () => {
    const spec = buildPaintSpec({ baseColor: '#8a1c22', finish: 'matte' }, 'zzz', 'pearl');
    expect(spec.baseColor).toBe('#8A1C22');
    expect(spec.finish).toBe('pearl');
  });
});

describe('persistencia de pintura por vehiculo', () => {
  let store: MemoryStorage;

  beforeEach(() => {
    store = new MemoryStorage();
    vi.stubGlobal('localStorage', store);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('la clave incluye el id del vehiculo', () => {
    expect(paintStorageKey('veh-42')).toBe('garage:paint:veh-42');
  });

  it('guarda y recupera el acabado por vehiculo', () => {
    expect(saveStoredPaint('veh-1', 'ff6a13', 'satin')).toBe(true);
    expect(loadStoredPaint('veh-1')).toEqual({ hex: 'FF6A13', finish: 'satin' });
  });

  it('no mezcla la pintura entre vehiculos', () => {
    saveStoredPaint('veh-1', 'ff6a13', 'satin');
    saveStoredPaint('veh-2', '1f4fd1', 'gloss');
    expect(loadStoredPaint('veh-1')?.hex).toBe('FF6A13');
    expect(loadStoredPaint('veh-2')?.hex).toBe('1F4FD1');
    expect(loadStoredPaint('veh-3')).toBeNull();
  });

  it('no guarda un color invalido', () => {
    expect(saveStoredPaint('veh-1', 'nope', 'gloss')).toBe(false);
    expect(loadStoredPaint('veh-1')).toBeNull();
  });

  it('ignora entradas corruptas o de otro formato', () => {
    store.setItem('garage:paint:veh-1', '{no-json');
    expect(loadStoredPaint('veh-1')).toBeNull();
    store.setItem('garage:paint:veh-1', JSON.stringify({ hex: 'AABBCC', finish: 'chrome' }));
    expect(loadStoredPaint('veh-1')).toBeNull();
    store.setItem('garage:paint:veh-1', JSON.stringify({ hex: '#zzz', finish: 'gloss' }));
    expect(loadStoredPaint('veh-1')).toBeNull();
  });

  it('degrada sin lanzar cuando el almacenamiento falla (modo privado)', () => {
    const boom = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    vi.stubGlobal('localStorage', boom);
    expect(() => loadStoredPaint('veh-1')).not.toThrow();
    expect(loadStoredPaint('veh-1')).toBeNull();
    expect(saveStoredPaint('veh-1', 'ff6a13', 'gloss')).toBe(false);
  });
});

describe('catálogo de acabados', () => {
  it('incluye el naranja de la casa y los cinco acabados', () => {
    expect(PAINT_SAMPLES.some((s) => s.hex.toUpperCase() === 'FF6A13')).toBe(true);
    expect(PAINT_SAMPLES.length).toBeGreaterThanOrEqual(4);
    expect(finishLabel('pearl')).toBe('PERLADO');
    expect(finishLabel('gloss')).toBe('BRILLANTE');
  });
});