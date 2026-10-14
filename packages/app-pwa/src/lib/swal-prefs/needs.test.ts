import { describe, expect, it } from 'vitest';
import { applyNeeds, explainNeeds } from './needs';
import { defaultPrefs } from './resolve';
import { GARA_CORE_MODULES, GARA_NEEDS, GARA_PREFS_SCHEMA as S } from '../prefs.config';

const base = () => defaultPrefs(S);
const ids = (...n: string[]) => n;

describe('applyNeeds (GARA_NEEDS)', () => {
  it('sin necesidades elegidas no cambia nada', () => {
    expect(applyNeeds(S, base(), GARA_NEEDS, [], GARA_CORE_MODULES)).toEqual(base());
  });

  it('solo "Mi vehículo propio": apaga flota, conductores, rastreo y sus paneles; deja el core', () => {
    const p = applyNeeds(S, base(), GARA_NEEDS, ids('own'), GARA_CORE_MODULES);
    for (const m of ['fleets', 'drivers', 'tracking', 'geofences', 'fuel', 'documents', 'alerts', 'analytics']) expect(p.modules[m]).toBe(false);
    for (const m of GARA_CORE_MODULES) expect(p.modules[m]).toBe(true);
    expect(p.panels['dash-fleets'].enabled).toBe(false);
    expect(p.panels['monitoring'].enabled).toBe(false);
    expect(p.panels['state'].enabled).toBe(true);
    expect(p.preset).toBeUndefined();
  });

  it('"Conductores" + "Rastreo en vivo" enciende solo eso (más el core)', () => {
    const p = applyNeeds(S, base(), GARA_NEEDS, ids('drivers', 'live'), GARA_CORE_MODULES);
    expect(p.modules).toMatchObject({ drivers: true, tracking: true, geofences: true, fleets: false, fuel: false, documents: false });
    expect(p.panels['monitoring'].enabled).toBe(true);
  });

  it('un panel pedido por dos necesidades queda activo con una sola elegida', () => {
    const p = applyNeeds(S, base(), GARA_NEEDS, ids('docs'), GARA_CORE_MODULES);
    expect(p.panels['notifier'].enabled).toBe(true);
    expect(p.modules).toMatchObject({ documents: true, alerts: true });
  });

  it('es idempotente y no toca módulos sin necesidad (garaje clásico)', () => {
    const a = applyNeeds(S, base(), GARA_NEEDS, ids('fleet'), GARA_CORE_MODULES);
    expect(applyNeeds(S, a, GARA_NEEDS, ids('fleet'), GARA_CORE_MODULES)).toEqual(a);
    expect(a.modules['game-classic']).toBe(S.modules.find((m) => m.id === 'game-classic')!.default);
  });

  it('todos los ids de GARA_NEEDS existen en el esquema', () => {
    const m = new Set(S.modules.map((x) => x.id));
    const pn = new Set(S.panels.map((x) => x.id));
    for (const n of GARA_NEEDS) {
      for (const id of n.modules) expect(m.has(id), id).toBe(true);
      for (const id of n.panels ?? []) expect(pn.has(id), id).toBe(true);
    }
  });
});

describe('explainNeeds', () => {
  it('dice por qué está activo cada módulo y omite lo que el usuario apagó después', () => {
    let p = applyNeeds(S, base(), GARA_NEEDS, ids('drivers', 'docs'), GARA_CORE_MODULES);
    p = { ...p, modules: { ...p.modules, alerts: false } };
    const r = explainNeeds(S, p, GARA_NEEDS, ids('drivers', 'docs'));
    expect(r.find((x) => x.id === 'drivers')?.because).toEqual(['Conductores']);
    expect(r.find((x) => x.id === 'notifier')?.because).toEqual(['Documentos con vencimiento']);
    expect(r.find((x) => x.id === 'alerts')).toBeUndefined();
  });
});
