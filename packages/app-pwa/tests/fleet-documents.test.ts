/**
 * packages/app-pwa/tests/fleet-documents.test.ts
 *
 * Contratos de gestión de documentos, upload y vault R2:
 * - Endpoints /api/fleet/upload.ts y /api/fleet/files.ts
 * - Validación de entradas (campos faltantes, tamaño por tipo: imagen 10MB / PDF 40MB, tipos MIME no permitidos)
 * - Clave del vault con el tenant delante, que es lo que /r2/[...path].ts sirve
 * - Fallo cerrado sin sesión/tenant (HTTP 401)
 * - Aislamiento de tenant y pertenencia a entidad (belongsTo con attachedTo string u objeto, HTTP 403/404)
 * - Manejo de R2 no disponible (HTTP 503)
 * - Redirecciones HTML form (_redirect) vs respuestas JSON
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { domainConfig } from '../src/lib/domain.config.js';
import * as domain from '../src/lib/domain.js';
import { POST as UPLOAD_POST, OPTIONS as UPLOAD_OPTIONS } from '../src/pages/api/fleet/upload.js';
import { GET as FILES_GET, POST as FILES_POST, DELETE as FILES_DELETE, OPTIONS as FILES_OPTIONS } from '../src/pages/api/fleet/files.js';

vi.mock('../src/lib/domain.js', () => ({
  listEntities: vi.fn(),
  createEntity: vi.fn(),
  deleteEntity: vi.fn(),
}));

const envMock = env as unknown as Record<string, unknown>;
const CANONICAL_TENANT = domainConfig.instanceId;

function makeCtx(
  path: string,
  options: {
    method?: string;
    body?: BodyInit;
    headers?: Record<string, string>;
    tenant?: string | null;
  } = {},
) {
  const urlStr = `https://gara-g.swal.network${path}`;
  const req = new Request(urlStr, {
    method: options.method || 'GET',
    body: options.body,
    headers: options.headers,
  });
  const locals: Record<string, unknown> = {};
  if (options.tenant !== null) {
    locals.tenant = { instanceId: options.tenant ?? CANONICAL_TENANT };
  }
  return {
    request: req,
    locals,
    url: new URL(urlStr),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  envMock.ENVIRONMENT = 'production';
  envMock.DOMAIN = 'gara-g.swal.network';
  envMock.SWAL_R2 = {
    put: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue(undefined),
  } as unknown as R2Bucket;
  (domain.listEntities as any).mockResolvedValue([]);
  (domain.createEntity as any).mockResolvedValue({ id: 'doc_123' });
  (domain.deleteEntity as any).mockResolvedValue(undefined);
});

describe('POST /api/fleet/upload — Contratos de subida a R2', () => {
  it('responde 204 en preflight OPTIONS', async () => {
    const res = await UPLOAD_OPTIONS({} as any);
    expect(res.status).toBe(204);
  });

  it('rechaza con 400 si faltan campos requeridos', async () => {
    const fd = new FormData();
    fd.set('entityType', 'vehicle');
    // Falta file, entityId y kind
    const ctx = makeCtx('/api/fleet/upload', { method: 'POST', body: fd });
    const res = await UPLOAD_POST(ctx as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Faltan campos/);
  });

  it('rechaza con 413 si la imagen supera los 10MB', async () => {
    const largeFile = new File([new Uint8Array(11 * 1024 * 1024)], 'grande.jpg', { type: 'image/jpeg' });
    const fd = new FormData();
    fd.set('file', largeFile);
    fd.set('entityType', 'vehicle');
    fd.set('entityId', 'VH-100');
    fd.set('kind', 'soat');

    const ctx = makeCtx('/api/fleet/upload', { method: 'POST', body: fd });
    const res = await UPLOAD_POST(ctx as any);
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error).toMatch(/10MB/);
  });

  it('rechaza con 415 si el tipo MIME no está permitido', async () => {
    const badFile = new File(['exec script'], 'malware.exe', { type: 'application/x-msdownload' });
    const fd = new FormData();
    fd.set('file', badFile);
    fd.set('entityType', 'vehicle');
    fd.set('entityId', 'VH-100');
    fd.set('kind', 'soat');

    const ctx = makeCtx('/api/fleet/upload', { method: 'POST', body: fd });
    const res = await UPLOAD_POST(ctx as any);
    expect(res.status).toBe(415);
    const body = await res.json();
    expect(body.error).toMatch(/Tipo no permitido/);
  });

  it('responde 503 si el binding R2 no está disponible', async () => {
    delete envMock.SWAL_R2;
    const okFile = new File(['content'], 'doc.pdf', { type: 'application/pdf' });
    const fd = new FormData();
    fd.set('file', okFile);
    fd.set('entityType', 'vehicle');
    fd.set('entityId', 'VH-100');
    fd.set('kind', 'soat');

    const ctx = makeCtx('/api/fleet/upload', { method: 'POST', body: fd });
    const res = await UPLOAD_POST(ctx as any);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/R2/);
  });

  it('sube correctamente a R2 y retorna 201 Created con metadatos', async () => {
    const okFile = new File(['pdf data'], 'tarjeta de propiedad.pdf', { type: 'application/pdf' });
    const fd = new FormData();
    fd.set('file', okFile);
    fd.set('entityType', 'vehicle');
    fd.set('entityId', 'VH-100');
    fd.set('kind', 'tarjeta');

    const ctx = makeCtx('/api/fleet/upload', { method: 'POST', body: fd });
    const res = await UPLOAD_POST(ctx as any);
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.key).toMatch(
      new RegExp(`^${CANONICAL_TENANT}/vehicle/VH-100/tarjeta/\\d+-tarjeta_de_propiedad\\.pdf$`),
    );
    expect(body.url).toContain(body.key);
    expect(body.size).toBe(okFile.size);
    expect(body.type).toBe('application/pdf');

    expect((envMock.SWAL_R2 as any).put).toHaveBeenCalled();
  });

  it('falla cerrado con 401 sin tenant en la sesión', async () => {
    const fd = new FormData();
    fd.set('file', new File(['pdf'], 'doc.pdf', { type: 'application/pdf' }));
    fd.set('entityType', 'vehicle');
    fd.set('entityId', 'VH-100');
    fd.set('kind', 'soat');
    const ctx = makeCtx('/api/fleet/upload', { method: 'POST', body: fd, tenant: null });
    const res = await UPLOAD_POST(ctx as any);
    expect(res.status).toBe(401);
    expect((envMock.SWAL_R2 as any).put).not.toHaveBeenCalled();
  });
});

describe('GET /api/fleet/files — Contratos de consulta de documentos', () => {
  it('responde 204 en OPTIONS', async () => {
    const res = await FILES_OPTIONS({} as any);
    expect(res.status).toBe(204);
  });

  it('falla cerrado con 401 si no hay tenant en la sesión', async () => {
    const ctx = makeCtx('/api/fleet/files?entityType=vehicle&entityId=VH-1', { tenant: null });
    const res = await FILES_GET(ctx as any);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/No autenticado/);
  });

  it('rechaza con 400 si falta entityType o entityId', async () => {
    const ctx = makeCtx('/api/fleet/files?entityType=vehicle');
    const res = await FILES_GET(ctx as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Faltan/);
  });

  it('filtra y normaliza adjuntos con attachedTo string u objeto', async () => {
    (domain.listEntities as any).mockResolvedValue([
      {
        id: 'doc_1',
        fileKey: 'v/vh1/soat.pdf',
        name: 'SOAT 2026',
        mimeType: 'application/pdf',
        size: 1024,
        attachedTo: 'vehicle:VH-1',
        createdAt: '2026-01-01T00:00:00Z',
      },
      {
        id: 'doc_2',
        r2Key: 'v/vh1/tecno.pdf',
        fileName: 'Tecno 2026',
        fileType: 'application/pdf',
        fileSize: 2048,
        attachedTo: { entityType: 'vehicle', entityId: 'VH-1' },
        updated_at: '2026-01-02T00:00:00Z',
      },
      {
        id: 'doc_3',
        fileKey: 'v/vh2/poliza.pdf',
        attachedTo: 'vehicle:VH-2',
      },
    ]);

    const ctx = makeCtx('/api/fleet/files?entityType=vehicle&entityId=VH-1');
    const res = await FILES_GET(ctx as any);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.files).toHaveLength(2);
    expect(body.files[0]).toEqual({
      id: 'doc_1',
      key: 'v/vh1/soat.pdf',
      name: 'SOAT 2026',
      type: 'application/pdf',
      size: 1024,
      kind: 'document',
      uploadedAt: '2026-01-01T00:00:00Z',
    });
    expect(body.files[1]).toEqual({
      id: 'doc_2',
      key: 'v/vh1/tecno.pdf',
      name: 'Tecno 2026',
      type: 'application/pdf',
      size: 2048,
      kind: 'document',
      uploadedAt: '2026-01-02T00:00:00Z',
    });
  });
});

describe('POST /api/fleet/files — Upload y borrado de formularios', () => {
  it('falla cerrado con 401 sin tenant', async () => {
    const fd = new FormData();
    const ctx = makeCtx('/api/fleet/files', { method: 'POST', body: fd, tenant: null });
    const res = await FILES_POST(ctx as any);
    expect(res.status).toBe(401);
  });

  it('sube documento y responde 201 JSON por defecto', async () => {
    const okFile = new File(['pdf content'], 'tecnomecanica.pdf', { type: 'application/pdf' });
    const fd = new FormData();
    fd.set('file', okFile);
    fd.set('entityType', 'vehicle');
    fd.set('entityId', 'VH-1');
    fd.set('kind', 'tecno');

    const ctx = makeCtx('/api/fleet/files', { method: 'POST', body: fd });
    const res = await FILES_POST(ctx as any);
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.key).toMatch(
      new RegExp(`^${CANONICAL_TENANT}/vehicle/VH-1/tecno/\\d+-tecnomecanica\\.pdf$`),
    );
    expect(domain.createEntity).toHaveBeenCalledWith(
      'document',
      expect.objectContaining({
        name: 'tecnomecanica.pdf',
        fileType: 'application/pdf',
        attachedTo: 'vehicle:VH-1',
      }),
      CANONICAL_TENANT,
    );
  });

  it('redirecciona con HTTP 303 si se incluye _redirect en el formulario', async () => {
    const okFile = new File(['pdf content'], 'soat.pdf', { type: 'application/pdf' });
    const fd = new FormData();
    fd.set('file', okFile);
    fd.set('entityType', 'vehicle');
    fd.set('entityId', 'VH-1');
    fd.set('_redirect', '/fleet/documents');

    const ctx = makeCtx('/api/fleet/files', {
      method: 'POST',
      body: fd,
    });
    const res = await FILES_POST(ctx as any);
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toMatch(/^\/fleet\/documents\?uploaded=/);
  });

  it('soporta _method=DELETE para formularios HTML', async () => {
    (domain.listEntities as any).mockResolvedValue([
      { id: 'doc_55', fileKey: `${CANONICAL_TENANT}/vehicle/VH-1/old.pdf`, attachedTo: 'vehicle:VH-1' },
    ]);

    const fd = new FormData();
    fd.set('_method', 'DELETE');
    fd.set('key', `${CANONICAL_TENANT}/vehicle/VH-1/old.pdf`);
    fd.set('entityType', 'vehicle');
    fd.set('entityId', 'VH-1');

    const ctx = makeCtx('/api/fleet/files', { method: 'POST', body: fd });
    const res = await FILES_POST(ctx as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    expect((envMock.SWAL_R2 as any).delete).toHaveBeenCalledWith(
      `${CANONICAL_TENANT}/vehicle/VH-1/old.pdf`,
    );
    expect(domain.deleteEntity).toHaveBeenCalledWith('document', 'doc_55', CANONICAL_TENANT);
  });

  it('_method=DELETE rechaza con 403 si el documento pertenece a otra entidad', async () => {
    const otraClave = `${CANONICAL_TENANT}/vehicle/VH-2/secret.pdf`;
    (domain.listEntities as any).mockResolvedValue([
      { id: 'doc_55', fileKey: otraClave, attachedTo: 'vehicle:VH-2' },
    ]);

    const fd = new FormData();
    fd.set('_method', 'DELETE');
    fd.set('key', otraClave);
    fd.set('entityType', 'vehicle');
    fd.set('entityId', 'VH-1'); // Entidad distinta

    const ctx = makeCtx('/api/fleet/files', { method: 'POST', body: fd });
    const res = await FILES_POST(ctx as any);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/no pertenece/);
  });
});

describe('DELETE /api/fleet/files — Borrado directo de archivos', () => {
  it('falla cerrado con 401 sin tenant', async () => {
    const ctx = makeCtx('/api/fleet/files?key=abc', { method: 'DELETE', tenant: null });
    const res = await FILES_DELETE(ctx as any);
    expect(res.status).toBe(401);
  });

  it('rechaza con 400 si falta el parámetro key', async () => {
    const ctx = makeCtx('/api/fleet/files', { method: 'DELETE' });
    const res = await FILES_DELETE(ctx as any);
    expect(res.status).toBe(400);
  });

  it('responde 503 si R2 no está disponible', async () => {
    delete envMock.SWAL_R2;
    const ctx = makeCtx(`/api/fleet/files?key=${CANONICAL_TENANT}/vehicle/VH-1/doc.pdf`, {
      method: 'DELETE',
    });
    const res = await FILES_DELETE(ctx as any);
    expect(res.status).toBe(503);
  });

  it('responde 404 si el documento no existe en el tenant', async () => {
    (domain.listEntities as any).mockResolvedValue([]);
    const ctx = makeCtx(`/api/fleet/files?key=${CANONICAL_TENANT}/vehicle/VH-1/inexistente.pdf`, {
      method: 'DELETE',
    });
    const res = await FILES_DELETE(ctx as any);
    expect(res.status).toBe(404);
  });

  it('soporta la eliminación vía application/x-www-form-urlencoded con redirección', async () => {
    const clave = `${CANONICAL_TENANT}/vehicle/VH-1/form_del.pdf`;
    (domain.listEntities as any).mockResolvedValue([
      { id: 'doc_88', fileKey: clave, attachedTo: 'vehicle:VH-1' },
    ]);

    const body = new URLSearchParams({
      key: clave,
      _redirect: '/fleet/documents',
    }).toString();

    const ctx = makeCtx('/api/fleet/files?entityType=vehicle&entityId=VH-1', {
      method: 'DELETE',
      body,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    const res = await FILES_DELETE(ctx as any);
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/fleet/documents?deleted=1');
    expect((envMock.SWAL_R2 as any).delete).toHaveBeenCalledWith(clave);
    expect(domain.deleteEntity).toHaveBeenCalledWith('document', 'doc_88', CANONICAL_TENANT);
  });

  /**
   * Defensa en profundidad: `key` viene del cliente y va directo a `r2.delete`.
   * Una clave sin el prefijo del tenant no puede ser nuestra, así que ni se
   * consulta la base ni se toca el bucket.
   */
  it('no borra una clave que está fuera del prefijo del tenant', async () => {
    (domain.listEntities as any).mockResolvedValue([
      { id: 'doc_99', fileKey: 'otro-tenant/vehicle/VH-1/ajeno.pdf', attachedTo: 'vehicle:VH-1' },
    ]);
    const ctx = makeCtx('/api/fleet/files?key=otro-tenant/vehicle/VH-1/ajeno.pdf&entityType=vehicle&entityId=VH-1', {
      method: 'DELETE',
    });
    const res = await FILES_DELETE(ctx as any);
    expect(res.status).toBe(404);
    expect((envMock.SWAL_R2 as any).delete).not.toHaveBeenCalled();
    expect(domain.deleteEntity).not.toHaveBeenCalled();
  });
});
