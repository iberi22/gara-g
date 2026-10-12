import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:workers';
import { GET, PUT, DELETE } from '../src/pages/api/sync/[id].js';
import { createSyncClient, SYNC_CODE_KEY, type SyncStorage } from '../src/lib/e2ee/syncClient';
import { parseBackupCode, deriveKeys } from '../src/lib/e2ee/crypto';
import { fakeR2 } from './mocks/fake-r2';
import type { LocalDump } from '../src/lib/local/types';

const envMock = env as unknown as Record<string, unknown>;

const dumpOf = (names: string[], tag = 'x'): LocalDump => ({
  version: 1,
  exportedAt: new Date().toISOString(),
  entities: { vehicle: names.map((n) => ({ id: n, plate: `PLACA-SECRETA-${tag}-${n}`, updated_at: '2026-01-01' }) as any) },
  deleted: {},
  kv: { 'gara:paint': 'rojo-confidencial' },
});

function memStorage(): SyncStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

interface Seen { url: string; headers: string; body: string }
let seen: Seen[];

// fetch que llama a los handlers reales de la API y registra TODO lo que viaja.
const routedFetch: typeof fetch = async (input, init) => {
  const req = new Request(new URL(String(input), 'https://x.test'), init);
  const body = init?.body ? String(init.body) : '';
  seen.push({ url: req.url, headers: JSON.stringify([...req.headers.entries()]), body });
  const id = new URL(req.url).pathname.split('/').pop()!;
  const h = { GET, PUT, DELETE }[req.method as 'GET'];
  return h({ request: req, params: { id } } as any) as Promise<Response>;
};

beforeEach(() => {
  seen = [];
  envMock.SWAL_R2 = fakeR2();
});

function mkClient(local: { dump: LocalDump }, storage = memStorage()) {
  const imported: LocalDump[] = [];
  const client = createSyncClient({
    exportDump: async () => local.dump,
    importDump: async (d) => { imported.push(d); local.dump = d; },
    merge: (a, b) => {
      const ids = new Map<string, any>();
      for (const r of [...(b.entities.vehicle ?? []), ...(a.entities.vehicle ?? [])]) ids.set(r.id, r);
      return { ...a, entities: { vehicle: [...ids.values()] }, kv: { ...b.kv, ...a.kv } };
    },
    fetch: routedFetch,
    storage,
  });
  return { client, imported, storage };
}

describe('syncClient', () => {
  it('enable sube un respaldo cifrado y syncNow lo actualiza', async () => {
    const local = { dump: dumpOf(['a']) };
    const { client, storage } = mkClient(local);
    const code = await client.enable();
    expect(storage.getItem(SYNC_CODE_KEY)).toBe(code);
    expect(client.readState().etag).toBeTruthy();
    expect(await client.syncNow()).toMatchObject({ status: 'ok' });
  });

  it('412 -> descifra, fusiona, importa y reintenta con el etag nuevo', async () => {
    const A = { dump: dumpOf(['a']) };
    const a = mkClient(A);
    const code = await a.client.enable();

    // Dispositivo B restaura (combinando), agrega un vehiculo y sube.
    const B = { dump: dumpOf(['b']) };
    const b = mkClient(B);
    await b.client.restore(code, 'merge');
    B.dump = dumpOf(['a', 'b', 'c']);
    expect((await b.client.syncNow()).status).toBe('ok');

    // A todavia tiene el etag viejo: choca, fusiona y reintenta.
    A.dump = dumpOf(['a', 'd']);
    const r = await a.client.syncNow();
    expect(r.status).toBe('conflict-resolved');
    const ids = (a.imported.at(-1)!.entities.vehicle as any[]).map((v) => v.id).sort();
    expect(ids).toEqual(['a', 'b', 'c', 'd']);

    // y B ve el resultado fusionado
    const p = await b.client.preview(code);
    expect(p.vehicles).toBe(4);
  });

  it('restore reemplaza o combina, y un codigo con error de tecleo no llega a la red', async () => {
    const A = { dump: dumpOf(['a', 'b']) };
    const code = await mkClient(A).client.enable();
    const before = seen.length;
    const bad = code.slice(0, -1) + (code.endsWith('0') ? '1' : '0');
    await expect(mkClient({ dump: dumpOf([]) }).client.restore(bad, 'replace')).rejects.toThrow();
    expect(seen.length).toBe(before);

    const B = { dump: dumpOf(['z']) };
    const rb = mkClient(B);
    await rb.client.restore(code, 'replace');
    expect((B.dump.entities.vehicle as any[]).map((v) => v.id)).toEqual(['a', 'b']);
  });

  it('restore con un codigo bien escrito pero sin respaldo da un error claro', async () => {
    const other = await mkClient({ dump: dumpOf([]) }).client.enable();
    envMock.SWAL_R2 = fakeR2(); // otro servidor: ese codigo ya no tiene respaldo
    await expect(mkClient({ dump: dumpOf([]) }).client.preview(other)).rejects.toThrow(/No hay un respaldo/);
  });

  it('disable olvida el codigo y, si se pide, borra el respaldo remoto', async () => {
    const local = { dump: dumpOf(['a']) };
    const { client, storage } = mkClient(local);
    const code = await client.enable();
    await client.disable({ deleteRemote: true });
    expect(storage.getItem(SYNC_CODE_KEY)).toBeNull();
    await expect(mkClient({ dump: dumpOf([]) }).client.preview(code)).rejects.toThrow(/No hay un respaldo/);
    expect((await client.syncNow()).status).toBe('error');
  });

  it('GARANTIA: el codigo, la clave y el texto plano nunca viajan', async () => {
    const local = { dump: dumpOf(['a', 'b'], 'zeta') };
    const { client } = mkClient(local);
    const code = await client.enable();
    await client.syncNow();
    local.dump = dumpOf(['a', 'b', 'c'], 'zeta');
    await client.syncNow();
    await client.preview(code);
    await client.disable({ deleteRemote: true });

    const { secret } = await parseBackupCode(code);
    const keys = await deriveKeys(secret);
    const forbidden = [
      code,
      code.replace(/-/g, ''),
      code.toLowerCase(),
      Buffer.from(secret).toString('hex'),
      Buffer.from(secret).toString('base64'),
      Buffer.from(secret).toString('base64url'),
      'PLACA-SECRETA',
      'rojo-confidencial',
      'vehicle',
    ];
    expect(seen.length).toBeGreaterThan(4);
    for (const s of seen) {
      for (const f of forbidden) {
        expect(s.url).not.toContain(f);
        expect(s.headers).not.toContain(f);
        expect(s.body).not.toContain(f);
      }
      // lo unico permitido: syncId en la URL y el authToken en Authorization
      expect(s.url).toBe(`https://x.test/api/sync/${keys.syncId}`);
      expect(s.headers).not.toContain('cookie');
    }
    // el authToken no aparece ni en la URL ni en el cuerpo
    for (const s of seen) {
      expect(s.url).not.toContain(keys.authToken);
      expect(s.body).not.toContain(keys.authToken);
    }
  });
});

describe('syncClient: limites de abuso', () => {
  it('crear envia la prueba de trabajo; actualizar no', async () => {
    const { client } = mkClient({ dump: dumpOf(['a']) });
    await client.enable();
    await client.syncNow();
    const puts = seen.filter((s) => JSON.parse(s.headers).some(([k]: string[]) => k === 'if-none-match' || k === 'if-match'));
    expect(JSON.parse(puts[0].headers).some(([k]: string[]) => k === 'x-sync-pow')).toBe(true);
    expect(JSON.parse(puts[1].headers).some(([k]: string[]) => k === 'x-sync-pow')).toBe(false);
  });

  it('un 429 al crear o sincronizar da un mensaje claro en espanol', async () => {
    const deny = { limit: async () => ({ success: false }) };
    const { client } = mkClient({ dump: dumpOf(['a']) });
    envMock.SYNC_CREATE_LIMITER = deny;
    await expect(client.enable()).rejects.toThrow('Demasiados intentos seguidos');
    delete envMock.SYNC_CREATE_LIMITER;
    await client.enable();
    envMock.SYNC_UPDATE_LIMITER = deny;
    const r = await client.syncNow();
    delete envMock.SYNC_UPDATE_LIMITER;
    expect(r).toMatchObject({ status: 'error' });
    expect((r as any).message).toContain('Demasiados intentos seguidos');
  });
});

