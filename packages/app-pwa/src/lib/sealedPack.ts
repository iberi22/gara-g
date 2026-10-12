
export interface DEKShare {
  index: number;
  value: Uint8Array;
}

export interface SealedPack {
  id: string;
  content_hash: string;
  ciphertext: string;
  iv: string;
  shares: DEKShare[];
  chain: string;
  chainId: number;
  signature: string;
  publicKey: string;
  metadata: Record<string, unknown>;
  createdAt: number;
}

// Finite Field GF(256) Arithmetic with irreducible polynomial 0x11b
function gfAdd(a: number, b: number): number {
  return a ^ b;
}

function gfMul(a: number, b: number): number {
  let p = 0;
  let currA = a;
  let currB = b;
  for (let i = 0; i < 8; i++) {
    if ((currB & 1) !== 0) p ^= currA;
    const hi = currA & 0x80;
    currA = (currA << 1) & 0xff;
    if (hi !== 0) currA ^= 0x1b;
    currB >>= 1;
  }
  return p;
}

function gfInv(a: number): number {
  if (a === 0) return 0;
  let res = 1;
  let base = a;
  let exp = 254;
  while (exp > 0) {
    if (exp & 1) res = gfMul(res, base);
    base = gfMul(base, base);
    exp >>= 1;
  }
  return res;
}

function gfDiv(a: number, b: number): number {
  if (b === 0) throw new Error('Division by zero in GF(256)');
  return gfMul(a, gfInv(b));
}

/**
 * Split a 32-byte DEK into 3 shares using 2-of-3 Shamir Secret Sharing over GF(256)
 */
export function splitDEK(dek: Uint8Array): DEKShare[] {
  const length = dek.length;
  const share1Val = new Uint8Array(length);
  const share2Val = new Uint8Array(length);
  const share3Val = new Uint8Array(length);

  for (let i = 0; i < length; i++) {
    const s = dek[i];
    // Random coefficient a1 in GF(256)
    const randomByte = crypto.getRandomValues(new Uint8Array(1))[0];
    const a1 = randomByte === 0 ? 1 : randomByte;

    // f(x) = s + a1 * x
    // Share 1 at x=1: f(1) = s ^ (a1 * 1)
    // Share 2 at x=2: f(2) = s ^ (a1 * 2)
    // Share 3 at x=3: f(3) = s ^ (a1 * 3)
    share1Val[i] = gfAdd(s, gfMul(a1, 1));
    share2Val[i] = gfAdd(s, gfMul(a1, 2));
    share3Val[i] = gfAdd(s, gfMul(a1, 3));
  }

  return [
    { index: 1, value: share1Val },
    { index: 2, value: share2Val },
    { index: 3, value: share3Val },
  ];
}

/**
 * Reconstruct 32-byte DEK from any 2 shares
 */
export function reconstructDEK(shares: DEKShare[]): Uint8Array {
  if (!shares || shares.length < 2) {
    throw new Error('At least 2 shares are required');
  }

  const s1 = shares[0];
  const s2 = shares[1];
  const x1 = s1.index;
  const x2 = s2.index;
  const y1 = s1.value;
  const y2 = s2.value;

  const length = y1.length;
  const dek = new Uint8Array(length);

  // Lagrange Basis Polynomials at x=0:
  // L1(0) = (0 - x2) / (x1 - x2) = x2 / (x1 ^ x2)
  // L2(0) = (0 - x1) / (x2 - x1) = x1 / (x1 ^ x2)
  const denom = gfAdd(x1, x2);
  const l1 = gfDiv(x2, denom);
  const l2 = gfDiv(x1, denom);

  for (let i = 0; i < length; i++) {
    const term1 = gfMul(y1[i], l1);
    const term2 = gfMul(y2[i], l2);
    dek[i] = gfAdd(term1, term2);
  }

  return dek;
}

function toBase64(buf: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(buf).toString('base64');
  }
  let binary = '';
  for (let i = 0; i < buf.byteLength; i++) {
    binary += String.fromCharCode(buf[i]);
  }
  return btoa(binary);
}

function fromBase64(str: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(str, 'base64'));
  }
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function computeSha256Hex(str: string): Promise<string> {
  const bytes = new TextEncoder().encode(str);
  const hashBuf = await crypto.subtle.digest('SHA-256', bytes);
  const hashArray = Array.from(new Uint8Array(hashBuf));
  return `0x${hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Creates a SealedPack with AES-256-GCM encryption, Ed25519 signature, SHA-256 content_hash, and Shamir DEK shares
 */
export async function createSealedPack(
  payload: Uint8Array,
  metadata: Record<string, unknown> = {},
): Promise<SealedPack> {
  // Generate random 32-byte DEK
  const dek = crypto.getRandomValues(new Uint8Array(32));

  // Import DEK for AES-256-GCM
  const key = await crypto.subtle.importKey('raw', dek, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encryptedBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, payload);
  const ciphertextBase64 = toBase64(new Uint8Array(encryptedBuf));
  const ivBase64 = toBase64(iv);

  const id = `pack-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const hashInput = `${ciphertextBase64}::${JSON.stringify(metadata)}`;
  const content_hash = await computeSha256Hex(hashInput);

  // Ed25519 Key Generation and Signature
  const keyPair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  const signatureBuf = await crypto.subtle.sign(
    'Ed25519',
    keyPair.privateKey,
    new TextEncoder().encode(content_hash),
  );
  const pubKeyBuf = await crypto.subtle.exportKey('raw', keyPair.publicKey);

  const shares = splitDEK(dek);

  return {
    id,
    content_hash,
    ciphertext: ciphertextBase64,
    iv: ivBase64,
    shares,
    chain: 'polygon',
    chainId: 137,
    signature: toBase64(new Uint8Array(signatureBuf)),
    publicKey: toBase64(new Uint8Array(pubKeyBuf)),
    metadata,
    createdAt: Date.now(),
  };
}

/**
 * Verifies content_hash integrity of a SealedPack
 */
export async function verifySealedPackHash(pack: SealedPack): Promise<boolean> {
  if (!pack?.ciphertext || !pack.metadata || !pack.content_hash) {
    return false;
  }
  const hashInput = `${pack.ciphertext}::${JSON.stringify(pack.metadata)}`;
  const recomputedHash = await computeSha256Hex(hashInput);
  return recomputedHash === pack.content_hash;
}

/**
 * Unpacks and decrypts a SealedPack using 2 or more DEK shares
 */
export async function unpackSealedPack(pack: SealedPack, shares: DEKShare[]): Promise<Uint8Array> {
  const dek = reconstructDEK(shares);
  const key = await crypto.subtle.importKey('raw', dek, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);

  const ciphertext = fromBase64(pack.ciphertext);
  const iv = fromBase64(pack.iv);

  const decryptedBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new Uint8Array(decryptedBuf);
}
