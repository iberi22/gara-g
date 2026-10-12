import test, { describe, it } from 'node:test';
import assert from 'node:assert';
import { isProEnabled, canAccessAdvancedFleet, canAccessAdvancedMarketplace, type SwalNodeStatus } from '../src/lib/nodeGate.js';
import { isSocioActivo, canAccessCloudBackup, type SocioBillingInfo } from '../src/lib/socioGate.js';

describe('Node Gate (isProEnabled)', () => {
  const now = 1700000000000;

  it('returns true when node is active and heartbeat is within 60s', () => {
    const node: SwalNodeStatus = {
      nodeId: 'node-1',
      status: 'active',
      lastHeartbeat: now - 30000
    };

    assert.strictEqual(isProEnabled(node, now), true);
    assert.strictEqual(canAccessAdvancedFleet(node, now), true);
    assert.strictEqual(canAccessAdvancedMarketplace(node, now), true);
  });

  it('returns false when node heartbeat is older than 60s', () => {
    const node: SwalNodeStatus = {
      nodeId: 'node-2',
      status: 'active',
      lastHeartbeat: now - 65000
    };

    assert.strictEqual(isProEnabled(node, now), false);
  });

  it('handles unix timestamp in seconds for lastHeartbeat', () => {
    const node: SwalNodeStatus = {
      nodeId: 'node-3',
      status: 'active',
      lastHeartbeat: (now - 20000) / 1000
    };

    assert.strictEqual(isProEnabled(node, now), true);
  });

  it('returns false when node status is not active', () => {
    const node: SwalNodeStatus = {
      nodeId: 'node-4',
      status: 'inactive',
      lastHeartbeat: now - 10000
    };

    assert.strictEqual(isProEnabled(node, now), false);
  });

  it('returns false when node is null or undefined', () => {
    assert.strictEqual(isProEnabled(null, now), false);
    assert.strictEqual(isProEnabled(undefined, now), false);
  });
});

describe('Socio Gate (isSocioActivo)', () => {
  it('returns true when Stripe billing status is active', () => {
    const billing: SocioBillingInfo = {
      customerId: 'cus_123',
      status: 'active',
      planTier: 'socio_infra'
    };

    assert.strictEqual(isSocioActivo(billing), true);
    assert.strictEqual(canAccessCloudBackup(billing), true);
  });

  it('returns false when Stripe billing status is canceled or past_due', () => {
    const canceledBilling: SocioBillingInfo = {
      customerId: 'cus_124',
      status: 'canceled'
    };
    const pastDueBilling: SocioBillingInfo = {
      customerId: 'cus_125',
      status: 'past_due'
    };

    assert.strictEqual(isSocioActivo(canceledBilling), false);
    assert.strictEqual(isSocioActivo(pastDueBilling), false);
  });

  it('returns false when billing is null or undefined', () => {
    assert.strictEqual(isSocioActivo(null), false);
    assert.strictEqual(isSocioActivo(undefined), false);
  });
});
