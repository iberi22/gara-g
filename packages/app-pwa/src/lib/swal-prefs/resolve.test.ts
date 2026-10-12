import { describe, expect, it } from 'vitest';
import { applyPreset, defaultPrefs, isModuleEnabled, isPanelEnabled, moduleGroups, panelOption, panelScopes, resolvePrefs } from './resolve';
import type { PrefsSchema } from './schema';
import { GARA_PREFS_SCHEMA } from '../prefs.config';

const schema: PrefsSchema = {
  version: 2,
  modules: [
    { id: 'home', label: 'Inicio', group: 'A', default: true, required: true },
    { id: 'maps', label: 'Mapas', group: 'A', default: true },
    { id: 'beta', label: 'Beta', group: 'B', default: false },
  ],
  panels: [
    {
      id: 'chart',
      label: 'Grafico',
      scope: 'Dash',
      default: true,
      options: [
        { id: 'rows', label: 'Filas', type: 'number', default: 5, min: 1, max: 10 },
        { id: 'kind', label: 'Tipo', type: 'select', default: 'bar', choices: [{ value: 'bar', label: 'Barras' }, { value: 'line', label: 'Linea' }] },
        { id: 'legend', label: 'Leyenda', type: 'toggle', default: true },
      ],
    },
    { id: 'core', label: 'Nucleo', scope: 'Dash', default: true, required: true },
  ],
  presets: [{ id: 'lite', label: 'Ligero', modules: { maps: false, ghost: true }, panels: { chart: false } }],
};

describe('resolvePrefs', () => {
  it('sin nada guardado devuelve los defaults y onboarded=false', () => {
    const p = defaultPrefs(schema);
    expect(p.version).toBe(2);
    expect(p.onboarded).toBe(false);
    expect(p.modules).toEqual({ home: true, maps: true, beta: false });
    expect(p.panels.chart).toEqual({ enabled: true, options: { rows: 5, kind: 'bar', legend: true } });
  });

  it('descarta claves desconocidas y tipos equivocados', () => {
    const p = resolvePrefs(schema, {
      version: 2,
      onboarded: true,
      modules: { maps: 'no', beta: true, evil: true },
      panels: { chart: { enabled: 0, options: { rows: '9', kind: 'pie', legend: false, x: 1 } }, ghost: { enabled: true } },
    });
    expect(p.onboarded).toBe(true);
    expect(p.modules).toEqual({ home: true, maps: true, beta: true });
    expect(p.panels.chart).toEqual({ enabled: true, options: { rows: 5, kind: 'bar', legend: false } });
    expect('ghost' in p.panels).toBe(false);
  });

  it('los required no se pueden apagar', () => {
    const p = resolvePrefs(schema, { modules: { home: false }, panels: { core: { enabled: false } } });
    expect(p.modules.home).toBe(true);
    expect(p.panels.core.enabled).toBe(true);
  });

  it('acota los numeros a [min, max] y rechaza NaN', () => {
    expect(resolvePrefs(schema, { panels: { chart: { options: { rows: 99 } } } }).panels.chart.options.rows).toBe(10);
    expect(resolvePrefs(schema, { panels: { chart: { options: { rows: -3 } } } }).panels.chart.options.rows).toBe(1);
    expect(resolvePrefs(schema, { panels: { chart: { options: { rows: Number.NaN } } } }).panels.chart.options.rows).toBe(5);
  });

  it('una version vieja conserva las elecciones pero vuelve a pedir onboarding', () => {
    const p = resolvePrefs(schema, { version: 1, onboarded: true, modules: { maps: false } });
    expect(p.onboarded).toBe(false);
    expect(p.modules.maps).toBe(false);
  });

  it('entradas basura no rompen', () => {
    for (const junk of [null, 42, 'x', [], { modules: [1, 2] }, { panels: { chart: 'on' } }]) {
      expect(resolvePrefs(schema, junk).modules.home).toBe(true);
    }
  });
});

describe('applyPreset', () => {
  it('aplica lo que el preset menciona e ignora ids desconocidos', () => {
    const p = applyPreset(schema, defaultPrefs(schema), 'lite');
    expect(p.preset).toBe('lite');
    expect(p.modules).toEqual({ home: true, maps: false, beta: false });
    expect(p.panels.chart.enabled).toBe(false);
    expect(p.panels.chart.options.rows).toBe(5);
  });

  it('un preset inexistente no cambia nada', () => {
    const base = defaultPrefs(schema);
    expect(applyPreset(schema, base, 'nope')).toBe(base);
  });
});

describe('consultas', () => {
  it('isModuleEnabled / isPanelEnabled / panelOption', () => {
    const p = resolvePrefs(schema, { modules: { maps: false }, panels: { chart: { enabled: false, options: { kind: 'line' } } } });
    expect(isModuleEnabled(p, 'maps')).toBe(false);
    expect(isModuleEnabled(p, 'unknown')).toBe(true);
    expect(isPanelEnabled(p, 'chart')).toBe(false);
    expect(panelOption(p, 'chart', 'kind', 'bar')).toBe('line');
    expect(panelOption(p, 'chart', 'missing', 7)).toBe(7);
  });

  it('agrupa en el orden del esquema', () => {
    expect(moduleGroups(schema).map((g) => g.group)).toEqual(['A', 'B']);
    expect(panelScopes(schema)[0].panels.map((p) => p.id)).toEqual(['chart', 'core']);
  });
});

describe('esquema de GARA-G', () => {
  it('ids unicos, defaults validos y presets que solo nombran ids existentes', () => {
    const s = GARA_PREFS_SCHEMA;
    const mods = s.modules.map((m) => m.id);
    const pans = s.panels.map((p) => p.id);
    expect(new Set(mods).size).toBe(mods.length);
    expect(new Set(pans).size).toBe(pans.length);
    for (const preset of s.presets ?? []) {
      for (const id of Object.keys(preset.modules ?? {})) expect(mods).toContain(id);
      for (const id of Object.keys(preset.panels ?? {})) expect(pans).toContain(id);
    }
    // Lo resuelto desde cero coincide con los defaults declarados (ningun default invalido).
    const d = defaultPrefs(s);
    for (const p of s.panels) for (const o of p.options ?? []) expect(d.panels[p.id].options[o.id]).toBe(o.default);
  });
});
