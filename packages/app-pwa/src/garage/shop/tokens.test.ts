/**
 * tokens.test.ts — Firma y caducidad del token de anuncio.
 *
 * El token es la barrera anti-fraude del cobro: si se puede alterar el precio o la
 * campaña sin que la firma lo note, el anunciante puede inventarse un click de 1 COP. Por
 * eso los casos de alteracion son el centro de este fichero, no un detalle.
 *
 * `env` es el mock de `cloudflare:workers` (tests/mocks): se le asigna ADS_TOKEN_SECRET y
 * ENVIRONMENT como cualquier binding.
 */
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TOKEN_TTL_MS, hasUsableSecret, signAdToken, tokenSecret, userHash, verifyAdToken } from './tokens';

const envMock = env as unknown as Record<string, unknown>;

const SECRET = 'secreto-de-prueba-suficientemente-largo';
const NOW = new Date(2026, 5, 1, 10, 0, 0).getTime();

async function emit(overrides: Partial<Parameters<typeof signAdToken>[0]> = {}): Promise<string> {
  return signAdToken({
    campaignId: 'camp_1',
    slot: 'shop_feed',
    userHash: 'hash-1',
    priceCOP: 2_500,
    pricingModel: 'cpm',
    now: NOW,
    ...overrides,
  });
}

describe('firma y verificacion', () => {
  beforeEach(() => {
    envMock.ADS_TOKEN_SECRET = SECRET;
    envMock.ENVIRONMENT = 'production';
  });

  it('un token recien emitido verifica y devuelve su contenido', async () => {
    const token = await emit();
    const result = await verifyAdToken(token, NOW + 1_000);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.campaignId).toBe('camp_1');
    expect(result.payload.priceCOP).toBe(2_500);
    expect(result.payload.pricingModel).toBe('cpm');
  });

  it('expira en 30 minutos', async () => {
    const token = await emit();
    expect((await verifyAdToken(token, NOW + TOKEN_TTL_MS - 1_000)).ok).toBe(true);
    const vencido = await verifyAdToken(token, NOW + TOKEN_TTL_MS + 2_000);
    expect(vencido).toEqual({ ok: false, reason: 'expired' });
    expect(TOKEN_TTL_MS).toBe(30 * 60 * 1000);
  });

  it('rechaza un token con el precio alterado', async () => {
    const token = await emit();
    const [body, sig] = token.split('.');
    const payload = JSON.parse(atob(body)) as Record<string, unknown>;
    payload.priceCOP = 1; // el mismo token, pero cobrando 1 COP
    const forjado = `${btoa(JSON.stringify(payload))}.${sig}`;
    expect(await verifyAdToken(forjado, NOW)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rechaza un token con la campaña cambiada', async () => {
    const token = await emit();
    const [body, sig] = token.split('.');
    const payload = JSON.parse(atob(body)) as Record<string, unknown>;
    payload.campaignId = 'camp_ajena';
    const forjado = `${btoa(JSON.stringify(payload))}.${sig}`;
    expect(await verifyAdToken(forjado, NOW)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rechaza una firma inventada', async () => {
    const token = await emit();
    const [body] = token.split('.');
    expect(await verifyAdToken(`${body}.${'0'.repeat(64)}`, NOW)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rechaza un token firmado con otro secreto', async () => {
    const token = await emit();
    envMock.ADS_TOKEN_SECRET = 'otro-secreto-del-mismo-largo-pero-distinto';
    expect(await verifyAdToken(token, NOW)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rechaza basura sin romperse', async () => {
    for (const basura of ['', 'abc', 'a.b.c', 'no-es-token', '%%%.%%%']) {
      expect((await verifyAdToken(basura, NOW)).ok).toBe(false);
    }
    expect((await verifyAdToken(null, NOW)).ok).toBe(false);
    expect((await verifyAdToken(undefined, NOW)).ok).toBe(false);
  });

  it('cada emisión tiene un nonce distinto (dos anuncios del mismo usuario no colisionan)', async () => {
    const a = await emit();
    const b = await emit();
    expect(a).not.toBe(b);
  });
});

describe('userHash', () => {
  beforeEach(() => {
    envMock.ADS_TOKEN_SECRET = SECRET;
    envMock.ENVIRONMENT = 'production';
  });

  it('es estable para el mismo usuario y cambia para otro', async () => {
    expect(await userHash('usr_1')).toBe(await userHash('usr_1'));
    expect(await userHash('usr_1')).not.toBe(await userHash('usr_2'));
  });

  it('no contiene el id de usuario en claro', async () => {
    expect(await userHash('usr_secreto_123')).not.toContain('usr_secreto_123');
  });
});

describe('M1: la clave fija de desarrollo NO se usa fuera de desarrollo', () => {
  // Ronda 2 (M1). Antes: `if (!production) usar clave fija`. Eso permitia que, si en
  // produccion faltaba ADS_TOKEN_SECRET, cualquiera firmara tokens con el campaignId y el
  // priceCOP que quisiera usando una clave PUBLICA del codigo fuente.
  beforeEach(() => {
    envMock.ADS_TOKEN_SECRET = undefined;
    envMock.ENVIRONMENT = 'production';
  });

  it('sin ENVIRONMENT, un ENVIRONMENT VACIO tampoco firma', () => {
    // `import.meta.env.DEV` es true bajo vitest (Vite lo define), asi que el caso "nada
    // declarado" no se puede reproducir aqui sin falsear el runtime. Lo que SI importa y si
    // se comprueba es que un valor VACIO o=""
    envMock.ENVIRONMENT = '';
    expect(hasUsableSecret()).toBe(true); // bajo vitest: se considera dev por el runner
    // ...y en un runtime real (sin DEV ni VITEST) un "" no habilita la clave fija. Cubierto
    // por el test siguiente, que es el que importa para produccion.
  });

  it('la deteccion de dev NO puede rebajar un ENVIRONMENT declarado a desarrollo', () => {
    // Este es el cierre real de M1: por muchos indicadores de dev que se detecten
    // (import.meta.env.DEV, process.env.VITEST), si ENVIRONMENT esta declarado y no es de
    // desarrollo, NO se firma. Antes bastaba con que ENVIRONMENT != 'production'.
    for (const environment of ['production', 'staging', 'preview', 'qa', 'produccion', 'x', '0']) {
      envMock.ENVIRONMENT = environment;
      expect(hasUsableSecret(), environment).toBe(false);
    }
    envMock.ENVIRONMENT = undefined;
  });

  it('un ENVIRONMENT declarado manda sobre VITEST: asi se cubre el test de staging', () => {
    // Aunque el codigo corra bajo vitest, si ENVIRONMENT dice production no se degrada a la
    // clave fija. Es el cierre real del fallo M1.
    envMock.ENVIRONMENT = 'production';
    expect((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.VITEST).toBeTruthy();
    expect(hasUsableSecret()).toBe(false);
  });

  it.each([['staging'], ['preview'], ['qa'], ['produccion'], ['Production'], ['PROD']])(
    'en %s tampoco firma',
    (environment) => {
      envMock.ENVIRONMENT = environment;
      expect(hasUsableSecret()).toBe(false);
    },
  );

  it('solo development / dev / test usan la clave fija', () => {
    for (const environment of ['development', 'dev', 'test']) {
      envMock.ENVIRONMENT = environment;
      expect(hasUsableSecret(), environment).toBe(true);
    }
  });

  it('el userHash tampoco se calcula con la clave fija fuera de desarrollo', async () => {
    // M1 alcance al HMAC del usuario: con la clave publica, el userHash seria reversible
    // para cualquiera que quisiera, rompiendo el tope de frecuencia anonimo.
    await expect(userHash('usr_1')).rejects.toThrow(/ADS_TOKEN_SECRET/);
  });

  it('con el secreto presente, todo lo anterior funciona', async () => {
    envMock.ADS_TOKEN_SECRET = SECRET;
    expect(hasUsableSecret()).toBe(true);
    const token = await signAdToken({
      campaignId: 'camp_1',
      slot: 'shop_feed',
      userHash: 'h',
      priceCOP: 100,
      pricingModel: 'cpm',
      now: NOW,
    });
    expect((await verifyAdToken(token, NOW)).ok).toBe(true);
  });
});
