import { describe, it, expect, beforeEach } from 'vitest';
import { NodeIdentityManager } from '../../src/lib/nodeIdentity.js';
import { NodeAuthzManager, type NamespaceGrant, type Capability } from '../../src/lib/nodeAuthz.js';

describe('NodeAuthzManager Coverage Test Suite', () => {
  let ownerIdentity: NodeIdentityManager;
  let operatorIdentity: NodeIdentityManager;
  let authzManager: NodeAuthzManager;

  beforeEach(async () => {
    ownerIdentity = new NodeIdentityManager();
    await ownerIdentity.init();

    operatorIdentity = new NodeIdentityManager();
    await operatorIdentity.init();

    authzManager = new NodeAuthzManager();
  });

  it('should auto-purge and reject expired grants (Date.now() > expiresAt)', async () => {
    const subjectId = operatorIdentity.getNodeId();
    const ns = 'gara-g/flota-1/operational';

    // Create grant with negative TTL (-10 seconds -> already expired)
    const expiredGrant = await authzManager.createGrant(
      ownerIdentity,
      subjectId,
      ns,
      'read',
      -10,
    );

    expect(expiredGrant.expiresAt).toBeLessThan(Date.now());

    // verifyPermission should return false and purge the grant
    const hasPerm = await authzManager.verifyPermission(
      subjectId,
      ns,
      'read',
      ownerIdentity.getPublicKeyHex(),
    );
    expect(hasPerm).toBe(false);

    // Verify it was purged from internal list
    const grantsForSubject = authzManager.listGrantsForSubject(subjectId);
    expect(grantsForSubject).toHaveLength(0);

    // Second check without public key should also return false
    const hasPerm2 = await authzManager.verifyPermission(subjectId, ns, 'read');
    expect(hasPerm2).toBe(false);
  });

  it('should authorize read, write, and sync when subject has admin capability hierarchy', async () => {
    const subjectId = operatorIdentity.getNodeId();
    const ns = 'gara-g/flota-2/operational';

    // Grant 'admin' capability
    await authzManager.createGrant(ownerIdentity, subjectId, ns, 'admin', 3600);

    // Verify admin grants 'read'
    const canRead = await authzManager.verifyPermission(
      subjectId,
      ns,
      'read',
      ownerIdentity.getPublicKeyHex(),
    );
    expect(canRead).toBe(true);

    // Verify admin grants 'write'
    const canWrite = await authzManager.verifyPermission(
      subjectId,
      ns,
      'write',
      ownerIdentity.getPublicKeyHex(),
    );
    expect(canWrite).toBe(true);

    // Verify admin grants 'sync'
    const canSync = await authzManager.verifyPermission(
      subjectId,
      ns,
      'sync',
      ownerIdentity.getPublicKeyHex(),
    );
    expect(canSync).toBe(true);

    // Verify admin grants 'admin'
    const canAdmin = await authzManager.verifyPermission(
      subjectId,
      ns,
      'admin',
      ownerIdentity.getPublicKeyHex(),
    );
    expect(canAdmin).toBe(true);
  });

  it('should list grants specifically for a target subject', async () => {
    const subject1 = operatorIdentity.getNodeId();
    const subject2 = 'node_subject_2_99999999';

    await authzManager.createGrant(ownerIdentity, subject1, 'gara-g/flota-3/op', 'read');
    await authzManager.createGrant(ownerIdentity, subject1, 'gara-g/flota-3/sec', 'write');
    await authzManager.createGrant(ownerIdentity, subject2, 'gara-g/flota-3/op', 'admin');

    const grants1 = authzManager.listGrantsForSubject(subject1);
    expect(grants1).toHaveLength(2);
    expect(grants1.map((g) => g.namespace)).toContain('gara-g/flota-3/op');
    expect(grants1.map((g) => g.namespace)).toContain('gara-g/flota-3/sec');

    const grants2 = authzManager.listGrantsForSubject(subject2);
    expect(grants2).toHaveLength(1);
    expect(grants2[0].namespace).toBe('gara-g/flota-3/op');
    expect(grants2[0].capability).toBe('admin');

    const grantsUnknown = authzManager.listGrantsForSubject('node_unknown_00000000');
    expect(grantsUnknown).toEqual([]);
  });

  it('should reject tampered grants when verifying signature (tamper resistance)', async () => {
    const subjectId = operatorIdentity.getNodeId();
    const nsOriginal = 'gara-g/flota-4/operational';
    const nsTampered = 'gara-g/flota-4/financial';

    const grant = await authzManager.createGrant(
      ownerIdentity,
      subjectId,
      nsOriginal,
      'read',
      3600,
    );

    // 1. Verify valid grant
    const isValidOriginal = await authzManager.verifyPermission(
      subjectId,
      nsOriginal,
      'read',
      ownerIdentity.getPublicKeyHex(),
    );
    expect(isValidOriginal).toBe(true);

    // 2. Tamper namespace: change namespace to 'financial' but keep signature
    const tamperedGrantNs: NamespaceGrant = {
      ...grant,
      namespace: nsTampered,
    };
    authzManager.registerGrant(tamperedGrantNs);

    const isTamperedNsValid = await authzManager.verifyPermission(
      subjectId,
      nsTampered,
      'read',
      ownerIdentity.getPublicKeyHex(),
    );
    expect(isTamperedNsValid).toBe(false);

    // 3. Tamper capability: change capability to 'admin'
    const tamperedGrantCap: NamespaceGrant = {
      ...grant,
      capability: 'admin',
    };
    authzManager.registerGrant(tamperedGrantCap);

    const isTamperedCapValid = await authzManager.verifyPermission(
      subjectId,
      nsOriginal,
      'admin',
      ownerIdentity.getPublicKeyHex(),
    );
    expect(isTamperedCapValid).toBe(false);

    // 4. Tamper expiration date
    const tamperedGrantExp: NamespaceGrant = {
      ...grant,
      expiresAt: grant.expiresAt + 86400000,
    };
    authzManager.registerGrant(tamperedGrantExp);

    const isTamperedExpValid = await authzManager.verifyPermission(
      subjectId,
      nsOriginal,
      'read',
      ownerIdentity.getPublicKeyHex(),
    );
    expect(isTamperedExpValid).toBe(false);
  });

  it('should handle deep field filtering edge cases (all restricted keys, nested objects, arrays, clean objects)', () => {
    // 1. Full data with all restricted keys
    const fullData = {
      id: 'v-100',
      vin: '1234567890ABCDEFG',
      purchasePrice: 50000,
      leasingCost: 1200,
      ownerName: 'Alice',
      ownerContact: 'alice@example.com',
      insuranceCost: 800,
      contractId: 'CT-99',
      taxValue: 15000,
      metadata: {
        location: 'Site A',
        activeDrivers: ['Bob', 'Charlie'],
      },
      tags: ['heavy', 'electric'],
    };

    // Filtered without financial access (hasFinancialAccess = false)
    const filtered = authzManager.filterRestrictedFields(fullData, false);

    expect(filtered.id).toBe('v-100');
    expect(filtered.vin).toBe('1234567890ABCDEFG');
    expect(filtered.metadata).toEqual({ location: 'Site A', activeDrivers: ['Bob', 'Charlie'] });
    expect(filtered.tags).toEqual(['heavy', 'electric']);

    // Check all restricted keys are absent
    expect((filtered as any).purchasePrice).toBeUndefined();
    expect((filtered as any).leasingCost).toBeUndefined();
    expect((filtered as any).ownerName).toBeUndefined();
    expect((filtered as any).ownerContact).toBeUndefined();
    expect((filtered as any).insuranceCost).toBeUndefined();
    expect((filtered as any).contractId).toBeUndefined();
    expect((filtered as any).taxValue).toBeUndefined();

    // 2. Object with ONLY restricted keys
    const onlyRestricted = {
      purchasePrice: 100,
      leasingCost: 200,
      ownerName: 'Bob',
    };
    const filteredOnlyRestricted = authzManager.filterRestrictedFields(onlyRestricted, false);
    expect(filteredOnlyRestricted).toEqual({});

    // 3. Object with NO restricted keys
    const cleanData = {
      id: 'v-200',
      status: 'active',
      speed: 45.2,
    };
    const filteredClean = authzManager.filterRestrictedFields(cleanData, false);
    expect(filteredClean).toEqual(cleanData);

    // 4. When hasFinancialAccess = true
    const withAccess = authzManager.filterRestrictedFields(fullData, true);
    expect(withAccess).toEqual(fullData);
    expect((withAccess as any).purchasePrice).toBe(50000);
    expect((withAccess as any).ownerContact).toBe('alice@example.com');
  });
});
