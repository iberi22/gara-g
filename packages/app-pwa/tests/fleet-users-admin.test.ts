/**
 * tests/fleet-users-admin.test.ts — User Management & RBAC Contracts
 *
 * Wave 31.02: Tests covering RBAC rules, user administration endpoint (/api/auth/register),
 * closed failure authorization, input validation, duplicate email conflict, and tenant isolation.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { can, normalizeRole, PERMISSIONS, ROLES } from '../src/lib/rbac.js';
import { POST as registerPost } from '../src/pages/api/auth/register.js';
import { DEFAULT_INSTANCE_ID } from '../src/lib/xavier.js';

const envMock = env as unknown as Record<string, unknown>;

const mockKv = {
  get: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
};

interface MockD1Row {
  id: string;
  data: string;
}

function createMockD1(rows: MockD1Row[] = []) {
  const runMock = vi.fn().mockResolvedValue({ success: true });
  const allMock = vi.fn().mockResolvedValue({ results: rows });
  const bindMock = vi.fn().mockReturnValue({
    run: runMock,
    all: allMock,
  });
  const prepareMock = vi.fn().mockReturnValue({
    bind: bindMock,
  });

  return {
    prepare: prepareMock,
    bindMock,
    runMock,
    allMock,
  };
}

function makeRequest(url: string, init: RequestInit = {}): Request {
  return new Request(url, init);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockKv.get.mockResolvedValue(null);
  mockKv.put.mockResolvedValue(undefined);
  envMock.SESSION = mockKv;
  envMock.SWAL_KV = mockKv;
  envMock.ENVIRONMENT = 'production';
  delete envMock.SWAL_D1;
});

describe('RBAC (Role-Based Access Control) Core Contracts', () => {
  it('closed failure: returns false for null, undefined, or invalid roles', () => {
    expect(can(null, 'user', 'read')).toBe(false);
    expect(can(undefined, 'user', 'read')).toBe(false);
    expect(can('hacker', 'vehicle', 'read')).toBe(false);
    expect(can('', 'user', 'create')).toBe(false);
  });

  it('closed failure: non-admin roles (operator, observer) have zero permissions on user entity', () => {
    expect(can('operator', 'user', 'create')).toBe(false);
    expect(can('operator', 'user', 'read')).toBe(false);
    expect(can('operator', 'user', 'update')).toBe(false);
    expect(can('operator', 'user', 'delete')).toBe(false);

    expect(can('observer', 'user', 'create')).toBe(false);
    expect(can('observer', 'user', 'read')).toBe(false);
    expect(can('observer', 'user', 'update')).toBe(false);
    expect(can('observer', 'user', 'delete')).toBe(false);
  });

  it('admin role possesses full CRUD permissions on user entity', () => {
    expect(can('admin', 'user', 'create')).toBe(true);
    expect(can('admin', 'user', 'read')).toBe(true);
    expect(can('admin', 'user', 'update')).toBe(true);
    expect(can('admin', 'user', 'delete')).toBe(true);
  });

  it('can() returns false for unknown entities or unlisted actions', () => {
    expect(can('admin', 'non_existent_entity', 'read')).toBe(false);
    expect(can('observer', 'vehicle', 'delete')).toBe(false);
    expect(can('operator', 'vehicle', 'delete')).toBe(false);
  });

  it('normalizeRole validates allowed roles and rejects invalid inputs', () => {
    expect(normalizeRole('admin')).toBe('admin');
    expect(normalizeRole('operator')).toBe('operator');
    expect(normalizeRole('observer')).toBe('observer');
    expect(normalizeRole('root')).toBeNull();
    expect(normalizeRole(123)).toBeNull();
    expect(normalizeRole(null)).toBeNull();
  });

  it('PERMISSIONS map covers all defined roles consistently', () => {
    for (const role of ROLES) {
      expect(PERMISSIONS).toHaveProperty(role);
    }
  });
});

describe('User Registration Endpoint (/api/auth/register) Access Control', () => {
  it('returns 401 Unauthorized when no session cookie is provided', async () => {
    const req = makeRequest('https://gara-g.swal.network/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'new@swal.network', password: 'password123', role: 'operator' }),
    });

    const res = await registerPost({ request: req } as any);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe('No autenticado');
  });

  it('returns 403 Forbidden when accessed by operator role', async () => {
    mockKv.get.mockResolvedValue(
      JSON.stringify({
        userId: 'usr_op',
        email: 'operator@swal.network',
        role: 'operator',
        instanceId: DEFAULT_INSTANCE_ID,
        exp: Date.now() + 60_000,
      }),
    );

    const req = makeRequest('https://gara-g.swal.network/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: 'session=valid-operator-token',
      },
      body: JSON.stringify({ email: 'new@swal.network', password: 'password123', role: 'observer' }),
    });

    const res = await registerPost({ request: req } as any);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('Solo administradores');
  });

  it('returns 403 Forbidden when accessed by observer role', async () => {
    mockKv.get.mockResolvedValue(
      JSON.stringify({
        userId: 'usr_obs',
        email: 'observer@swal.network',
        role: 'observer',
        instanceId: DEFAULT_INSTANCE_ID,
        exp: Date.now() + 60_000,
      }),
    );

    const req = makeRequest('https://gara-g.swal.network/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: 'session=valid-observer-token',
      },
      body: JSON.stringify({ email: 'new@swal.network', password: 'password123', role: 'observer' }),
    });

    const res = await registerPost({ request: req } as any);
    expect(res.status).toBe(403);
  });
});

describe('User Registration Endpoint Input Validation & Error Handling', () => {
  beforeEach(() => {
    mockKv.get.mockResolvedValue(
      JSON.stringify({
        userId: 'usr_admin',
        email: 'admin@swal.network',
        role: 'admin',
        instanceId: DEFAULT_INSTANCE_ID,
        exp: Date.now() + 60_000,
      }),
    );
  });

  it('returns 400 Bad Request when email or password is missing', async () => {
    const req = makeRequest('https://gara-g.swal.network/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: 'session=admin-token',
      },
      body: JSON.stringify({ email: 'test@swal.network', role: 'operator' }),
    });

    const res = await registerPost({ request: req } as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('email y password requeridos');
  });

  it('returns 400 Bad Request when role is invalid', async () => {
    const req = makeRequest('https://gara-g.swal.network/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: 'session=admin-token',
      },
      body: JSON.stringify({
        email: 'test@swal.network',
        password: 'password123',
        role: 'superuser',
      }),
    });

    const res = await registerPost({ request: req } as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('role inválido');
  });

  it('returns 400 Bad Request when password length is less than 6 characters', async () => {
    const req = makeRequest('https://gara-g.swal.network/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: 'session=admin-token',
      },
      body: JSON.stringify({
        email: 'test@swal.network',
        password: '123',
        role: 'operator',
      }),
    });

    const res = await registerPost({ request: req } as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('mínimo 6 caracteres');
  });

  it('returns 503 Service Unavailable when SWAL_D1 is missing', async () => {
    delete envMock.SWAL_D1;

    const req = makeRequest('https://gara-g.swal.network/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: 'session=admin-token',
      },
      body: JSON.stringify({
        email: 'valid@swal.network',
        password: 'securepassword',
        role: 'operator',
      }),
    });

    const res = await registerPost({ request: req } as any);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('D1 no disponible');
  });
});

describe('User Registration Duplicate Prevention & Tenant Persistence', () => {
  beforeEach(() => {
    mockKv.get.mockResolvedValue(
      JSON.stringify({
        userId: 'usr_admin',
        email: 'admin@swal.network',
        role: 'admin',
        instanceId: 'flota-tenant-101',
        exp: Date.now() + 60_000,
      }),
    );
  });

  it('returns 409 Conflict when attempting to register an existing email in the tenant', async () => {
    const mockD1 = createMockD1([
      {
        id: 'usr_existing',
        data: JSON.stringify({ email: 'dupe@swal.network', role: 'operator', active: true }),
      },
    ]);
    envMock.SWAL_D1 = mockD1;

    const req = makeRequest('https://gara-g.swal.network/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: 'session=admin-token',
      },
      body: JSON.stringify({
        email: 'dupe@swal.network',
        password: 'password123',
        role: 'operator',
      }),
    });

    const res = await registerPost({ request: req } as any);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe('Email ya registrado');
  });

  it('registers a new user successfully with hashed password under the session instanceId', async () => {
    const mockD1 = createMockD1([]);
    envMock.SWAL_D1 = mockD1;

    const req = makeRequest('https://gara-g.swal.network/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: 'session=admin-token',
      },
      body: JSON.stringify({
        email: 'newuser@swal.network',
        password: 'secretpassword',
        role: 'operator',
        active: true,
      }),
    });

    const res = await registerPost({ request: req } as any);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.email).toBe('newuser@swal.network');
    expect(body.role).toBe('operator');
    expect(body.userId).toMatch(/^usr_/);

    // Verify D1 prepared statement binding includes session instanceId
    expect(mockD1.prepare).toHaveBeenCalledWith(
      'INSERT INTO entity (instance_id, entity, id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    expect(mockD1.bindMock).toHaveBeenCalledWith(
      'flota-tenant-101',
      'user',
      body.userId,
      expect.stringContaining('newuser@swal.network'),
      expect.any(String),
      expect.any(String),
    );
  });
});
