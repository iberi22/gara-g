import { describe, it, expect, afterEach, vi } from 'vitest';
import { NodeIdentityManager } from '../../src/lib/nodeIdentity.js';

describe('NodeIdentityManager Coverage Test Suite', () => {
  const STORAGE_KEY = 'swal_node_identity';

  function createMockLocalStorage() {
    let store: Record<string, string> = {};
    return {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = String(value);
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        store = {};
      },
    };
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should generate Ed25519 keypair in pure memory context without localStorage', async () => {
    const originalWindow = globalThis.window;
    const originalLocalStorage = globalThis.localStorage;

    // @ts-ignore
    delete globalThis.window;
    // @ts-ignore
    delete globalThis.localStorage;

    try {
      const manager = new NodeIdentityManager();
      expect(manager.getNodeId()).toBe('');
      expect(manager.getPublicKeyHex()).toBe('');

      const result = await manager.init();

      expect(result.nodeId).toMatch(/^node_[0-9a-f]{16}$/);
      expect(result.publicKeyHex).toHaveLength(64);
      expect(manager.getNodeId()).toBe(result.nodeId);
      expect(manager.getPublicKeyHex()).toBe(result.publicKeyHex);

      // Verify sign works in pure memory context
      const sig = await manager.sign('pure-memory-payload');
      expect(sig).toBeDefined();
      expect(sig.length).toBe(128); // 64-byte Ed25519 sig in hex

      const isValid = await NodeIdentityManager.verify(
        manager.getPublicKeyHex(),
        sig,
        'pure-memory-payload',
      );
      expect(isValid).toBe(true);
    } finally {
      if (originalWindow !== undefined) {
        globalThis.window = originalWindow;
      }
      if (originalLocalStorage !== undefined) {
        globalThis.localStorage = originalLocalStorage;
      }
    }
  });

  it('should recover and regenerate keypair when localStorage contains corrupt JSON', async () => {
    const mockLocalStorage = createMockLocalStorage();
    mockLocalStorage.setItem(STORAGE_KEY, 'corrupt-invalid-json{{{');

    const originalWindow = globalThis.window;
    const originalLocalStorage = globalThis.localStorage;

    // @ts-ignore
    globalThis.window = { localStorage: mockLocalStorage };
    // @ts-ignore
    globalThis.localStorage = mockLocalStorage;

    try {
      const manager = new NodeIdentityManager();
      const result = await manager.init();

      expect(result.nodeId).toMatch(/^node_[0-9a-f]{16}$/);
      expect(result.publicKeyHex).toHaveLength(64);

      // Verify localStorage was overwritten with valid record
      const saved = mockLocalStorage.getItem(STORAGE_KEY);
      expect(saved).not.toBeNull();
      const parsed = JSON.parse(saved!);
      expect(parsed.nodeId).toBe(result.nodeId);
      expect(parsed.publicKeyHex).toBe(result.publicKeyHex);
    } finally {
      // @ts-ignore
      globalThis.window = originalWindow;
      // @ts-ignore
      globalThis.localStorage = originalLocalStorage;
    }
  });

  it('should restore existing identity record from valid localStorage', async () => {
    const mockRecord = {
      nodeId: 'node_abcdef1234567890',
      publicKeyHex: 'abcdef12345678901234567890abcdef12345678901234567890abcdef123456',
      createdAt: 1700000000000,
    };

    const mockLocalStorage = createMockLocalStorage();
    mockLocalStorage.setItem(STORAGE_KEY, JSON.stringify(mockRecord));

    const originalWindow = globalThis.window;
    const originalLocalStorage = globalThis.localStorage;

    // @ts-ignore
    globalThis.window = { localStorage: mockLocalStorage };
    // @ts-ignore
    globalThis.localStorage = mockLocalStorage;

    try {
      const manager = new NodeIdentityManager();
      const result = await manager.init();

      expect(result.nodeId).toBe(mockRecord.nodeId);
      expect(result.publicKeyHex).toBe(mockRecord.publicKeyHex);
      expect(manager.getNodeId()).toBe(mockRecord.nodeId);
      expect(manager.getPublicKeyHex()).toBe(mockRecord.publicKeyHex);
    } finally {
      // @ts-ignore
      globalThis.window = originalWindow;
      // @ts-ignore
      globalThis.localStorage = originalLocalStorage;
    }
  });

  it('should support signing string payloads vs Uint8Array byte payloads', async () => {
    const manager = new NodeIdentityManager();
    await manager.init();

    const strPayload = 'hello-node-p2p';
    const bytesPayload = new TextEncoder().encode(strPayload);

    const sigFromStr = await manager.sign(strPayload);
    const sigFromBytes = await manager.sign(bytesPayload);

    expect(sigFromStr).toHaveLength(128);
    expect(sigFromBytes).toHaveLength(128);

    // Verify string signature with string data
    const verifyStr = await NodeIdentityManager.verify(
      manager.getPublicKeyHex(),
      sigFromStr,
      strPayload,
    );
    expect(verifyStr).toBe(true);

    // Verify bytes signature with Uint8Array data
    const verifyBytes = await NodeIdentityManager.verify(
      manager.getPublicKeyHex(),
      sigFromBytes,
      bytesPayload,
    );
    expect(verifyBytes).toBe(true);

    // Cross verification: verify string signature with Uint8Array data and vice versa
    const verifyCross1 = await NodeIdentityManager.verify(
      manager.getPublicKeyHex(),
      sigFromStr,
      bytesPayload,
    );
    expect(verifyCross1).toBe(true);

    const verifyCross2 = await NodeIdentityManager.verify(
      manager.getPublicKeyHex(),
      sigFromBytes,
      strPayload,
    );
    expect(verifyCross2).toBe(true);
  });

  it('should handle verification failures for malformed keys, mismatched data, and bad signatures', async () => {
    const manager = new NodeIdentityManager();
    await manager.init();

    const validSig = await manager.sign('correct-data');

    // 1. Mismatched data
    const isMismatchValid = await NodeIdentityManager.verify(
      manager.getPublicKeyHex(),
      validSig,
      'wrong-data',
    );
    expect(isMismatchValid).toBe(false);

    // 2. Malformed public key (invalid hex length, non-hex chars, or invalid key format)
    const isMalformedKeyValid = await NodeIdentityManager.verify(
      'invalid-public-key-hex',
      validSig,
      'correct-data',
    );
    expect(isMalformedKeyValid).toBe(false);

    const isEmptyKeyValid = await NodeIdentityManager.verify('', validSig, 'correct-data');
    expect(isEmptyKeyValid).toBe(false);

    // 3. Malformed / truncated signature
    const isTruncatedSigValid = await NodeIdentityManager.verify(
      manager.getPublicKeyHex(),
      validSig.slice(0, 10),
      'correct-data',
    );
    expect(isTruncatedSigValid).toBe(false);

    const isNonHexSigValid = await NodeIdentityManager.verify(
      manager.getPublicKeyHex(),
      'ZZZZ'.repeat(32),
      'correct-data',
    );
    expect(isNonHexSigValid).toBe(false);
  });

  it('should initialize custom nodeId in constructor and auto-init when sign is called directly', async () => {
    const customNodeId = 'node_custom_12345';
    const manager = new NodeIdentityManager(customNodeId);

    expect(manager.getNodeId()).toBe(customNodeId);

    // Sign without explicit init() call — should trigger auto-init
    const sig = await manager.sign('auto-init-payload');
    expect(sig).toHaveLength(128);
    expect(manager.getPublicKeyHex()).toHaveLength(64);

    const isValid = await NodeIdentityManager.verify(
      manager.getPublicKeyHex(),
      sig,
      'auto-init-payload',
    );
    expect(isValid).toBe(true);
  });
});
