/**
 * src/lib/e2ee/syncClient.ts — Cliente del respaldo cifrado (sin cuenta).
 *
 * El codigo de respaldo y la clave nunca salen del dispositivo: al servidor solo van el syncId
 * (en la URL), `Authorization: Bearer <authToken>` y el sobre cifrado. En el dispositivo el
 * codigo vive en localStorage['gara:sync:code'] y el estado en 'gara:sync:state'.
 */
import { LOCAL_CHANGED_EVENT } from '../appMode';
import type { LocalDump } from '../local/types';
import { exportLocalData, importLocalData, mergeLocalDumps } from '../local/dump';
import {
  decryptEnvelope,
  deriveKeys,
  encryptEnvelope,
  generateBackupCode,
  isEnvelope,
  parseBackupCode,
  solveCreatePow,
  type BackupKeys,
} from './crypto';

export const SYNC_CODE_KEY = 'gara:sync:code';
export const SYNC_STATE_KEY = 'gara:sync:state';
export const SYNC_AUTO_KEY = 'gara:sync:auto';
export const AUTO_SYNC_DEBOUNCE_MS = 5000;

export interface SyncStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SyncDeps {
  exportDump: () => Promise<LocalDump>;
  importDump: (dump: LocalDump) => Promise<void>;
  merge: (a: LocalDump, b: LocalDump) => LocalDump;
  fetch: typeof fetch;
  storage: SyncStorage;
}

export interface SyncState {
  /** ETag del ultimo respaldo remoto que este dispositivo vio. */
  etag: string | null;
  /** ISO 8601 de la ultima sincronizacion correcta. */
  lastSyncAt: string | null;
}

export type SyncResult =
  | { status: 'ok'; at: string }
  | { status: 'conflict-resolved'; at: string }
  | { status: 'error'; message: string };

export interface RemotePreview {
  dump: LocalDump;
  vehicles: number;
  maintenance: number;
}

const apiUrl = (syncId: string) => `/api/sync/${syncId}`;

export function createSyncClient(overrides: Partial<SyncDeps> = {}) {
  const deps: SyncDeps = {
    exportDump: exportLocalData,
    importDump: importLocalData,
    merge: mergeLocalDumps,
    fetch: (...a) => fetch(...a),
    storage: typeof localStorage !== 'undefined' ? localStorage : memoryStorage(),
    ...overrides,
  };

  const readState = (): SyncState => {
    try {
      const s = JSON.parse(deps.storage.getItem(SYNC_STATE_KEY) ?? 'null');
      return { etag: typeof s?.etag === 'string' ? s.etag : null, lastSyncAt: typeof s?.lastSyncAt === 'string' ? s.lastSyncAt : null };
    } catch {
      return { etag: null, lastSyncAt: null };
    }
  };
  const writeState = (s: SyncState) => deps.storage.setItem(SYNC_STATE_KEY, JSON.stringify(s));

  async function keysFor(code: string): Promise<BackupKeys & { code: string }> {
    const { secret, code: canonical } = await parseBackupCode(code);
    return { ...(await deriveKeys(secret)), code: canonical };
  }

  async function storedKeys(): Promise<(BackupKeys & { code: string }) | null> {
    const code = deps.storage.getItem(SYNC_CODE_KEY);
    return code ? keysFor(code) : null;
  }

  const authHeaders = (k: BackupKeys): Record<string, string> => ({ Authorization: `Bearer ${k.authToken}` });

  async function put(k: BackupKeys, dump: LocalDump, cond: Record<string, string>): Promise<Response> {
    const envelope = await encryptEnvelope(k.encKey, k.syncId, JSON.stringify(dump));
    // Crear exige una prueba de trabajo ligada al id (freno a las inundaciones de respaldos).
    const pow = cond['If-None-Match'] === '*' ? { 'X-Sync-Pow': await solveCreatePow(k.syncId) } : {};
    return deps.fetch(apiUrl(k.syncId), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders(k), ...cond, ...pow },
      body: JSON.stringify(envelope),
      credentials: 'omit',
    });
  }

  const TOO_MANY = 'Demasiados intentos seguidos. Espera un minuto y vuelve a intentarlo.';

  async function get(k: BackupKeys): Promise<{ dump: LocalDump; etag: string } | null> {
    const res = await deps.fetch(apiUrl(k.syncId), { method: 'GET', headers: authHeaders(k), credentials: 'omit', cache: 'no-store' });
    if (res.status === 404) return null;
    if (res.status === 429) throw new Error(TOO_MANY);
    if (!res.ok) throw new Error(`El servidor respondió ${res.status}`);
    const envelope: unknown = await res.json();
    if (!isEnvelope(envelope)) throw new Error('El respaldo remoto no tiene el formato esperado.');
    const dump = JSON.parse(await decryptEnvelope(k.encKey, k.syncId, envelope)) as LocalDump;
    return { dump, etag: res.headers.get('ETag') ?? '' };
  }

  const fail = (e: unknown): SyncResult => ({ status: 'error', message: e instanceof Error ? e.message : String(e) });

  /**
   * Sube el primer respaldo (crea) y devuelve el codigo para mostrarlo. Sin argumento genera un
   * codigo nuevo; la UI lo genera antes (`newCode`), lo muestra, y recien tras la confirmacion
   * del usuario llama a `enable(code)`: si la subida falla no se guarda nada y puede reintentar.
   */
  async function enable(existingCode?: string): Promise<string> {
    const code = existingCode ?? (await generateBackupCode());
    const k = await keysFor(code);
    const res = await put(k, await deps.exportDump(), { 'If-None-Match': '*' });
    if (res.status === 429) throw new Error(TOO_MANY);
    if (res.status !== 201) throw new Error(`No se pudo crear el respaldo (${res.status}).`);
    deps.storage.setItem(SYNC_CODE_KEY, k.code);
    writeState({ etag: res.headers.get('ETag'), lastSyncAt: new Date().toISOString() });
    return k.code;
  }

  async function syncNow(): Promise<SyncResult> {
    try {
      const k = await storedKeys();
      if (!k) return { status: 'error', message: 'El respaldo no está activado en este dispositivo.' };
      const state = readState();
      const local = await deps.exportDump();
      let res = state.etag
        ? await put(k, local, { 'If-Match': state.etag })
        : await put(k, local, { 'If-None-Match': '*' });
      let status: 'ok' | 'conflict-resolved' = 'ok';

      if (res.status === 412) {
        // Otro dispositivo escribio (o el remoto cambio): descifra, fusiona, aplica y reintenta una vez.
        const remote = await get(k);
        if (!remote) return { status: 'error', message: 'El respaldo remoto ya no existe.' };
        const merged = deps.merge(local, remote.dump);
        await deps.importDump(merged);
        res = await put(k, merged, { 'If-Match': remote.etag });
        status = 'conflict-resolved';
      }
      if (res.status === 429) return { status: 'error', message: TOO_MANY };
      if (res.status === 404) return { status: 'error', message: 'El respaldo remoto ya no existe o el código no coincide.' };
      if (!res.ok) return { status: 'error', message: `El servidor respondió ${res.status}.` };
      const at = new Date().toISOString();
      writeState({ etag: res.headers.get('ETag'), lastSyncAt: at });
      return { status, at };
    } catch (e) {
      return fail(e);
    }
  }

  /** Descarga y descifra con un codigo tecleado. No toca nada local. */
  async function preview(code: string): Promise<RemotePreview> {
    const k = await keysFor(code);
    const remote = await get(k);
    if (!remote) throw new Error('No hay un respaldo con ese código.');
    const { entities } = remote.dump;
    return { dump: remote.dump, vehicles: entities?.vehicle?.length ?? 0, maintenance: entities?.maintenance?.length ?? 0 };
  }

  /** Restaura con `code`: reemplaza lo local o lo combina, y deja el respaldo activo en este dispositivo. */
  async function restore(code: string, mode: 'replace' | 'merge'): Promise<RemotePreview> {
    const k = await keysFor(code);
    const remote = await get(k);
    if (!remote) throw new Error('No hay un respaldo con ese código.');
    const next = mode === 'merge' ? deps.merge(await deps.exportDump(), remote.dump) : remote.dump;
    await deps.importDump(next);
    deps.storage.setItem(SYNC_CODE_KEY, k.code);
    writeState({ etag: remote.etag || null, lastSyncAt: new Date().toISOString() });
    const { entities } = next;
    return { dump: next, vehicles: entities?.vehicle?.length ?? 0, maintenance: entities?.maintenance?.length ?? 0 };
  }

  /** Olvida el codigo local; con `deleteRemote` borra tambien el respaldo de la nube. */
  async function disable({ deleteRemote = false }: { deleteRemote?: boolean } = {}): Promise<void> {
    if (deleteRemote) {
      const k = await storedKeys();
      if (k) {
        const res = await deps.fetch(apiUrl(k.syncId), { method: 'DELETE', headers: authHeaders(k), credentials: 'omit' });
        if (!res.ok && res.status !== 404) throw new Error(`No se pudo borrar el respaldo (${res.status}).`);
      }
    }
    deps.storage.removeItem(SYNC_CODE_KEY);
    deps.storage.removeItem(SYNC_STATE_KEY);
    deps.storage.removeItem(SYNC_AUTO_KEY);
  }

  const isEnabled = () => !!deps.storage.getItem(SYNC_CODE_KEY);
  const getCode = () => deps.storage.getItem(SYNC_CODE_KEY);

  /**
   * Sincronizacion automatica: LOCAL_CHANGED_EVENT con debounce de 5 s y subida al pasar a
   * `hidden`. Una subida a la vez. Devuelve la funcion que lo apaga.
   */
  function startAutoSync(onResult?: (r: SyncResult) => void, target: EventTarget = window, doc: Document = document): () => void {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let running = false;
    let again = false;
    const run = async () => {
      if (timer) { clearTimeout(timer); timer = null; }
      if (running) { again = true; return; }
      running = true;
      try {
        do {
          again = false;
          onResult?.(await syncNow());
        } while (again);
      } finally {
        running = false;
      }
    };
    const onChange = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, AUTO_SYNC_DEBOUNCE_MS);
    };
    const onVisibility = () => { if (doc.visibilityState === 'hidden') void run(); };
    target.addEventListener(LOCAL_CHANGED_EVENT, onChange);
    doc.addEventListener('visibilitychange', onVisibility);
    return () => {
      if (timer) clearTimeout(timer);
      target.removeEventListener(LOCAL_CHANGED_EVENT, onChange);
      doc.removeEventListener('visibilitychange', onVisibility);
    };
  }

  return { newCode: generateBackupCode, enable, syncNow, preview, restore, disable, isEnabled, getCode, readState, startAutoSync, readAuto: () => deps.storage.getItem(SYNC_AUTO_KEY) === '1', writeAuto: (on: boolean) => (on ? deps.storage.setItem(SYNC_AUTO_KEY, '1') : deps.storage.removeItem(SYNC_AUTO_KEY)) };
}

export type SyncClient = ReturnType<typeof createSyncClient>;

function memoryStorage(): SyncStorage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}
