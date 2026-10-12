/**
 * tests/mesh-room-key-api.test.ts — GET /api/mesh/room-key: sala y clave de telemetria por tenant.
 *
 * Es el unico lugar que reparte la clave que cifra la malla, asi que se prueba como frontera de
 * seguridad: sin sesion no hay nada, el tenant sale de la sesion y no de la URL, y en produccion
 * sin secreto se falla cerrado.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { GET } from '../src/pages/api/mesh/room-key';
import { DEV_MESH_ROOM_SECRET, EPOCH_MS, INFO_ROOM_ID, INFO_ROOM_KEY, deriveRoomKeys } from '../src/pages/api/mesh/_roomKey';

const envMock = env as unknown as Record<string, unknown>;
// Fixture de test, no un secreto real: 40 caracteres repetidos para pasar el minimo de 32.
const FIXTURE_ROOM_SECRET = 'x'.repeat(40);
const SESSIONS: Record<string, { userId: string; instanceId: string }> = {
  'tok-a1': { userId: 'usr_a1', instanceId: 'tenant-a' },
  'tok-a2': { userId: 'usr_a2', instanceId: 'tenant-a' },
  'tok-b': { userId: 'usr_b', instanceId: 'tenant-b' },
};

function ctx(token: string | null, query = '') {
  const headers: Record<string, string> = {};
  if (token) headers.cookie = `session=${token}`;
  const request = new Request(`https://gara-g.swal.network/api/mesh/room-key${query}`, { headers });
  const s = token ? SESSIONS[token] : undefined;
  return { request, locals: s ? { tenant: { instanceId: s.instanceId } } : {} } as any;
}
const get = async (token: string | null, query = '') => {
  const res = await GET(ctx(token, query));
  return { res, body: (await res.json()) as any };
};

beforeEach(() => {
  vi.useRealTimers();
  envMock.ENVIRONMENT = 'production';
  envMock.MESH_ROOM_SECRET = FIXTURE_ROOM_SECRET;
  envMock.SESSION = {
    get: vi.fn(async (key: string) => {
      const s = SESSIONS[key.replace('token:', '')];
      return s ? JSON.stringify({ ...s, email: 'x@y.z', role: 'observer', exp: Date.now() + 60_000 }) : null;
    }),
    delete: vi.fn(),
  };
});

describe('/api/mesh/room-key', () => {
  it('sin sesion (sin cookie o con un token que no existe) responde 401 y no entrega nada', async () => {
    for (const token of [null, 'tok-inventado']) {
      const { res, body } = await get(token);
      expect(res.status).toBe(401);
      expect(body.key).toBeUndefined();
      expect(body.roomId).toBeUndefined();
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
  });

  it('un invitado (cookie de modo local, sin sesion) recibe 401', async () => {
    const request = new Request('https://gara-g.swal.network/api/mesh/room-key', { headers: { cookie: 'gara_mode=guest' } });
    const res = await GET({ request, locals: {} } as any);
    expect(res.status).toBe(401);
  });

  it('con sesion: roomId (128 bits hex), clave AES-256, epoca, previa y no-store', async () => {
    const { res, body } = await get('tok-a1');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(body.roomId).toMatch(/^[0-9a-f]{32}$/);
    expect(body.key).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes en base64url
    expect(body.previous.key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.previous.epoch).toBe(body.epoch - 1);
    expect(body.previous.key).not.toBe(body.key);
    expect(body.rotatesAt).toBe((body.epoch + 1) * EPOCH_MS);
    expect(JSON.stringify(body)).not.toContain('tenant-a');
    expect(JSON.stringify(body)).not.toContain(FIXTURE_ROOM_SECRET);
  });

  it('ignora el instanceId de la query, de las cabeceras y de la ruta: manda la sesion', async () => {
    const base = (await get('tok-a1')).body;
    const viaQuery = (await get('tok-a1', '?instanceId=tenant-b&instance=tenant-b&tenant=tenant-b')).body;
    expect(viaQuery.roomId).toBe(base.roomId);
    expect(viaQuery.key).toBe(base.key);
    const other = (await get('tok-b')).body;
    expect(other.roomId).not.toBe(base.roomId);
    // Ni siquiera con la cabecera x-instance-id.
    const c = ctx('tok-a1');
    c.request = new Request(c.request.url, { headers: { cookie: 'session=tok-a1', 'x-instance-id': 'tenant-b' } });
    const viaHeader = await (await GET(c)).json();
    expect(viaHeader.roomId).toBe(base.roomId);
  });

  it('tenants distintos -> roomId y claves distintos (actual y previa); mismo tenant -> los mismos', async () => {
    const a1 = (await get('tok-a1')).body;
    const a2 = (await get('tok-a2')).body; // otro usuario, mismo tenant
    const b = (await get('tok-b')).body;
    expect(a2.roomId).toBe(a1.roomId);
    expect(a2.key).toBe(a1.key);
    expect(a2.previous.key).toBe(a1.previous.key);
    expect(b.roomId).not.toBe(a1.roomId);
    expect(b.key).not.toBe(a1.key);
    expect(b.previous.key).not.toBe(a1.previous.key);
    expect(b.key).not.toBe(a1.previous.key);
  });

  it('es estable dentro de la epoca y rota al cambiar de epoca, con la previa enlazada', async () => {
    const t0 = 1_800_000_000_000 - (1_800_000_000_000 % EPOCH_MS) + 1000; // principio de una epoca
    const e0 = await deriveRoomKeys(FIXTURE_ROOM_SECRET, 'tenant-a', t0);
    const later = await deriveRoomKeys(FIXTURE_ROOM_SECRET, 'tenant-a', t0 + EPOCH_MS - 2000);
    expect(later).toEqual(e0);
    const next = await deriveRoomKeys(FIXTURE_ROOM_SECRET, 'tenant-a', t0 + EPOCH_MS);
    expect(next.epoch).toBe(e0.epoch + 1);
    expect(next.roomId).toBe(e0.roomId); // el nombre de la sala no rota
    expect(next.key).not.toBe(e0.key);
    expect(next.previous).toEqual({ epoch: e0.epoch, key: e0.key }); // el relevo: la previa de hoy es la actual de ayer
  });

  it('la derivacion ata proposito e instancia (info) y depende del secreto', async () => {
    expect(INFO_ROOM_ID).toBe('gara-mesh-room-id/v1|');
    expect(INFO_ROOM_KEY).toBe('gara-mesh-room-key/v1|');
    const now = 1_800_000_000_000;
    const a = await deriveRoomKeys(FIXTURE_ROOM_SECRET, 'tenant-a', now);
    const a2 = await deriveRoomKeys(FIXTURE_ROOM_SECRET + 'x', 'tenant-a', now);
    expect(a2.roomId).not.toBe(a.roomId);
    expect(a2.key).not.toBe(a.key);
    // Un instanceId que es prefijo de otro no colisiona.
    const p = await deriveRoomKeys(FIXTURE_ROOM_SECRET, 'tenant-', now);
    expect(p.roomId).not.toBe(a.roomId);
    // El roomId (publico en el cable) no es la clave ni un prefijo de ella.
    expect(a.key).not.toContain(a.roomId);
  });

  it('produccion sin secreto (o con uno corto) responde 503 y no cae a sala sin cifrar ni al secreto de dev', async () => {
    for (const secret of [undefined, '', 'corto', 12345, DEV_MESH_ROOM_SECRET.slice(0, 20)]) {
      envMock.MESH_ROOM_SECRET = secret;
      const { res, body } = await get('tok-a1');
      expect(res.status).toBe(503);
      expect(body.key).toBeUndefined();
      expect(body.roomId).toBeUndefined();
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
    // Sin sesion sigue siendo 401 (la autenticacion va antes que la configuracion).
    envMock.MESH_ROOM_SECRET = undefined;
    expect((await get(null)).res.status).toBe(401);
  });

  it('fuera de produccion sin secreto usa el secreto de desarrollo; con secreto, el configurado', async () => {
    envMock.ENVIRONMENT = 'development';
    envMock.MESH_ROOM_SECRET = undefined;
    const dev = await get('tok-a1');
    expect(dev.res.status).toBe(200);
    const expected = await deriveRoomKeys(DEV_MESH_ROOM_SECRET, 'tenant-a');
    expect(dev.body.roomId).toBe(expected.roomId);
    envMock.MESH_ROOM_SECRET = 'otro-secreto-de-staging';
    const staging = await get('tok-a1');
    expect(staging.body.roomId).not.toBe(dev.body.roomId);
    // El secreto de dev nunca produce la misma sala que el de produccion.
    envMock.ENVIRONMENT = 'production';
    envMock.MESH_ROOM_SECRET = FIXTURE_ROOM_SECRET;
    expect((await get('tok-a1')).body.roomId).not.toBe(dev.body.roomId);
  });

  it('es barato: derivar los tres valores cabe de sobra en el presupuesto de CPU', async () => {
    const t = performance.now();
    for (let i = 0; i < 20; i++) await deriveRoomKeys(FIXTURE_ROOM_SECRET, 'tenant-a');
    expect((performance.now() - t) / 20).toBeLessThan(5); // ms por peticion; el limite de Workers Free es 10 ms
  });
});
