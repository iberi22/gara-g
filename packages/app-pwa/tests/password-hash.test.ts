/**
 * tests/password-hash.test.ts — el hash que genera el bootstrap es el que verifica el login.
 *
 * Contexto: el usuario creado por scripts/bootstrap-admin.ts no conseguia entrar
 * (401 en produccion y en wrangler dev remoto). El hash almacenado parecia correcto
 * a simple vista — salt de 16 bytes y hash de 32 en base64, separados por ':' — asi
 * que el fallo podia estar en la verificacion, no en el formato.
 *
 * Estos tests atan ambos lados: lo que hashPassword produce tiene que ser lo que
 * verifyPassword acepta, byte a byte, con las MISMAS iteraciones que usa el login.
 */
import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/lib/password.js';

describe('password: hash y verify son el mismo algoritmo', () => {
  it('verifyPassword acepta lo que genera hashPassword', async () => {
    const pw = 'ContraseñaDePrueba123';
    const hash = await hashPassword(pw);
    await expect(verifyPassword(pw, hash)).resolves.toBe(true);
  });

  it('rechaza la contraseña incorrecta', async () => {
    const hash = await hashPassword('ContraseñaDePrueba123');
    await expect(verifyPassword('OtraContraseña123', hash)).resolves.toBe(false);
  });

  it('el hash tiene el formato base64(salt):base64(hash)', async () => {
    const hash = await hashPassword('ContraseñaDePrueba123');
    const parts = hash.split(':');
    expect(parts).toHaveLength(2);

    const decode = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    expect(decode(parts[0]).length).toBe(16); // salt
    expect(decode(parts[1]).length).toBe(32); // PBKDF2-SHA256
  });

  it('dos hashes de la misma contraseña son distintos (salt aleatorio)', async () => {
    const a = await hashPassword('ContraseñaDePrueba123');
    const b = await hashPassword('ContraseñaDePrueba123');
    expect(a).not.toBe(b);
    // ...pero ambos verifican.
    await expect(verifyPassword('ContraseñaDePrueba123', a)).resolves.toBe(true);
    await expect(verifyPassword('ContraseñaDePrueba123', b)).resolves.toBe(true);
  });

  it('funciona con acentos y ñ', async () => {
    const pw = 'ContraseñaConÑanduYÁccentos1';
    const hash = await hashPassword(pw);
    await expect(verifyPassword(pw, hash)).resolves.toBe(true);
    await expect(verifyPassword(`${pw}x`, hash)).resolves.toBe(false);
  });
});
