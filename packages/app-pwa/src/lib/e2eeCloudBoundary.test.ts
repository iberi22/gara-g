// Frontera E2EE: la nube (R2 + D1 + KV) NO puede descifrar nada.
//
// Este test existe porque la promesa "el operador no puede leer" era FALSA: el adaptador subia a R2
// el pack completo (con las 3 shares del reparto Shamir) y ADEMAS guardaba las 3 en KV. Como el
// reparto es 2-de-3, con lo que habia en R2 se reconstruia la DEK. Ahora R2 guarda el pack sin
// shares, KV guarda un unico share (x=3) y los shares x=1 (dispositivo) y x=2 (recuperacion) no
// salen del equipo; por tanto la nube entera suma 1 share y no alcanza el umbral.
import { describe, it, expect, beforeEach } from 'vitest';
import { CloudflareVaultAdapter, type CloudflareEnv } from './cloudflareVaultAdapter';
import { reconstructDEK, unpackSealedPack } from '@swal/vault/sealedPack.js';
// Polyfill local para crypto en vitest
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto as any;
import 'fake-indexeddb/auto';

function fakeCloud() {
  const r2 = new Map<string, string>();
  const kv = new Map<string, string>();
  const env: CloudflareEnv = {
    SWAL_R2: {
      put: async (k: string, v: string) => void r2.set(k, v),
      get: async (k: string) => {
        const v = r2.get(k);
        return v === undefined ? null : { text: async () => v };
      },
      delete: async (k: string) => void r2.delete(k),
      list: async () => ({ objects: [] as unknown[] }),
    },
    SWAL_KV: {
      put: async (k: string, v: string) => void kv.set(k, v),
      get: async (k: string) => kv.get(k) ?? null,
    },
  };
  return { env, r2, kv };
}

const SECRETO = 'dato-confidencial-del-cliente-12345';
const rec = () => ({
  id: 'r1',
  instance_id: 'inst1',
  created_at: '2026-09-10T00:00:00Z',
  updated_at: '2026-09-10T00:00:00Z',
  secreto: SECRETO,
});

describe('frontera E2EE — la nube no puede descifrar', () => {
  beforeEach(async () => {
    // Limpiar IndexedDB antes de cada test para el nuevo store persistente
    const dbs = await indexedDB.databases();
    for (const db of dbs) {
      if (db.name) indexedDB.deleteDatabase(db.name);
    }
  });

  it('R2 guarda el pack SIN shares (antes iban las 3)', async () => {
    const { env, r2 } = fakeCloud();
    const adapter = new CloudflareVaultAdapter(env, 'app-e2ee');
    await adapter.create('item', rec() as any);

    const claves = [...r2.keys()];
    expect(claves).toHaveLength(1);
    const pack = JSON.parse(r2.get(claves[0])!);
    expect(pack.ciphertext, 'debe haber ciphertext').toBeTruthy();
    expect(pack.shares ?? []).toHaveLength(0);
    // El ciphertext no puede contener el texto plano.
    expect(JSON.stringify(pack)).not.toContain(SECRETO);
  });

  it('KV guarda exactamente UN share y es el x=3', async () => {
    const { env, kv } = fakeCloud();
    const adapter = new CloudflareVaultAdapter(env, 'app-e2ee');
    await adapter.create('item', rec() as any);

    const entradas = [...kv.entries()];
    expect(entradas, 'una sola entrada en KV').toHaveLength(1);
    const shares = JSON.parse(entradas[0][1]);
    expect(shares).toHaveLength(1);
    expect(shares[0].index).toBe(3);
  });

  it('TODO lo que posee la nube (R2 + KV) no reconstruye la DEK ni descifra', async () => {
    const { env, r2, kv } = fakeCloud();
    const adapter = new CloudflareVaultAdapter(env, 'app-e2ee');
    await adapter.create('item', rec() as any);

    const pack = JSON.parse([...r2.values()][0]);
    const kvShares = JSON.parse([...kv.values()][0]);

    // 1 share < umbral 2: la reconstruccion debe fallar.
    expect(() => reconstructDEK(kvShares)).toThrow();
    // Y el descifrado del pack con solo el share de KV tampoco puede.
    await expect(unpackSealedPack(pack, kvShares)).rejects.toThrow();
  });

  it('con el share del dispositivo + el de KV sí descifra (round trip)', async () => {
    const { env } = fakeCloud();
    const adapter = new CloudflareVaultAdapter(env, 'app-e2ee');
    await adapter.create('item', rec() as any);

    const got = await adapter.get('item', 'r1', 'inst1');
    expect(got?.secreto).toBe(SECRETO);
  });

  it('sin el share del dispositivo NO descifra aunque la nube esté completa', async () => {
    const { env } = fakeCloud();
    const autor = new CloudflareVaultAdapter(env, 'app-e2ee');
    await autor.create('item', rec() as any);

    // Otro dispositivo/instancia con los MISMOS bindings de nube pero sin el store local:
    // Al usar IndexedDB y borrarlo simulamos un segundo dispositivo.
    // Para no enredarnos con la misma BD, creamos uno temporal en memoria vacio.
    const ajeno = new CloudflareVaultAdapter(env, 'app-e2ee');
    ajeno.setDeviceShareStore({ save: async () => {}, load: async () => null });
    const got = await ajeno.get('item', 'r1', 'inst1');
    expect(got).toBeNull();
  });

  it('la recuperacion (x=2) se entrega en el dispositivo y no viaja a la nube', async () => {
    const { env, r2, kv } = fakeCloud();
    const adapter = new CloudflareVaultAdapter(env, 'app-e2ee');
    await adapter.create('item', rec() as any);

    const recovery = await adapter.recoveryShare('r1');
    expect(recovery?.index).toBe(2);

    // En ningun valor de la nube puede aparecer el share de recuperacion.
    const enNube = [...r2.values(), ...kv.values()].join('|');
    const b64 = String(recovery.value);
    expect(enNube).not.toContain(b64);
  });

  it('los shares del dispositivo persisten en IndexedDB y se cifran en reposo', async () => {
    const { env } = fakeCloud();
    const adapter1 = new CloudflareVaultAdapter(env, 'app-e2ee');
    await adapter1.create('item', rec() as any);

    // Simular reinicio creando otro adapter con los mismos bindings (reutilizando DB real)
    const adapter2 = new CloudflareVaultAdapter(env, 'app-e2ee');
    const got = await adapter2.get('item', 'r1', 'inst1');
    expect(got?.secreto, 'debe leer del IndexedDB tras recargar').toBe(SECRETO);

    // Verificar que el payload en la DB no tiene los shares en texto plano
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('vault-device-shares');
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
    });
    const tx = db.transaction('shares', 'readonly');
    const val = await new Promise<any>((resolve, reject) => {
      const req = tx.objectStore('shares').get('r1');
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
    });
    db.close();

    expect(val).toBeDefined();
    // La clave real del share no debe aparecer expuesta, debe haber ciphertext (iv, data)
    expect(val.device).toBeUndefined();
    expect(val.data).toBeInstanceOf(ArrayBuffer); // o similar dependiendo de como cifremos
  });

  it('update() lanza error explícito sin modificar el registro en memoria ni en la nube', async () => {
    const { env } = fakeCloud();
    const adapter = new CloudflareVaultAdapter(env, 'app-e2ee');
    await adapter.create('item', Object.assign(rec(), { secreto: 'v1' }) as any);

    await expect(adapter.update('item', 'r1', { secreto: 'v2' }, 'inst1')).rejects.toThrow(
      'update not supported by the vault adapter until @swal/vault can re-seal with an existing DEK',
    );

    // Tras el fallo, get() en la misma instancia y en otra debe seguir devolviendo el registro original intacto
    const gotMem = await adapter.get('item', 'r1', 'inst1');
    expect(gotMem?.secreto).toBe('v1');

    const ajeno = new CloudflareVaultAdapter(env, 'app-e2ee');
    ajeno.setDeviceShareStore(adapter['deviceStore']);
    const gotCloud = await ajeno.get('item', 'r1', 'inst1');
    expect(gotCloud?.secreto).toBe('v1');
  });
});
