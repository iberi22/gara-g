/**
 * swal-prefs/store.ts — Preferencias en el navegador: cache local + servidor.
 *
 * Arranca con lo que haya en localStorage (pinta al instante), pide al servidor la version
 * del usuario y guarda los cambios en los dos lados. Emite `swal:prefschange` en `document`
 * con las preferencias resueltas, para que cualquier isla (menu, garage) reaccione.
 * El servidor es la fuente de verdad: las preferencias siguen al usuario entre equipos.
 */
import { resolvePrefs } from './resolve';
import type { Preferences, PrefsSchema } from './schema';

export interface PrefsStoreOptions {
  schema: PrefsSchema;
  /** GET/PUT con { prefs }. */
  endpoint: string;
  storageKey?: string;
  fetcher?: typeof fetch;
}

export interface PrefsStore {
  get(): Preferences;
  load(): Promise<Preferences>;
  save(next: Preferences): Promise<{ ok: boolean; prefs: Preferences; error?: string }>;
  subscribe(fn: (p: Preferences) => void): () => void;
}

export const PREFS_EVENT = 'swal:prefschange';

export function createPrefsStore(opts: PrefsStoreOptions): PrefsStore {
  const key = opts.storageKey ?? 'swal:prefs';
  const doFetch = opts.fetcher ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const subs = new Set<(p: Preferences) => void>();

  const readLocal = (): unknown => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : undefined;
    } catch {
      return undefined;
    }
  };
  const writeLocal = (p: Preferences) => {
    try {
      localStorage.setItem(key, JSON.stringify(p));
    } catch {
      /* sin almacenamiento: solo servidor */
    }
  };

  let current = resolvePrefs(opts.schema, readLocal());

  const emit = () => {
    for (const fn of subs) fn(current);
    if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent(PREFS_EVENT, { detail: current }));
  };

  return {
    get: () => current,
    async load() {
      try {
        const res = await doFetch(opts.endpoint, { credentials: 'same-origin' });
        if (res.ok) {
          const data = (await res.json()) as { prefs?: unknown };
          current = resolvePrefs(opts.schema, data.prefs);
          writeLocal(current);
          emit();
        }
      } catch {
        /* sin red: queda la copia local */
      }
      return current;
    },
    async save(next) {
      const resolved = resolvePrefs(opts.schema, { ...next, version: opts.schema.version });
      current = resolved;
      writeLocal(current);
      emit();
      try {
        const res = await doFetch(opts.endpoint, {
          method: 'PUT',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prefs: resolved }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          return { ok: false, prefs: current, error: data.error ?? `HTTP ${res.status}` };
        }
        const data = (await res.json()) as { prefs?: unknown };
        current = resolvePrefs(opts.schema, data.prefs ?? resolved);
        writeLocal(current);
        return { ok: true, prefs: current };
      } catch {
        return { ok: false, prefs: current, error: 'Sin conexion: se guardo solo en este equipo' };
      }
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}
