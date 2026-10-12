import { describe, expect, it } from 'vitest';
import { computeBaseDpr, QualityGovernor } from './governor';

describe('DPR Policy', () => {
  it('aplica limite de 1.5 en dispositivos tactiles', () => {
    expect(computeBaseDpr(3.0, true)).toBe(1.5);
    expect(computeBaseDpr(2.0, true)).toBe(1.5);
    expect(computeBaseDpr(1.0, true)).toBe(1.0);
  });

  it('aplica limite de 2.0 en dispositivos de escritorio', () => {
    expect(computeBaseDpr(3.0, false)).toBe(2.0);
    expect(computeBaseDpr(2.0, false)).toBe(2.0);
    expect(computeBaseDpr(1.5, false)).toBe(1.5);
    expect(computeBaseDpr(1.0, false)).toBe(1.0);
  });
});

describe('QualityGovernor State Machine', () => {
  it('inicia en tier high por defecto en modo auto', () => {
    const gov = new QualityGovernor({ devicePixelRatio: 2.0, isTouch: false });
    expect(gov.getTier()).toBe('high');
    expect(gov.getDpr()).toBe(2.0);
    expect(gov.getShadowsEnabled()).toBe(true);
    expect(gov.isAuto()).toBe(true);
  });

  it('respeta configuracion manual de tier inicial deshabilitando auto', () => {
    const gov = new QualityGovernor({ initialTier: 'low' });
    expect(gov.getTier()).toBe('low');
    expect(gov.getDpr()).toBe(1.0);
    expect(gov.getShadowsEnabled()).toBe(false);
    expect(gov.isAuto()).toBe(false);

    // En modo manual no debe cambiar ante frames lentos
    for (let i = 0; i < 60; i++) {
      gov.recordFrame(30, 1000 + i * 16);
    }
    expect(gov.getTier()).toBe('low');
  });

  it('baja escalones ante frames lentos (> 18.5 ms por 45 frames) respetando histeresis', () => {
    const gov = new QualityGovernor({ devicePixelRatio: 2.0, isTouch: false });
    let now = 1000;

    // Primeros 44 frames lentos: aun no cambia
    for (let i = 0; i < 44; i++) {
      now += 25;
      const changed = gov.recordFrame(25, now);
      expect(changed).toBe(false);
    }

    // Frame 45 lento: reduce DPR a 1.0 (primer escalon)
    now += 25;
    const changed1 = gov.recordFrame(25, now);
    expect(changed1).toBe(true);
    expect(gov.getTier()).toBe('high');
    expect(gov.getDpr()).toBe(1.0);

    // Intentar bajar antes de que pasen 2 s: la histeresis lo impide
    for (let i = 0; i < 50; i++) {
      now += 25; // avance de ~1250 ms
      const changed = gov.recordFrame(25, now);
      expect(changed).toBe(false);
    }
    expect(gov.getTier()).toBe('high');

    // Avanzar el tiempo para superar los 2 s desde el ultimo cambio
    now += 2500;
    for (let i = 0; i < 44; i++) {
      now += 25;
      gov.recordFrame(25, now);
    }
    // Frame 45 despues de 2s: pasa a medium
    now += 25;
    const changed2 = gov.recordFrame(25, now);
    expect(changed2).toBe(true);
    expect(gov.getTier()).toBe('medium');

    // Avanzar mas de 2s y enviar otros 45 frames lentos: pasa a low
    now += 2500;
    for (let i = 0; i < 45; i++) {
      now += 25;
      gov.recordFrame(25, now);
    }
    expect(gov.getTier()).toBe('low');
    expect(gov.getShadowsEnabled()).toBe(false);
  });

  it('sube de escalon tras 120 frames rapidos (< 12 ms) y al menos 2 s', () => {
    const gov = new QualityGovernor({ devicePixelRatio: 2.0, isTouch: false });
    gov.setTier('low'); // forzar inicio en low
    // Reactivar auto para la prueba de ascenso
    (gov as unknown as { auto: boolean }).auto = true;

    let now = 3000;
    // Enviar 119 frames rapidos: aun no sube
    for (let i = 0; i < 119; i++) {
      now += 8;
      const changed = gov.recordFrame(8, now);
      expect(changed).toBe(false);
    }

    // Frame 120 rapido tras 2 s: sube a medium
    now += 8;
    const changed = gov.recordFrame(8, now);
    expect(changed).toBe(true);
    expect(gov.getTier()).toBe('medium');
    expect(gov.getShadowsEnabled()).toBe(true);
  });
});
