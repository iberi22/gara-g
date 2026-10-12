/**
 * src/lib/nodeIdentity.ts — Identidad soberana criptográfica de nodo local (Zero-Cloud).
 *
 * Cada dispositivo/operador genera su par de claves (Ed25519) almacenado en IndexedDB o memoria.
 * - nodeAddress: Clave pública en formato did:key o hex
 * - sign / verify: Firma digital de mutaciones y delegation grants sin backend
 */

export interface KeyPairRecord {
  nodeId: string;
  publicKeyHex: string;
  privateKeyBase64?: string;
  createdAt: number;
}

const STORAGE_KEY = 'swal_node_identity';

function bufToHex(buf: ArrayBuffer | Uint8Array): string {
  const bytes = new Uint8Array(buf);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBuf(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

export class NodeIdentityManager {
  private keyPair: CryptoKeyPair | null = null;
  private nodeId: string = '';
  private publicKeyHex: string = '';

  constructor(nodeId?: string) {
    if (nodeId) {
      this.nodeId = nodeId;
    }
  }

  /**
   * Inicializa o recupera la identidad del nodo desde IndexedDB / LocalStorage.
   * Si no existe, genera un nuevo par Ed25519 nativo con WebCrypto.
   */
  public async init(): Promise<{ nodeId: string; publicKeyHex: string }> {
    if (typeof window !== 'undefined' && window.localStorage) {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        try {
          const parsed = JSON.parse(saved) as KeyPairRecord;
          this.nodeId = parsed.nodeId;
          this.publicKeyHex = parsed.publicKeyHex;
          return { nodeId: this.nodeId, publicKeyHex: this.publicKeyHex };
        } catch {
          // Si está corrupto, regenerar
        }
      }
    }

    // Generar nuevo par Ed25519
    this.keyPair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
    const pubBuf = await crypto.subtle.exportKey('raw', this.keyPair.publicKey);
    this.publicKeyHex = bufToHex(pubBuf);
    this.nodeId = `node_${this.publicKeyHex.slice(0, 16)}`;

    if (typeof window !== 'undefined' && window.localStorage) {
      const record: KeyPairRecord = {
        nodeId: this.nodeId,
        publicKeyHex: this.publicKeyHex,
        createdAt: Date.now(),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
    }

    return { nodeId: this.nodeId, publicKeyHex: this.publicKeyHex };
  }

  public getNodeId(): string {
    return this.nodeId;
  }

  public getPublicKeyHex(): string {
    return this.publicKeyHex;
  }

  /**
   * Firma un payload arbitrario (string o Uint8Array) con la clave privada local.
   */
  public async sign(data: string | Uint8Array): Promise<string> {
    if (!this.keyPair) {
      // Si no tenemos la clave en memoria, asegurar generación
      await this.init();
    }
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    const sigBuf = await crypto.subtle.sign('Ed25519', this.keyPair!.privateKey, bytes);
    return bufToHex(sigBuf);
  }

  /**
   * Verifica la firma de un mensaje dado el public key hex del firmante.
   */
  public static async verify(
    publicKeyHex: string,
    signatureHex: string,
    data: string | Uint8Array,
  ): Promise<boolean> {
    try {
      const pubKeyBytes = hexToBuf(publicKeyHex);
      const sigBytes = hexToBuf(signatureHex);
      const dataBytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;

      const key = await crypto.subtle.importKey(
        'raw',
        pubKeyBytes,
        'Ed25519',
        true,
        ['verify'],
      );

      return await crypto.subtle.verify('Ed25519', key, sigBytes, dataBytes);
    } catch {
      return false;
    }
  }
}
