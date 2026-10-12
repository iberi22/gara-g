/**
 * identity.test.ts — El autor nunca se expone en la instancia compartida.
 *
 * Es el test que protege el requisito central de la comunidad: las filas del foro
 * y la wiki son de todos los duenos de la version, asi que si un userId o un
 * correo se guardara en claro, cualquiera con acceso al D1 (o un moderador con la
 * ruta) podria mapear cada "Piloto-7fk2q9" a una persona real y seguirla entre
 * versiones. El alias debe ser estable (para reconocer "mi mensaje") y a la vez
 * no reversible sin el secreto.
 */
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { aliasFromHash, authorHash, pseudonymFor, resetCommunitySecretCache } from './identity';

const envMock = env as unknown as Record<string, unknown>;

describe('identity: pseudonimo del autor', () => {
  beforeEach(() => {
    envMock.ENVIRONMENT = 'production';
    envMock.COMMUNITY_SECRET = 'secreto-de-prueba';
    resetCommunitySecretCache();
  });

  it('el authorId es un HMAC, no el userId', async () => {
    const hash = await authorHash('usr_123');
    expect(hash).not.toContain('usr_123');
    expect(hash.length).toBeGreaterThanOrEqual(40);
    expect(hash).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('el mismo usuario conserva su hash entre llamadas y entre sesiones', async () => {
    const a = await authorHash('usr_123');
    const b = await authorHash('usr_123');
    expect(a).toBe(b);
    // La cache de la clave no debe alterar la determinacion del resultado.
    resetCommunitySecretCache();
    expect(await authorHash('usr_123')).toBe(a);
  });

  it('dos usuarios distintos nunca comparten hash', async () => {
    const a = await authorHash('usr_123');
    const b = await authorHash('usr_124');
    expect(a).not.toBe(b);
  });

  it('el hash cambia si cambia el secreto (no se puede replicar fuera)', async () => {
    const conSecretoA = await authorHash('usr_123');
    envMock.COMMUNITY_SECRET = 'otro-secreto';
    resetCommunitySecretCache();
    const conSecretoB = await authorHash('usr_123');
    expect(conSecretoB).not.toBe(conSecretoA);
  });

  it('el alias es estable y con el formato Piloto-xxxxxx', async () => {
    const p = await pseudonymFor('usr_123');
    expect(p.authorName).toMatch(/^Piloto-[a-z0-9]{6}$/);
    // Estable entre llamadas y no depende del userId en claro.
    const again = await pseudonymFor('usr_123');
    expect(again.authorName).toBe(p.authorName);
    expect(p.authorName).not.toContain('usr_123');
  });

  it('el alias se deriva del hash, no del userId directo', async () => {
    // Dos users con alias distinto: si el alias se derivara del userId en claro,
    // "usr_1" y "usr_2" darian alias contiguos.
    const a = aliasFromHash(await authorHash('usr_1'));
    const b = aliasFromHash(await authorHash('usr_2'));
    expect(a).not.toBe(b);
    expect(a).toMatch(/^Piloto-[a-z0-9]{6}$/);
  });

  it('el alias no depende del secreto: es funcion del hash', async () => {
    const hash = await authorHash('usr_123');
    const antes = aliasFromHash(hash);
    envMock.COMMUNITY_SECRET = 'cambiado';
    resetCommunitySecretCache();
    expect(aliasFromHash(hash)).toBe(antes);
  });

  it('en produccion sin COMMUNITY_SECRET falla en vez de firmar con clave publica', async () => {
    envMock.COMMUNITY_SECRET = undefined;
    resetCommunitySecretCache();
    // Preferimos un error a publicar un pseudonimo invertible por fuerza bruta.
    await expect(authorHash('usr_123')).rejects.toThrow(/COMMUNITY_SECRET/);
  });
});
