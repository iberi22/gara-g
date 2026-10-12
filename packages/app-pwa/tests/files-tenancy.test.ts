/**
 * tests/files-tenancy.test.ts — los documentos también respetan el tenant.
 *
 * Contexto: /api/fleet/files tiene 5 puntos donde el tenant estaba hardcodeado a
 * 'demo-flota' (listar, crear, borrar x2, reemplazar). El resto de la API resuelve el
 * tenant desde la sesión vía `resolveInstanceId`, así que estos 5 eran la excepción:
 * un cliente real subiría sus documentos al tenant equivocado y, peor, vería y
 * borraría los documentos de otro cliente.
 *
 * Estos tests fijan que los 5 caminos pasan por el tenant de la sesión.
 *
 * Y que el tenant viaje también dentro de la clave de R2: el vault
 * (pages/r2/[...path].ts) solo sirve claves con prefijo del tenant, así que una
 * clave sin él es un documento subido que nadie puede descargar.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import * as domain from '../src/lib/domain.js';
import { GET, POST, DELETE } from '../src/pages/api/fleet/files.js';

vi.mock('../src/lib/domain.js', () => ({
  listEntities: vi.fn(),
  createEntity: vi.fn(),
  deleteEntity: vi.fn(),
}));

const envMock = env as unknown as Record<string, unknown>;

const mkCtx = (q = '', body?: BodyInit, method = 'GET') =>
  ({
    request: new Request(`https://gara-g.swal.network/api/fleet/files${q}`, { method, body }),
    locals: { tenant: { instanceId: 'tenant-acero' }, user: { role: 'admin' } },
    url: new URL(`https://gara-g.swal.network/api/fleet/files${q}`),
  }) as any;

beforeEach(() => {
  vi.clearAllMocks();
  envMock.ENVIRONMENT = 'production';
  envMock.SWAL_R2 = {
    put: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue(undefined),
  } as any;
  (domain.listEntities as any).mockResolvedValue([]);
  (domain.createEntity as any).mockResolvedValue({ id: 'doc_1' });
  (domain.deleteEntity as any).mockResolvedValue(undefined);
});

const TENANT = 'tenant-acero';

describe('GET /api/fleet/files: lista en el tenant de la sesion', () => {
  it('lista documentos del tenant de la sesion, no del demo', async () => {
    await GET(mkCtx('?entityType=vehicle&entityId=VH-1'));
    expect(domain.listEntities).toHaveBeenCalledWith('document', TENANT);
  });

  it('nunca consulta el tenant demo en produccion', async () => {
    await GET(mkCtx('?entityType=vehicle&entityId=VH-1'));
    expect(domain.listEntities).not.toHaveBeenCalledWith('document', 'demo-flota');
  });

  it('rechaza sin tenant en vez de caer al demo', async () => {
    const ctx = mkCtx('?entityType=vehicle&entityId=VH-1');
    delete ctx.locals.tenant;
    const res = await GET(ctx);
    // Sin sesión no hay tenant que deducir: 401, nunca una caída al tenant demo.
    expect(res.status).toBe(401);
    expect(domain.listEntities).not.toHaveBeenCalled();
  });
});

describe('POST /api/fleet/files: sube al tenant de la sesion', () => {
  const upload = () => {
    const form = new FormData();
    form.set('entityType', 'vehicle');
    form.set('entityId', 'VH-1');
    form.set('kind', 'insurance');
    form.set('file', new File(['contenido'], 'seguro.pdf', { type: 'application/pdf' }));
    return mkCtx('', form, 'POST');
  };

  /**
   * createEntity(entity, data, instanceId): el tenant va TERCERO.
   * Pasarlo segundo lo escribia dentro del documento, no como instancia — el
   * documento se guardaba en el tenant por defecto y perdia el tenant de la sesion.
   */
  it('crea el documento en el tenant de la sesion (3er argumento)', async () => {
    await POST(upload());
    const call = (domain.createEntity as any).mock.calls[0];
    expect(call?.[2]).toBe(TENANT);
  });

  it('el tenant no se escribe dentro del documento', async () => {
    await POST(upload());
    const call = (domain.createEntity as any).mock.calls[0];
    expect(call?.[1]).toBeTypeOf('object');
    expect(call?.[1]).not.toBe(TENANT);
    expect(call?.[1].instanceId).toBeUndefined();
  });

  it('nunca crea en el tenant demo en produccion', async () => {
    await POST(upload());
    for (const c of (domain.createEntity as any).mock.calls) expect(c[2]).not.toBe('demo-flota');
  });
});

describe('DELETE /api/fleet/files: borra solo en el tenant de la sesion', () => {
  // Toda clave escrita lleva el tenant delante: es el prefijo que el vault exige.
  const key = `${TENANT}/vehicle/VH-1/insurance.pdf`;
  const doc = { id: 'doc_1', fileKey: key, attachedTo: 'vehicle:VH-1' };

  it('borra en el tenant de la sesion', async () => {
    (domain.listEntities as any).mockResolvedValue([doc]);
    await DELETE(mkCtx(`?key=${key}&entityType=vehicle&entityId=VH-1`, undefined, 'DELETE'));
    expect(domain.deleteEntity).toHaveBeenCalledWith('document', 'doc_1', TENANT);
  });

  it('no borra nada del tenant demo en produccion', async () => {
    (domain.listEntities as any).mockResolvedValue([doc]);
    await DELETE(mkCtx(`?key=${key}&entityType=vehicle&entityId=VH-1`, undefined, 'DELETE'));
    for (const c of (domain.deleteEntity as any).mock.calls) expect(c[2]).not.toBe('demo-flota');
  });

  it('no borra un documento que pertenece a otra entidad', async () => {
    (domain.listEntities as any).mockResolvedValue([
      { id: 'doc_1', fileKey: key, attachedTo: 'vehicle:OTRA-VEHICULA' },
    ]);
    const res = await DELETE(
      mkCtx(`?key=${key}&entityType=vehicle&entityId=VH-1`, undefined, 'DELETE'),
    );
    expect(domain.deleteEntity).not.toHaveBeenCalled();
    expect((env as any).SWAL_R2.delete).not.toHaveBeenCalled();
    expect(res.status).toBe(403);
  });

  it('responde 404 si el key no existe en el tenant', async () => {
    (domain.listEntities as any).mockResolvedValue([]);
    const res = await DELETE(
      mkCtx('?key=inexistente&entityType=vehicle&entityId=VH-1', undefined, 'DELETE'),
    );
    expect(res.status).toBe(404);
    expect(domain.deleteEntity).not.toHaveBeenCalled();
  });
});
