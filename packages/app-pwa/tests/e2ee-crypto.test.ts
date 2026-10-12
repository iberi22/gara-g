import { describe, it, expect } from 'vitest';
import {
  BackupCodeError,
  DecryptError,
  decryptEnvelope,
  deriveKeys,
  encryptEnvelope,
  generateBackupCode,
  parseBackupCode,
  b64urlDecode,
  b64urlEncode,
} from '../src/lib/e2ee/crypto';

const keysOf = async (code: string) => deriveKeys((await parseBackupCode(code)).secret);

describe('codigo de respaldo', () => {
  it('tiene 7 grupos de 4 y se parsea de vuelta a los mismos 16 bytes', async () => {
    const code = await generateBackupCode();
    expect(code).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){6}[0-9A-HJKMNP-TV-Z]{4}$/);
    const a = await parseBackupCode(code);
    expect(a.secret).toHaveLength(16);
    expect(a.code).toBe(code);
    const b = await parseBackupCode(code.toLowerCase().replace(/-/g, '  '));
    expect(b.secret).toEqual(a.secret);
  });

  /**
   * Codigo con el que se comprueba la deteccion posicion a posicion. FIJO a proposito.
   *
   * Con un codigo aleatorio la afirmacion era probabilistica: los 2 caracteres de control son
   * 10 bits de SHA-256, asi que 1 de cada ~1024 sustituciones de un caracter da el mismo
   * control y pasa sin detectar. Sobre un codigo al azar, la probabilidad de que alguna de las
   * 28 sustituciones pase es ~2,7 % (medido: 9 de cada 600 codigos), y el test fallaba sin que
   * el codigo de produccion hubiera cambiado. Con un codigo fijo el resultado es determinista
   * y la tasa real de deteccion se comprueba aparte, sobre una muestra amplia.
   */
  const CODE_SIN_FALLOS = '38JPBRXVEC1JDJM0SEDEH2TZEMHR';
  const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

  it('detecta un error de tecleo en cualquier posicion', async () => {
    expect((await parseBackupCode(CODE_SIN_FALLOS)).code).toBe(CODE_SIN_FALLOS.replace(/(.{4})(?=.)/g, '$1-'));
    for (let i = 0; i < CODE_SIN_FALLOS.length; i++) {
      const swapped = ALPHABET[(ALPHABET.indexOf(CODE_SIN_FALLOS[i]) + 1) % 32];
      const bad = CODE_SIN_FALLOS.slice(0, i) + swapped + CODE_SIN_FALLOS.slice(i + 1);
      await expect(parseBackupCode(bad)).rejects.toBeInstanceOf(BackupCodeError);
    }
  });

  it('la deteccion de tecleos es la que prometen los 10 bits de control (muestra amplia)', async () => {
    // Garantia real: 1023/1024 por sustitucion. Se mide sobre 40 codigos x 28 posiciones
    // (1120 sustituciones, ~1 fallo esperado) y se admite hasta 8: 7 sigma por encima de la
    // media, que es holgado para no depender de la maquina pero estrecho para detectar una
    // regresion de verdad (p. ej. quitar los caracteres de control).
    let sustituciones = 0;
    let sinDetectar = 0;
    for (let r = 0; r < 40; r++) {
      const code = (await generateBackupCode()).replace(/-/g, '');
      for (let i = 0; i < code.length; i++) {
        const swapped = ALPHABET[(ALPHABET.indexOf(code[i]) + 1) % 32];
        const bad = code.slice(0, i) + swapped + code.slice(i + 1);
        sustituciones++;
        try {
          await parseBackupCode(bad);
          sinDetectar++;
        } catch (e) {
          if (!(e instanceof BackupCodeError)) throw e;
        }
      }
    }
    expect(sustituciones).toBe(40 * 28);
    expect(sinDetectar).toBeLessThanOrEqual(8);
  });

  it('rechaza longitud y caracteres invalidos con un mensaje claro', async () => {
    await expect(parseBackupCode('ABCD')).rejects.toThrow(/28 caracteres/);
    await expect(parseBackupCode('U'.repeat(28))).rejects.toThrow(/no existe/);
  });

  it('normaliza O->0 e I,L->1', async () => {
    // Un codigo valido sin O/I/L cambiado a mano: sustituimos 0 por O y 1 por I/L en el texto.
    let code = '';
    for (let i = 0; i < 200 && !/[01]/.test(code); i++) code = (await generateBackupCode()).replace(/-/g, '');
    const alt = code.replace(/0/g, 'o').replace(/1/g, (_m, off) => (off % 2 ? 'i' : 'l'));
    expect(alt).not.toBe(code);
    expect((await parseBackupCode(alt)).secret).toEqual((await parseBackupCode(code)).secret);
  });
});

// Vector verificado con node:crypto hkdfSync (implementacion independiente).
const VECTOR = { syncId: '56d62cdc064390906dedcbc11425a462', authToken: '3_OTgi1iiCK9LdNmK0XkLwkX1Kk4TP3IQtOXMSnA6Dc' }; // gitleaks:allow (vector de prueba: secreto = bytes 0..15)

describe('derivacion HKDF', () => {
  it('es determinista con un vector fijo', async () => {
    const secret = new Uint8Array(16).map((_, i) => i);
    const k = await deriveKeys(secret);
    expect(k.syncId).toMatch(/^[0-9a-f]{32}$/);
    expect(b64urlDecode(k.authToken)).toHaveLength(32);
    expect(k.encKey.extractable).toBe(false);
    // Vector fijo (HKDF-SHA256, salt gara-g/backup/v1, info id/auth): cambiar salt/info/formato lo rompe.
    expect(k.syncId).toBe(VECTOR.syncId);
    expect(k.authToken).toBe(VECTOR.authToken);
    const again = await deriveKeys(secret);
    expect(again.syncId).toBe(k.syncId);
    expect(again.authToken).toBe(k.authToken);
  });

  it('id, token y clave son independientes entre si', async () => {
    const k = await deriveKeys(new Uint8Array(16).map((_, i) => i));
    expect(b64urlEncode(b64urlDecode(k.authToken))).toBe(k.authToken);
    expect(k.authToken).not.toContain(k.syncId);
  });
});

describe('sobre cifrado', () => {
  it('ida y vuelta', async () => {
    const k = await keysOf(await generateBackupCode());
    const text = JSON.stringify({ v: 1, vehiculos: ['Hilux', 'ñandú ✓'] });
    const env = await encryptEnvelope(k.encKey, k.syncId, text);
    expect(env).toMatchObject({ v: 1, alg: 'A256GCM' });
    expect(JSON.stringify(env)).not.toContain('Hilux');
    expect(await decryptEnvelope(k.encKey, k.syncId, env)).toBe(text);
  });

  it('una clave equivocada falla', async () => {
    const a = await keysOf(await generateBackupCode());
    const b = await keysOf(await generateBackupCode());
    const env = await encryptEnvelope(a.encKey, a.syncId, 'secreto');
    await expect(decryptEnvelope(b.encKey, a.syncId, env)).rejects.toBeInstanceOf(DecryptError);
  });

  it('un ct, iv o AAD alterado falla', async () => {
    const k = await keysOf(await generateBackupCode());
    const env = await encryptEnvelope(k.encKey, k.syncId, 'x'.repeat(500));
    const flip = (s: string) => (s[0] === 'A' ? 'B' : 'A') + s.slice(1);
    await expect(decryptEnvelope(k.encKey, k.syncId, { ...env, ct: flip(env.ct) })).rejects.toBeInstanceOf(DecryptError);
    await expect(decryptEnvelope(k.encKey, k.syncId, { ...env, iv: flip(env.iv) })).rejects.toBeInstanceOf(DecryptError);
    // AAD: el mismo sobre bajo otro syncId no abre.
    await expect(decryptEnvelope(k.encKey, '0'.repeat(32), env)).rejects.toBeInstanceOf(DecryptError);
    await expect(decryptEnvelope(k.encKey, k.syncId, { v: 2 })).rejects.toBeInstanceOf(DecryptError);
    // La marca de compresion va en el AAD: quitarla o ponerla en el servidor rompe el descifrado.
    const zless = { ...env };
    delete zless.z;
    await expect(decryptEnvelope(k.encKey, k.syncId, env.z ? zless : { ...env, z: 'gzip' as const })).rejects.toBeInstanceOf(DecryptError);
  });

  it('los IV no se repiten', async () => {
    const k = await keysOf(await generateBackupCode());
    const ivs = new Set<string>();
    for (let i = 0; i < 200; i++) ivs.add((await encryptEnvelope(k.encKey, k.syncId, 'a')).iv);
    expect(ivs.size).toBe(200);
  });
});
