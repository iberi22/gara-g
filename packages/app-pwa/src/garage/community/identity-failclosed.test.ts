/**
 * identity-failclosed.test.ts — el pseudonimo del foro nunca usa la clave fija fuera de un
 * entorno EXPLICITO de desarrollo. Antes bastaba con que ENVIRONMENT no fuera 'production'
 * (p. ej. ausente o 'staging') para firmar con la clave publica del repo.
 */
import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it } from 'vitest';
import { authorHash, resetCommunitySecretCache } from './identity';

const e = env as unknown as Record<string, string | undefined>;

afterEach(() => {
  delete e.ENVIRONMENT;
  delete e.COMMUNITY_SECRET;
  resetCommunitySecretCache();
});

describe('secreto de la comunidad', () => {
  it('con un ENVIRONMENT que no es de desarrollo y sin secreto, falla cerrado', async () => {
    e.ENVIRONMENT = 'staging';
    resetCommunitySecretCache();
    await expect(authorHash('usr_1')).rejects.toThrow(/COMMUNITY_SECRET/);
  });
  it('en produccion sin secreto, falla cerrado', async () => {
    e.ENVIRONMENT = 'production';
    resetCommunitySecretCache();
    await expect(authorHash('usr_1')).rejects.toThrow(/COMMUNITY_SECRET/);
  });
  it('con el secreto configurado firma aunque sea produccion', async () => {
    e.ENVIRONMENT = 'production';
    e.COMMUNITY_SECRET = 'secreto-de-prueba';
    resetCommunitySecretCache();
    await expect(authorHash('usr_1')).resolves.toMatch(/^[A-Za-z0-9_-]+$/);
  });
  it('en desarrollo explicito usa la clave fija', async () => {
    e.ENVIRONMENT = 'development';
    resetCommunitySecretCache();
    await expect(authorHash('usr_1')).resolves.toBeTruthy();
  });
});
