/**
 * src/lib/__tests__/password.test.ts — Tests for PBKDF2 password hashing.
 */
import { describe, it, expect } from 'vitest';
import { webcrypto } from 'node:crypto';

// Polyfill globals if running in Node test env
if (typeof globalThis.crypto === 'undefined') {
  // @ts-ignore
  globalThis.crypto = webcrypto;
}

import { hashPassword, verifyPassword } from '../password';

describe('password — PBKDF2', () => {
  it('hashPassword produces salt:hash format', async () => {
    const h = await hashPassword('hello123');
    const parts = h.split(':');
    expect(parts).toHaveLength(2);
    expect(parts[0].length).toBeGreaterThan(0);
    expect(parts[1].length).toBeGreaterThan(0);
  });

  it('hashPassword produces different salt each call (same password → different hashes)', async () => {
    const h1 = await hashPassword('samepass');
    const h2 = await hashPassword('samepass');
    expect(h1).not.toBe(h2);
  });

  it('verifyPassword accepts correct password', async () => {
    const h = await hashPassword('correcthorse');
    expect(await verifyPassword('correcthorse', h)).toBe(true);
  });

  it('verifyPassword rejects wrong password', async () => {
    const h = await hashPassword('correcthorse');
    expect(await verifyPassword('wrongpass', h)).toBe(false);
  });

  it('verifyPassword rejects malformed stored string', async () => {
    expect(await verifyPassword('any', 'no-colon-here')).toBe(false);
    expect(await verifyPassword('any', '')).toBe(false);
    expect(await verifyPassword('any', 'only:one:colon')).toBe(false);
  });

  it('verifyPassword with known pre-computed hash', async () => {
    // Vector calculado FUERA de password.ts, con node:crypto
    // (pbkdf2Sync('vector-de-prueba-7', 'gara-g-vector-01', 100000, 32, 'sha256')): si los
    // parametros de Web Crypto cambian, este hash deja de verificar. Ya no se usa la antigua
    // contrasena demo: los usuarios demo se eliminaron.
    const known = 'Z2FyYS1nLXZlY3Rvci0wMQ==:mikV3O+sQtI0NVH6JBmgo0MLbqkqa8K4cCpYaFmAue8=';
    expect(await verifyPassword('vector-de-prueba-7', known)).toBe(true);
    expect(await verifyPassword('vector-de-prueba-8', known)).toBe(false);
  });
});

describe('rbac — permissions', () => {
  it('admin can do everything', async () => {
    const { can } = await import('../rbac');
    expect(can('admin', 'vehicle', 'create')).toBe(true);
    expect(can('admin', 'vehicle', 'delete')).toBe(true);
    expect(can('admin', 'user', 'delete')).toBe(true);
  });

  it('operator can CRUD vehicles but not users', async () => {
    const { can } = await import('../rbac');
    expect(can('operator', 'vehicle', 'create')).toBe(true);
    expect(can('operator', 'vehicle', 'delete')).toBe(false);
    expect(can('operator', 'user', 'read')).toBe(false);
  });

  it('observer is read-only on allowed entities', async () => {
    const { can } = await import('../rbac');
    expect(can('observer', 'vehicle', 'read')).toBe(true);
    expect(can('observer', 'vehicle', 'create')).toBe(false);
    expect(can('observer', 'vehicle', 'update')).toBe(false);
    expect(can('observer', 'vehicle', 'delete')).toBe(false);
  });

  it('unknown role is denied', async () => {
    const { can } = await import('../rbac');
    expect(can('superuser', 'vehicle', 'read')).toBe(false);
    expect(can(undefined, 'vehicle', 'read')).toBe(false);
    expect(can(null, 'vehicle', 'read')).toBe(false);
  });
});
