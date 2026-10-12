/**
 * tests/files-vault-contract.test.ts — el vault de documentos: clave, topes y RBAC.
 *
 * Los tres fallos que rompían subir y bajar archivos, todos verificados leyendo el
 * código (y ninguno cubierto por la suite):
 *
 *   1. El middleware pasaba el segmento del path a `can()` tal cual: '/api/fleet/files'
 *      se traducía a la entidad 'files', que no está en PERMISSIONS, así que `can()`
 *      devolvía false para todo rol y la subida respondía 403 siempre.
 *   2. files.ts y upload.ts escribían la clave como `{entityType}/...` sin tenant,
 *      mientras /r2/[...path].ts solo sirve claves `{tenant}/...`: todo lo subido era
 *      indistinguible de un 404.
 *   3. `await file.arrayBuffer()` traía el archivo entero a memoria; un manual de
 *      taller de 40 MB no cabe cómodo en un isolate de Workers.
 *
 * Los archivos grandes aquí son falsos: solo `size`, `type` y `name`. Los handlers
 * consultan `.size` ANTES de leer un byte, así que las dos ramas (413 y 201) se
 * cubren sin mover 40 MB por la suite.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import * as domain from '../src/lib/domain.js';
import { can, RBAC_PATH_ALIASES, rbacEntityFor } from '../src/lib/rbac.js';
import { onRequest } from '../src/middleware.js';
import { POST as FILES_POST } from '../src/pages/api/fleet/files.js';
import { POST as UPLOAD_POST } from '../src/pages/api/fleet/upload.js';
import { GET as R2_GET } from '../src/pages/r2/[...path].js';
import { r2PutBody } from '../src/lib/fleetApi.js';

// El vault exige sesión y el middleware llama a getUserFromRequest: se sustituye
// la lectura de KV por un getSessionUser fijo (misma forma que el original).
const { getSessionUser } = vi.hoisted(() => ({ getSessionUser: vi.fn() }));
vi.mock('../src/lib/session.js', () => ({
  getSessionUser,
  getUserFromRequest: async (request: Request) => {
    const match = (request.headers.get('cookie') ?? '').match(/(?:^|;\s*)session=([^;]+)/);
    return match ? getSessionUser(match[1]) : null;
  },
  devFallbackAllowed: () => false,
}));

vi.mock('../src/lib/domain.js', () => ({
  listEntities: vi.fn(),
  createEntity: vi.fn(),
  deleteEntity: vi.fn(),
  // El middleware inicializa el adaptador de almacenamiento al entrar.
  setStorageAdapter: vi.fn(),
  initD1Adapter: vi.fn(),
  getMemoryAdapter: vi.fn(() => ({})),
}));

const envMock = env as unknown as Record<string, unknown>;
const TENANT = 'tenant-acero';

const MB = 1024 * 1024;

/** File con `size` declarado y cero bytes: suficiente porque se valida el tamaño primero. */
const fakeFile = (name: string, type: string, size: number) =>
  ({ name, type, size, stream: () => new ReadableStream(), arrayBuffer: async () => new ArrayBuffer(0) }) as unknown as File;

/**
 * FormData real + request con `formData()` propio: un File falso no pasa por
 * FormData.set() (lo convertiría a string), así que el FormData se construye a mano.
 */
function ctxWith(fields: Record<string, unknown>, tenant: string | null = TENANT, path = '/api/fleet/files') {
  const formData = {
    get: (k: string) => (k in fields ? fields[k] : null),
  } as unknown as FormData;
  const request = {
    headers: new Headers({ 'content-type': 'multipart/form-data' }),
    formData: async () => formData,
  } as unknown as Request;
  return {
    request,
    url: new URL(`https://gara-g.swal.network${path}`),
    locals: tenant ? { tenant: { instanceId: tenant }, user: { role: 'admin' } } : {},
  } as any;
}

const putArgs = () => (envMock.SWAL_R2 as any).put.mock.calls[0] as [string, unknown, unknown];

beforeEach(() => {
  vi.clearAllMocks();
  envMock.ENVIRONMENT = 'production';
  envMock.DOMAIN = 'gara-g.swal.network';
  envMock.SWAL_R2 = { put: vi.fn().mockResolvedValue({}), delete: vi.fn().mockResolvedValue(undefined) } as any;
  (domain.listEntities as any).mockResolvedValue([]);
  (domain.createEntity as any).mockResolvedValue({ id: 'doc_1' });
});

describe('RBAC: /api/fleet/files y /api/fleet/upload son de "document"', () => {
  it('el operador puede crear y leer documentos', () => {
    // Sin 'create' no podía subir ni la foto de un vehículo ni una factura.
    expect(can('operator', 'document', 'create')).toBe(true);
    expect(can('operator', 'document', 'read')).toBe(true);
  });

  it('sigue sin poder borrarlos ni tocar users', () => {
    expect(can('operator', 'document', 'delete')).toBe(false);
    expect(can('operator', 'document', 'update')).toBe(false);
    expect(can('operator', 'user', 'read')).toBe(false);
  });

  it('admin y observer no cambian', () => {
    expect(can('admin', 'document', 'delete')).toBe(true);
    expect(can('observer', 'document', 'read')).toBe(true);
    expect(can('observer', 'document', 'create')).toBe(false);
  });

  it('"files" y "upload" resuelven a document, y solo esos dos', () => {
    expect(rbacEntityFor('files')).toBe('document');
    expect(rbacEntityFor('upload')).toBe('document');
    // Un segmento sin alias sigue tal cual: denegar por defecto.
    expect(rbacEntityFor('vehicle')).toBe('vehicle');
    expect(rbacEntityFor('inventado')).toBe('inventado');
    expect(Object.keys(RBAC_PATH_ALIASES).sort()).toEqual(['files', 'upload']);
  });
});

describe('middleware: el RBAC de /api/fleet/* usa la entidad resuelta', () => {
  function mwCtx(path: string, method = 'POST') {
    const token = 'session=token-real';
    return {
      url: new URL(`https://gara-g.swal.network${path}`),
      request: new Request(`https://gara-g.swal.network${path}`, {
        method,
        headers: { cookie: token },
      }),
      cookies: { get: (k: string) => (k === 'session' ? { value: 'token-real' } : undefined) },
      locals: {} as Record<string, unknown>,
      redirect: (to: string, code: number) =>
        new Response(null, { status: code, headers: { Location: to } }),
    } as any;
  }

  /** Sesion ya resuelta (KV esta mockeada): lo que el middleware ve del usuario. */
  const sesion = (role: string) => ({
    userId: 'usr_1',
    email: `${role}@cliente.cl`,
    role,
    instanceId: TENANT,
    exp: Date.now() + 60_000,
  });

  const next = async () => new Response('NEXT', { status: 200 });

  beforeEach(() => {
    getSessionUser.mockResolvedValue(sesion('operator'));
  });

  it('un operador sube a /api/fleet/files (antes 403 para todos)', async () => {
    const res = await onRequest(mwCtx('/api/fleet/files'), next);
    expect(res.status).toBe(200);
  });

  it('un operador sube a /api/fleet/upload (antes 403 para todos)', async () => {
    const res = await onRequest(mwCtx('/api/fleet/upload'), next);
    expect(res.status).toBe(200);
  });

  it('un operador lista documentos', async () => {
    const res = await onRequest(mwCtx('/api/fleet/files', 'GET'), next);
    expect(res.status).toBe(200);
  });

  it('un observer NO sube: el alias no abre permisos que antes no tenía', async () => {
    getSessionUser.mockResolvedValue(sesion('observer'));
    const res = await onRequest(mwCtx('/api/fleet/files'), next);
    expect(res.status).toBe(403);
    const body = await res.json();
    // El mensaje nombra la entidad real, no el segmento de la URL.
    expect(body.error).toContain('document');
  });

  it('el alias no toca las demás entidades', async () => {
    const res = await onRequest(mwCtx('/api/fleet/vehicle'), next);
    expect(res.status).toBe(200);
  });
});

describe('la clave del vault empieza por el tenant', () => {
  it('files.ts: {tenant}/{entityType}/{entityId}/{kind}/{ts}-{safeName}', async () => {
    const res = await FILES_POST(
      ctxWith({
        file: fakeFile('SOAT 2026.pdf', 'application/pdf', 2048),
        entityType: 'vehicle',
        entityId: 'VH-1',
        kind: 'insurance',
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.key).toMatch(
      new RegExp(`^${TENANT}/vehicle/VH-1/insurance/\\d+-SOAT_2026\\.pdf$`),
    );
    expect(body.key.startsWith(`${TENANT}/`)).toBe(true);
  });

  it('upload.ts escribe la misma clave que files.ts', async () => {
    const res = await UPLOAD_POST(
      ctxWith(
        {
          file: fakeFile('tecno.pdf', 'application/pdf', 2048),
          entityType: 'vehicle',
          entityId: 'VH-1',
          kind: 'tecno',
        },
        TENANT,
        '/api/fleet/upload',
      ),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.key).toMatch(new RegExp(`^${TENANT}/vehicle/VH-1/tecno/\\d+-tecno\\.pdf$`));
    expect(body.url).toContain(body.key);
  });

  it('el tenant es el de la sesión, no el que dice el formulario', async () => {
    await UPLOAD_POST(
      ctxWith(
        {
          file: fakeFile('a.pdf', 'application/pdf', 10),
          entityType: 'vehicle',
          entityId: 'VH-1',
          kind: 'tecno',
          instanceId: 'otro-tenant',
        },
        TENANT,
        '/api/fleet/upload',
      ),
    );
    expect(putArgs()[0].startsWith(`${TENANT}/`)).toBe(true);
  });

  it('sin tenant en la sesión no se escribe nada', async () => {
    const res = await UPLOAD_POST(
      ctxWith(
        {
          file: fakeFile('a.pdf', 'application/pdf', 10),
          entityType: 'vehicle',
          entityId: 'VH-1',
          kind: 'tecno',
        },
        null,
        '/api/fleet/upload',
      ),
    );
    expect(res.status).toBe(401);
    expect((envMock.SWAL_R2 as any).put).not.toHaveBeenCalled();
  });
});

describe('la clave no se puede construir con piezas sueltas', () => {
  const subir = async (fields: Record<string, unknown>) =>
    FILES_POST(
      ctxWith({ file: fakeFile('x.pdf', 'application/pdf', 100), kind: 'tecno', ...fields }),
    );

  it('rechaza un entityType que no es un identificador', async () => {
    for (const entityType of [
      'VEHICLE', // mayúsculas
      'v', // demasiado corto
      '../../../etc', // sale del prefijo del tenant
      'vehicle/x', // añade un segmento
      '',
    ]) {
      const res = await subir({ entityType, entityId: 'VH-1' });
      expect(res.status, `entityType=${entityType}`).toBe(400);
    }
    expect((envMock.SWAL_R2 as any).put).not.toHaveBeenCalled();
  });

  it('rechaza un entityId conjectedura de path o separadores', async () => {
    for (const entityId of ['../otro-tenant/x', 'VH 1', 'a/b', '', 'x'.repeat(65)]) {
      const res = await subir({ entityType: 'vehicle', entityId });
      expect(res.status, `entityId=${entityId}`).toBe(400);
    }
  });

  it('rechaza un kind fuera del alfabeto permitido', async () => {
    const res = await subir({ entityType: 'vehicle', entityId: 'VH-1', kind: '../..' });
    expect(res.status).toBe(400);
    expect((envMock.SWAL_R2 as any).put).not.toHaveBeenCalled();
  });

  it('upload.ts valida igual que files.ts', async () => {
    const res = await UPLOAD_POST(
      ctxWith(
        {
          file: fakeFile('x.pdf', 'application/pdf', 100),
          entityType: 'vehicle',
          entityId: '../otro-tenant',
          kind: 'tecno',
        },
        TENANT,
        '/api/fleet/upload',
      ),
    );
    expect(res.status).toBe(400);
    expect((envMock.SWAL_R2 as any).put).not.toHaveBeenCalled();
  });
});

describe('topes por tipo: 10 MB para imagen, 40 MB para PDF', () => {
  const subir = (name: string, type: string, size: number, ruta = '/api/fleet/files') =>
    ruta === '/api/fleet/files'
      ? FILES_POST(
          ctxWith({ file: fakeFile(name, type, size), entityType: 'vehicle', entityId: 'VH-1', kind: 'tecno' }),
        )
      : UPLOAD_POST(
          ctxWith(
            { file: fakeFile(name, type, size), entityType: 'vehicle', entityId: 'VH-1', kind: 'tecno' },
            TENANT,
            ruta,
          ),
        );

  it('acepta un PDF de 20 MB', async () => {
    const res = await subir('manual.pdf', 'application/pdf', 20 * MB);
    expect(res.status).toBe(201);
    expect((envMock.SWAL_R2 as any).put).toHaveBeenCalled();
  });

  it('rechaza una imagen de 20 MB', async () => {
    const res = await subir('foto.jpg', 'image/jpeg', 20 * MB);
    expect(res.status).toBe(413);
    const body = await res.json();
    // El 413 dice el tope que se aplicó, no siempre 10.
    expect(body.error).toMatch(/10MB/);
    expect((envMock.SWAL_R2 as any).put).not.toHaveBeenCalled();
  });

  it('rechaza una imagen de 10 MB + 1 byte', async () => {
    const res = await subir('foto.png', 'image/png', 10 * MB + 1);
    expect(res.status).toBe(413);
  });

  it('acepta un PDF de 40 MB y rechaza uno de 40 MB + 1', async () => {
    expect((await subir('manual.pdf', 'application/pdf', 40 * MB)).status).toBe(201);
    expect((await subir('manual.pdf', 'application/pdf', 40 * MB + 1)).status).toBe(413);
  });

  it('upload.ts aplica los mismos topes', async () => {
    const ruta = '/api/fleet/upload';
    expect((await subir('manual.pdf', 'application/pdf', 20 * MB, ruta)).status).toBe(201);
    const res = await subir('foto.jpg', 'image/jpeg', 20 * MB, ruta);
    expect(res.status).toBe(413);
    expect((await res.json()).error).toMatch(/10MB/);
  });
});

describe('el cuerpo del put no se carga entero en memoria', () => {
  it('con FixedLengthStream (Workers) devuelve el stream, no un ArrayBuffer', async () => {
    const original = (globalThis as any).FixedLengthStream;
    const longitudes: number[] = [];
    // Sustituto mínimo: dos streams enlazados, como el global real.
    (globalThis as any).FixedLengthStream = class {
      readable: ReadableStream;
      writable: WritableStream;
      constructor(public length: number) {
        longitudes.push(length);
        this.readable = new ReadableStream();
        this.writable = new WritableStream();
      }
    };
    try {
      const body = await r2PutBody(fakeFile('manual.pdf', 'application/pdf', 20 * MB));
      expect(body).toBeInstanceOf(ReadableStream);
      expect(longitudes).toEqual([20 * MB]);
    } finally {
      if (original === undefined) delete (globalThis as any).FixedLengthStream;
      else (globalThis as any).FixedLengthStream = original;
    }
  });

  it('sin ese global (node en los tests) cae a arrayBuffer', async () => {
    const body = await r2PutBody(fakeFile('x.pdf', 'application/pdf', 10));
    expect(body).toBeInstanceOf(ArrayBuffer);
  });
});

describe('GET /r2/{tenant}/{clave}: ?inline=1 solo para PDF e imagenes', () => {
  const KEY = `${TENANT}/vehicle/VH-1/tecno/1700000000-manual.pdf`;

  const objeto = (contentType: string, originalName?: string) => ({
    httpMetadata: { contentType },
    customMetadata: originalName ? { originalName } : {},
    size: 1234,
    etag: 'etag-1',
    body: new ReadableStream(),
  });

  const pedir = (key: string, query = '', objetoEnR2: unknown = objeto('application/pdf')) => {
    (envMock.SWAL_R2 as any).get = vi.fn().mockResolvedValue(objetoEnR2);
    return R2_GET({
      params: { path: key },
      cookies: { get: () => ({ value: 'token-real' }) },
      locals: { tenant: { instanceId: TENANT } },
      url: new URL(`https://gara-g.swal.network/r2/${key}${query}`),
    } as any);
  };

  beforeEach(() => {
    getSessionUser.mockResolvedValue({
      userId: 'usr_1',
      role: 'operator',
      instanceId: TENANT,
    });
  });

  it('sin el flag sigue siendo attachment + no-store', async () => {
    const res = await pedir(KEY);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toBe('attachment');
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('con ?inline=1 un PDF se muestra en el navegador', async () => {
    const res = await pedir(KEY, '?inline=1', objeto('application/pdf', 'manual de taller.pdf'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toBe('inline; filename="manual de taller.pdf"');
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=300');
    // Sin CSP sandbox: Chrome bloquea su visor de PDF dentro de un documento enjaulado.
    expect(res.headers.get('Content-Security-Policy')).toBeNull();
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('con ?inline=1 una imagen también, y enjaulada', async () => {
    const res = await pedir(KEY, '?inline=1', objeto('image/jpeg', 'foto.jpg'));
    expect(res.headers.get('Content-Disposition')).toBe('inline; filename="foto.jpg"');
    expect(res.headers.get('Content-Security-Policy')).toBe('sandbox');
  });

  it('con ?inline=1 un tipo que el navegador ejecuta NO se muestra', async () => {
    const res = await pedir(KEY, '?inline=1', objeto('text/html', '<script>.html'));
    expect(res.headers.get('Content-Disposition')).toBe('attachment');
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('el nombre de la cabecera no puede inyectar comillas ni saltos de línea', async () => {
    const res = await pedir(KEY, '?inline=1', objeto('application/pdf', 'a"; drop.pdf'));
    const cd = res.headers.get('Content-Disposition')!;
    expect(cd).toBe('inline; filename="a_; drop.pdf"');
  });

  it('?inline=1 no salta el aislamiento por tenant', async () => {
    const res = await pedir('otro-tenant/vehicle/VH-1/secreto.pdf', '?inline=1');
    expect(res.status).toBe(404);
  });

  it('?inline=1 sin sesión sigue siendo 401', async () => {
    getSessionUser.mockResolvedValue(null);
    const res = await pedir(KEY, '?inline=1');
    expect(res.status).toBe(401);
  });
});