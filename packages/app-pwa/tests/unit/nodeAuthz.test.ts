import { describe, it, expect, beforeEach } from 'vitest';
import { NodeIdentityManager } from '../../src/lib/nodeIdentity.js';
import { NodeAuthzManager, type NamespaceGrant } from '../../src/lib/nodeAuthz.js';

describe('Zero-Cloud Node Identity & P2P Delegation Authz', () => {
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

  it('should initialize Ed25519 identity without cloud dependencies', async () => {
    expect(ownerIdentity.getNodeId()).toMatch(/^node_[0-9a-f]{16}$/);
    expect(ownerIdentity.getPublicKeyHex().length).toBeGreaterThan(32);

    const message = 'offline-transaction-101';
    const signature = await ownerIdentity.sign(message);
    expect(signature).toBeDefined();

    const isValid = await NodeIdentityManager.verify(
      ownerIdentity.getPublicKeyHex(),
      signature,
      message,
    );
    expect(isValid).toBe(true);

    const isTamperedValid = await NodeIdentityManager.verify(
      ownerIdentity.getPublicKeyHex(),
      signature,
      'tampered-message',
    );
    expect(isTamperedValid).toBe(false);
  });

  it('should grant and verify granular namespace capabilities from owner to operator', async () => {
    const operatorNodeId = operatorIdentity.getNodeId();
    const operationalNamespace = 'gara-g/flota-10/operational';

    // 1. Owner grants 'write' capability to Operator for operational namespace
    const grant: NamespaceGrant = await authzManager.createGrant(
      ownerIdentity,
      operatorNodeId,
      operationalNamespace,
      'write',
      3600, // 1h
    );

    expect(grant.subjectNodeId).toBe(operatorNodeId);
    expect(grant.capability).toBe('write');
    expect(grant.signature).toBeDefined();

    // 2. Operator has 'write' on operational namespace
    const hasWrite = await authzManager.verifyPermission(
      operatorNodeId,
      operationalNamespace,
      'write',
      ownerIdentity.getPublicKeyHex(),
    );
    expect(hasWrite).toBe(true);

    // 3. Operator does NOT have 'admin' or 'read' on financial namespace
    const hasFinancial = await authzManager.verifyPermission(
      operatorNodeId,
      'gara-g/flota-10/financial',
      'read',
      ownerIdentity.getPublicKeyHex(),
    );
    expect(hasFinancial).toBe(false);
  });

  it('should filter restricted financial and ownership fields for operators', () => {
    const fullVehicleData = {
      id: 'veh-001',
      vin: '1HGCR2F83HA000101',
      make: 'Caterpillar',
      model: '320D',
      odometer: 14500,
      fuelLevel: 75.5,
      // Sensitive fields
      purchasePrice: 185000,
      leasingCost: 3500,
      ownerName: 'Transportes Mineros S.A.',
      ownerContact: 'contacto@transmin.com',
      contractId: 'CTR-2026-99',
    };

    // Operator view (without financial access)
    const operatorView = authzManager.filterRestrictedFields(fullVehicleData, false);
    expect(operatorView.odometer).toBe(14500);
    expect(operatorView.make).toBe('Caterpillar');
    expect((operatorView as any).purchasePrice).toBeUndefined();
    expect((operatorView as any).leasingCost).toBeUndefined();
    expect((operatorView as any).ownerName).toBeUndefined();

    // Owner view (with financial access)
    const ownerView = authzManager.filterRestrictedFields(fullVehicleData, true);
    expect((ownerView as any).purchasePrice).toBe(185000);
    expect((ownerView as any).ownerName).toBe('Transportes Mineros S.A.');
  });
});
