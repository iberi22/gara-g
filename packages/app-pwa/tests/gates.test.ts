import { describe, it, expect } from 'vitest';
import { isProEnabled, canAccessAdvancedFleet, canAccessAdvancedMarketplace, type SwalNodeStatus } from '../src/lib/nodeGate';
import { isSocioActivo, canAccessCloudBackup, type SocioBillingInfo } from '../src/lib/socioGate';

describe('Node Gate (isProEnabled)', () => {
  const now = 1700000000000; // Fixed timestamp for test reproducibility

  it('returns true when node is active and heartbeat is within 60s', () => {
    const node: SwalNodeStatus = {
      nodeId: 'node-1',
      status: 'active',
      lastHeartbeat: now - 30000 // 30s ago
    };

    expect(isProEnabled(node, now)).toBe(true);
    expect(canAccessAdvancedFleet(node, now)).toBe(true);
    expect(canAccessAdvancedMarketplace(node, now)).toBe(true);
  });

  it('returns false when node heartbeat is older than 60s', () => {
    const node: SwalNodeStatus = {
      nodeId: 'node-2',
      status: 'active',
      lastHeartbeat: now - 65000 // 65s ago
    };

    expect(isProEnabled(node, now)).toBe(false);
  });

  it('handles unix timestamp in seconds for lastHeartbeat', () => {
    const node: SwalNodeStatus = {
      nodeId: 'node-3',
      status: 'active',
      lastHeartbeat: (now - 20000) / 1000 // 20s ago in seconds
    };

    expect(isProEnabled(node, now)).toBe(true);
  });

  it('returns false when node status is not active', () => {
    const node: SwalNodeStatus = {
      nodeId: 'node-4',
      status: 'inactive',
      lastHeartbeat: now - 10000
    };

    expect(isProEnabled(node, now)).toBe(false);
  });

  it('returns false when node is null or undefined', () => {
    expect(isProEnabled(null, now)).toBe(false);
    expect(isProEnabled(undefined, now)).toBe(false);
  });
});

describe('Socio Gate (isSocioActivo)', () => {
  it('returns true when Stripe billing status is active', () => {
    const billing: SocioBillingInfo = {
      customerId: 'cus_123',
      status: 'active',
      planTier: 'socio_infra'
    };

    expect(isSocioActivo(billing)).toBe(true);
    expect(canAccessCloudBackup(billing)).toBe(true);
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

    expect(isSocioActivo(canceledBilling)).toBe(false);
    expect(isSocioActivo(pastDueBilling)).toBe(false);
  });

  it('returns false when billing is null or undefined', () => {
    expect(isSocioActivo(null)).toBe(false);
    expect(isSocioActivo(undefined)).toBe(false);
  });
});
