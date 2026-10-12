/**
 * callouts.test.ts — Pruebas de las llamadas flotantes del plano.
 *
 * Lo que se vigila es que las dos llamadas digan cosas DISTINTAS: el dominio devuelve las
 * pastillas de un mismo eje con la misma etiqueta, y sin desambiguar la pantalla mostraba dos
 * llamadas identicas.
 */
import { describe, expect, it } from 'vitest';

import { buildCallouts, partCalloutValue, shortPartLabel, slotSuffix, type CalloutPart } from './callouts';

function part(over: Partial<CalloutPart> & Pick<CalloutPart, 'slotId'>): CalloutPart {
  return {
    label: 'Pieza',
    category: 'mecanico',
    status: 'ok',
    healthPct: 90,
    ...over,
  };
}

describe('slotSuffix', () => {
  it('traduce el lado de las ranuras de carro a palabras completas', () => {
    // "DER" se leia como un codigo opaco en el plano; la palabra entera se lee sola.
    expect(slotSuffix('brake_fl')).toBe('IZQUIERDA');
    expect(slotSuffix('brake_fr')).toBe('DERECHA');
    expect(slotSuffix('suspension_rl')).toBe('IZQUIERDA');
    expect(slotSuffix('suspension_rr')).toBe('DERECHA');
  });

  it('traduce las ranuras de moto por delante/detras', () => {
    expect(slotSuffix('brake_front')).toBe('DELANTERO');
    expect(slotSuffix('brake_rear')).toBe('TRASERO');
  });

  it('devuelve null si la ranura no distingue lado', () => {
    expect(slotSuffix('battery')).toBeNull();
    expect(slotSuffix('engine_oil')).toBeNull();
  });
});

describe('shortPartLabel', () => {
  it('se queda con la primera palabra en mayusculas, como el plano de referencia', () => {
    expect(shortPartLabel('Aceite 10W-40 moto')).toBe('ACEITE');
    expect(shortPartLabel('Pastillas freno delantero')).toBe('PASTILLAS');
  });

  it('quita las tildes, que en el plano rompen el tracking amplio', () => {
    expect(shortPartLabel('Batería 12V')).toBe('BATERIA');
    expect(shortPartLabel('Refrigeración')).toBe('REFRIGERACION');
  });

  it('cae a la categoria si la etiqueta no trae palabra', () => {
    expect(shortPartLabel('   ', 'mecanico')).toBe('MECANICO');
  });
});

describe('partCalloutValue', () => {
  it('usa el motivo del vencimiento cuando la pieza esta vencida', () => {
    // El motivo manda sobre el porcentaje: dice QUE hay que hacer, no solo cuanto queda.
    expect(partCalloutValue('overdue', 12)).toBe('VENCIDO');
    expect(partCalloutValue('overdue', null)).toBe('VENCIDO');
  });

  it('muestra la salud en porcentaje en el resto de estados', () => {
    expect(partCalloutValue('warn', 31.4)).toBe('31 %');
    expect(partCalloutValue('critical', 8)).toBe('8 %');
  });

  it('redondea la salud y cae a un texto legible si no hay numero', () => {
    expect(partCalloutValue('warn', 31.6)).toBe('32 %');
    expect(partCalloutValue('warn', null)).toBe('REVISAR');
    expect(partCalloutValue('warn', Number.NaN)).toBe('REVISAR');
    expect(partCalloutValue('critical', null)).toBe('CRÍTICA');
  });
});

describe('buildCallouts', () => {
  it('elige como mucho dos piezas y solo las urgentes', () => {
    const out = buildCallouts([
      part({ slotId: 'battery', label: 'Bateria 12V', status: 'warn', healthPct: 16 }),
      part({ slotId: 'oil', label: 'Aceite 10W-40', status: 'overdue', healthPct: 5 }),
      part({ slotId: 'tires', label: 'Llantas', status: 'ok', healthPct: 92 }),
      part({ slotId: 'coolant', label: 'Refrigerante', status: 'warn', healthPct: 44 }),
      part({ slotId: 'filter', label: 'Filtro de aire', status: 'warn', healthPct: 60 }),
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((c) => c.slotId)).toEqual(['oil', 'battery']);
    // 'tires' esta en ok: nunca sale.
    expect(out.some((c) => c.slotId === 'tires')).toBe(false);
  });

  it('ordena por estado y luego por salud ascendente', () => {
    const out = buildCallouts([
      part({ slotId: 'a', label: 'A', status: 'warn', healthPct: 50 }),
      part({ slotId: 'b', label: 'B', status: 'critical', healthPct: 30 }),
      part({ slotId: 'c', label: 'C', status: 'overdue', healthPct: 80 }),
    ]);
    expect(out.map((c) => c.slotId)).toEqual(['c', 'b', 'a'].slice(0, 2));
  });

  it('desambigua con el lado dos piezas criticas del mismo eje', () => {
    // Regresion: el dominio devuelve las dos pastillas con la MISMA etiqueta.
    const out = buildCallouts([
      part({ slotId: 'brake_fl', label: 'Pastillas freno delantero', status: 'warn', healthPct: 21.78 }),
      part({ slotId: 'brake_fr', label: 'Pastillas freno delantero', status: 'warn', healthPct: 21.78 }),
    ]);
    expect(out).toHaveLength(2);
    // Dos llamadas con el mismo texto no aportan nada en el plano.
    expect(out[0].label).not.toBe(out[1].label);
    // La primera se queda como esta; la segunda, que repetiria texto, se refina con el lado.
    expect(out[0].label).toBe('PASTILLAS');
    expect(out[1].label).toBe('PASTILLAS DERECHA');
  });

  it('descarta la segunda si no se puede desambiguar', () => {
    // Misma etiqueta y ranuras sin lado: mejor una llamada clara que dos identicas.
    const out = buildCallouts([
      part({ slotId: 'spark_plugs_1', label: 'Bujia', status: 'warn', healthPct: 24 }),
      part({ slotId: 'spark_plugs_2', label: 'Bujia', status: 'warn', healthPct: 24 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].label).toBe('BUJIA');
  });

  it('marca urgente solo lo vencido o critico', () => {
    const out = buildCallouts([
      part({ slotId: 'oil', label: 'Aceite', status: 'overdue', healthPct: 3 }),
      part({ slotId: 'battery', label: 'Bateria', status: 'warn', healthPct: 20 }),
    ]);
    expect(out[0].urgent).toBe(true);
    expect(out[1].urgent).toBe(false);
  });

  it('devuelve vacio si no hay nada urgente', () => {
    expect(buildCallouts([part({ slotId: 'x', label: 'X', status: 'ok', healthPct: 99 })])).toEqual([]);
  });
});