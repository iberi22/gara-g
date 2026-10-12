import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadSerializedKeypair, resetIdentityMemory, saveSerializedKeypair } from './identityStore';
import { DEFAULT_SIGNAL_URL, createEphemeralPort, getMeshPort, resolveSignalUrl } from './node';

describe('node.ts (solo navegador)', () => {
  it('getMeshPort lanza un error claro en el servidor', async () => {
    expect(typeof window).toBe('undefined');
    await expect(getMeshPort()).rejects.toThrow(/solo funciona en el navegador/);
  });

  it('createEphemeralPort tambien lanza en el servidor', async () => {
    await expect(createEphemeralPort()).rejects.toThrow(/solo funciona en el navegador/);
  });

  it('la senalizacion sale de la config o cae al broker por defecto de PeerJS', () => {
    expect(resolveSignalUrl('  https://mesh.example/peerjs/ ')).toBe('https://mesh.example/peerjs/');
    expect(resolveSignalUrl()).toBe(DEFAULT_SIGNAL_URL);
    expect(DEFAULT_SIGNAL_URL).toBe('https://0.peerjs.com/');
  });
});

describe('identityStore', () => {
  beforeEach(() => resetIdentityMemory());

  it('persiste el keypair en IndexedDB y lo recupera', async () => {
    expect(await loadSerializedKeypair()).toBeNull();
    await saveSerializedKeypair('abc123');
    resetIdentityMemory(); // fuerza a leer de IndexedDB, no de la copia en memoria
    expect(await loadSerializedKeypair()).toBe('abc123');
  });
});
