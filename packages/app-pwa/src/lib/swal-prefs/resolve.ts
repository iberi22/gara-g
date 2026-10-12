/**
 * swal-prefs/resolve.ts — Funciones puras: preferencias guardadas + esquema → preferencias validas.
 *
 * Todo lo que llega guardado (localStorage, servidor) es no confiable: claves desconocidas se
 * descartan, tipos equivocados vuelven al valor por defecto, los modulos y paneles `required`
 * quedan siempre activos y los numeros se acotan a [min, max]. Asi una version vieja o un
 * cliente manipulado no puede dejar la interfaz sin menu.
 */
import type { PanelPrefs, Preferences, PrefOptionDef, PrefsSchema } from './schema';

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function optionValue(def: PrefOptionDef, raw: unknown): boolean | string | number {
  switch (def.type) {
    case 'toggle':
      return typeof raw === 'boolean' ? raw : (def.default as boolean);
    case 'select':
      return typeof raw === 'string' && (def.choices ?? []).some((c) => c.value === raw) ? raw : (def.default as string);
    case 'number': {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) return def.default as number;
      const lo = def.min ?? -Infinity;
      const hi = def.max ?? Infinity;
      return Math.min(hi, Math.max(lo, raw));
    }
    default:
      return def.default;
  }
}

/** Preferencias por defecto del esquema (sin onboarding hecho). */
export function defaultPrefs(schema: PrefsSchema): Preferences {
  return resolvePrefs(schema, undefined);
}

/** Valida y completa lo guardado contra el esquema. */
export function resolvePrefs(schema: PrefsSchema, stored: unknown): Preferences {
  const src = isObj(stored) ? stored : {};
  const mods = isObj(src.modules) ? src.modules : {};
  const pans = isObj(src.panels) ? src.panels : {};

  const modules: Record<string, boolean> = {};
  for (const m of schema.modules) {
    const v = mods[m.id];
    modules[m.id] = m.required ? true : typeof v === 'boolean' ? v : m.default;
  }

  const panels: Record<string, PanelPrefs> = {};
  for (const p of schema.panels) {
    const raw = isObj(pans[p.id]) ? (pans[p.id] as Record<string, unknown>) : {};
    const rawOpts = isObj(raw.options) ? raw.options : {};
    const options: PanelPrefs['options'] = {};
    for (const o of p.options ?? []) options[o.id] = optionValue(o, rawOpts[o.id]);
    panels[p.id] = {
      enabled: p.required ? true : typeof raw.enabled === 'boolean' ? raw.enabled : p.default,
      options,
    };
  }

  const preset = typeof src.preset === 'string' && (schema.presets ?? []).some((x) => x.id === src.preset) ? src.preset : undefined;
  return {
    version: schema.version,
    onboarded: src.version === schema.version && src.onboarded === true,
    ...(preset ? { preset } : {}),
    modules,
    panels,
    ...(typeof src.updatedAt === 'string' ? { updatedAt: src.updatedAt } : {}),
  };
}

/** Aplica un preset sobre las preferencias (lo que el preset no menciona queda igual). */
export function applyPreset(schema: PrefsSchema, prefs: Preferences, presetId: string): Preferences {
  const preset = (schema.presets ?? []).find((p) => p.id === presetId);
  if (!preset) return prefs;
  const next: Preferences = { ...prefs, preset: presetId, modules: { ...prefs.modules }, panels: { ...prefs.panels } };
  for (const [id, on] of Object.entries(preset.modules ?? {})) if (id in next.modules) next.modules[id] = on;
  for (const [id, on] of Object.entries(preset.panels ?? {})) if (id in next.panels) next.panels[id] = { ...next.panels[id], enabled: on };
  return resolvePrefs(schema, next);
}

export function isModuleEnabled(prefs: Preferences, id: string): boolean {
  return prefs.modules[id] !== false;
}

export function isPanelEnabled(prefs: Preferences, id: string): boolean {
  return prefs.panels[id]?.enabled !== false;
}

export function panelOption<T extends boolean | string | number>(prefs: Preferences, panelId: string, optionId: string, fallback: T): T {
  const v = prefs.panels[panelId]?.options?.[optionId];
  return (v === undefined ? fallback : v) as T;
}

/** Grupos de modulos en el orden del esquema (para la interfaz). */
export function moduleGroups(schema: PrefsSchema): { group: string; modules: PrefsSchema['modules'] }[] {
  const out: { group: string; modules: PrefsSchema['modules'] }[] = [];
  for (const m of schema.modules) {
    let g = out.find((x) => x.group === m.group);
    if (!g) out.push((g = { group: m.group, modules: [] }));
    g.modules.push(m);
  }
  return out;
}

/** Paneles por pantalla (scope) en el orden del esquema. */
export function panelScopes(schema: PrefsSchema): { scope: string; panels: PrefsSchema['panels'] }[] {
  const out: { scope: string; panels: PrefsSchema['panels'] }[] = [];
  for (const p of schema.panels) {
    let g = out.find((x) => x.scope === p.scope);
    if (!g) out.push((g = { scope: p.scope, panels: [] }));
    g.panels.push(p);
  }
  return out;
}
