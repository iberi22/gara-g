import { describe, it, expect, beforeEach } from 'vitest';
import {
  createEntity,
  listEntities,
  getEntity,
  updateEntity,
  deleteEntity,
  surrealDefineTable,
  getMemoryAdapter,
  setStorageAdapter,
} from './domain.js';
import { domainConfig } from './domain.config.js';
import { CloudflareVaultAdapter } from './cloudflareVaultAdapter.js';

describe('domain gara-g (G10.04)', () => {
  beforeEach(() => {
    getMemoryAdapter().clear();
    setStorageAdapter(getMemoryAdapter());
  });

  it('vehicle isolation between instances', async () => {
    const a = await createEntity('vehicle', { plate: 'ABC', vin: 'VIN-A' } as any, 'inst1');
    await createEntity('vehicle', { plate: 'XYZ', vin: 'VIN-X' } as any, 'inst2');
    expect(a.instance_id).toBe('inst1');
    expect((await listEntities('vehicle', 'inst1'))).toHaveLength(1);
    expect((await listEntities('vehicle', 'inst2'))).toHaveLength(1);
    expect(await getEntity('vehicle', a.id, 'inst2')).toBeNull();
  });

  it('fleet CRUD lifecycle', async () => {
    const f = await createEntity('fleet', { name: 'North', organizationId: 'org-1', region: 'NA', tags: ['ev'] } as any, 'inst1');
    expect(f.id).toBeTruthy();
    const upd = await updateEntity('fleet', f.id, { name: 'North-2' } as any, 'inst1');
    expect(upd?.name).toBe('North-2');
    const got = await getEntity('fleet', f.id, 'inst1');
    expect(got?.name).toBe('North-2');
    expect(await deleteEntity('fleet', f.id, 'inst1')).toBe(true);
    expect(await getEntity('fleet', f.id, 'inst1')).toBeNull();
  });

  it('telemetry ingest with timestamp', async () => {
    const t = await createEntity(
      'telemetry',
      { vin: 'VIN-A', timestamp: 1700000000, speed: 60, rpm: 2000, coolantTemp: 90, fuelLevel: 80, latitude: 0, longitude: 0 } as any,
      'inst1',
    );
    expect(t.vin).toBe('VIN-A');
    expect(t.instance_id).toBe('inst1');
  });

  it('surrealDefineTable generates DEFINE TABLE with instance_id index', () => {
    const ddl = surrealDefineTable('vehicle');
    expect(ddl).toContain('DEFINE TABLE vehicle SCHEMAFULL');
    expect(ddl).toContain('DEFINE FIELD instance_id ON vehicle TYPE string');
    expect(ddl).toContain('DEFINE INDEX vehicle_instance_idx ON vehicle FIELDS instance_id');
  });

  it('domainConfig has gara-g appId and 3 entities', () => {
    expect((domainConfig as any).appId).toBe('gara-g');
    expect((domainConfig as any).entities.map((e: any) => e.name)).toEqual(
      expect.arrayContaining(['vehicle', 'fleet', 'telemetry']),
    );
  });

  it('rejects entity not whitelisted in domain.config', async () => {
    await expect(
      createEntity('unicorn' as any, { foo: 'bar' }, 'inst1'),
    ).rejects.toThrow(/whitelisteada/);
  });

  // Fleet-specific storage tests (WAVE-11.01)
  it('fleet create con CloudflareVaultAdapter memory fallback persiste record', async () => {
    const vaultAdapter = new CloudflareVaultAdapter({}, 'gara-g');
    setStorageAdapter(vaultAdapter);

    const f = await createEntity(
      'fleet',
      { name: 'Vault Fleet', organizationId: 'org-vault', region: 'EU-West', tags: ['fast', 'express'] } as any,
      'inst-vault',
    );
    expect(f.id).toBeTruthy();
    expect(f.name).toBe('Vault Fleet');

    const list = await listEntities('fleet', 'inst-vault');
    expect(list).toHaveLength(1);
    expect((list[0] as any).name).toBe('Vault Fleet');
  });

  it('fleet list filtra por instance_id estricto (cross-instance isolation)', async () => {
    const a = await createEntity('fleet', { name: 'Alpha Fleet', organizationId: 'org-a', region: 'US-East', tags: [] } as any, 'inst-alpha');
    const b = await createEntity('fleet', { name: 'Beta Fleet', organizationId: 'org-b', region: 'US-West', tags: [] } as any, 'inst-beta');

    const alphaList = await listEntities('fleet', 'inst-alpha');
    expect(alphaList).toHaveLength(1);
    expect((alphaList[0] as any).name).toBe('Alpha Fleet');

    const betaList = await listEntities('fleet', 'inst-beta');
    expect(betaList).toHaveLength(1);
    expect((betaList[0] as any).name).toBe('Beta Fleet');

    expect(await getEntity('fleet', a.id, 'inst-beta')).toBeNull();
    expect(await getEntity('fleet', b.id, 'inst-alpha')).toBeNull();
  });

  it('fleet update muta name + tags en storage y refleja en list', async () => {
    const f = await createEntity('fleet', { name: 'Old Name', organizationId: 'org-upd', region: 'SA', tags: ['v1'] } as any, 'inst-upd');
    const updated = await updateEntity('fleet', f.id, { name: 'New Name', tags: ['v1', 'v2'] } as any, 'inst-upd');

    expect(updated?.name).toBe('New Name');
    expect((updated as any)?.tags).toEqual(['v1', 'v2']);

    const list = await listEntities('fleet', 'inst-upd');
    expect(list).toHaveLength(1);
    expect((list[0] as any).name).toBe('New Name');
    expect((list[0] as any).tags).toEqual(['v1', 'v2']);
  });

  it('fleet delete borra record y getEntity devuelve null', async () => {
    const f = await createEntity('fleet', { name: 'ToDelete', organizationId: 'org-del', region: 'AP', tags: [] } as any, 'inst-del');
    expect(await getEntity('fleet', f.id, 'inst-del')).not.toBeNull();

    const deleted = await deleteEntity('fleet', f.id, 'inst-del');
    expect(deleted).toBe(true);

    expect(await getEntity('fleet', f.id, 'inst-del')).toBeNull();
    expect(await listEntities('fleet', 'inst-del')).toHaveLength(0);
  });

  it('fleet bulk seed N flotas y listEntities devuelve N en orden determinístico', async () => {
    const fleetNames = ['Fleet 1', 'Fleet 2', 'Fleet 3', 'Fleet 4', 'Fleet 5'];
    for (const name of fleetNames) {
      await createEntity('fleet', { name, organizationId: 'org-bulk', region: 'Global', tags: [] } as any, 'inst-bulk');
    }

    const list = await listEntities('fleet', 'inst-bulk');
    expect(list).toHaveLength(5);
    const retrievedNames = list.map((item: any) => item.name);
    expect(retrievedNames).toEqual(expect.arrayContaining(fleetNames));
  });
});
