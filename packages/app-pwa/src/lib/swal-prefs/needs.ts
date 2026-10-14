/**
 * swal-prefs/needs.ts — "Que necesitas" → modulos y paneles (funciones puras, sin Svelte).
 *
 * El onboarding pregunta necesidades en lenguaje del usuario ("Conductores", "Rastreo en vivo")
 * y las traduce a los modulos y paneles del esquema. Cada necesidad declara lo que ENCIENDE.
 * Lo que alguna necesidad reclama y ninguna de las elegidas pide, se apaga; lo que ninguna
 * necesidad menciona, y los modulos `core`, no se tocan. Sin necesidades elegidas no cambia nada
 * (los perfiles siguen siendo el atajo). Portable: solo importa ./resolve y ./schema.
 */
import { resolvePrefs } from './resolve';
import type { Preferences, PrefsSchema } from './schema';

export interface Need {
  id: string;
  label: string;
  desc?: string;
  /** Modulos que enciende (ids del esquema). */
  modules: string[];
  /** Paneles que enciende (ids del esquema). */
  panels?: string[];
}

export interface NeedReason {
  kind: 'module' | 'panel';
  id: string;
  label: string;
  /** Etiquetas de las necesidades elegidas que lo piden. */
  because: string[];
}

/**
 * Aplica las necesidades elegidas sobre las preferencias. `core` son modulos que nunca se
 * apagan por falta de necesidad. Quita el `preset` si hay necesidades (la configuracion ya no
 * es la del perfil). Es idempotente: depende solo del conjunto elegido.
 */
export function applyNeeds(schema: PrefsSchema, prefs: Preferences, needs: Need[], selected: string[], core: string[] = []): Preferences {
  const chosen = needs.filter((n) => selected.includes(n.id));
  if (!chosen.length) return prefs;
  const wantM = new Set(chosen.flatMap((n) => n.modules));
  const wantP = new Set(chosen.flatMap((n) => n.panels ?? []));
  const claimM = new Set(needs.flatMap((n) => n.modules));
  const claimP = new Set(needs.flatMap((n) => n.panels ?? []));
  const next: Preferences = { ...prefs, modules: { ...prefs.modules }, panels: { ...prefs.panels } };
  delete next.preset;
  for (const id of claimM) {
    if (!(id in next.modules)) continue;
    if (wantM.has(id)) next.modules[id] = true;
    else if (!core.includes(id)) next.modules[id] = false;
  }
  for (const id of claimP) {
    if (!(id in next.panels)) continue;
    next.panels[id] = { ...next.panels[id], enabled: wantP.has(id) };
  }
  return resolvePrefs(schema, next);
}

/** Por que esta activo cada modulo/panel pedido: solo lo que sigue activo en `prefs`. */
export function explainNeeds(schema: PrefsSchema, prefs: Preferences, needs: Need[], selected: string[]): NeedReason[] {
  const chosen = needs.filter((n) => selected.includes(n.id));
  const out: NeedReason[] = [];
  for (const m of schema.modules) {
    const because = chosen.filter((n) => n.modules.includes(m.id)).map((n) => n.label);
    if (because.length && prefs.modules[m.id] !== false) out.push({ kind: 'module', id: m.id, label: m.label, because });
  }
  for (const p of schema.panels) {
    const because = chosen.filter((n) => (n.panels ?? []).includes(p.id)).map((n) => n.label);
    if (because.length && prefs.panels[p.id]?.enabled !== false) out.push({ kind: 'panel', id: p.id, label: p.label, because });
  }
  return out;
}
