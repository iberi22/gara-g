import { describe, test, expect, beforeEach } from 'vitest';
import {
  AlertKind,
  AlertSeverity,
  unreadCount,
  acknowledge,
  YjsAlertManager,
  type Alert,
} from './alert.js';

describe('Alert Library Unit Tests', () => {
  const sampleAlerts: Alert[] = [
    {
      id: 'alert_01',
      instanceId: 'inst_test',
      vehicleId: 'veh_101',
      fleetId: 'fleet_01',
      kind: AlertKind.OVERSPEED,
      severity: AlertSeverity.WARN,
      message: 'Vehicle exceeded speed limit 80mph',
      acknowledged: false,
      createdAt: 1700000000000,
    },
    {
      id: 'alert_02',
      instanceId: 'inst_test',
      vehicleId: 'veh_102',
      fleetId: 'fleet_01',
      kind: AlertKind.GEOFENCE_EXIT,
      severity: AlertSeverity.WARN,
      message: 'Vehicle exited perimeter',
      acknowledged: true,
      createdAt: 1700000001000,
      ackedAt: 1700000002000,
    },
    {
      id: 'alert_03',
      instanceId: 'inst_test',
      vehicleId: 'veh_101',
      fleetId: 'fleet_01',
      kind: AlertKind.TAMPER,
      severity: AlertSeverity.DANGER,
      message: 'OBD-II hardware tamper detected',
      acknowledged: false,
      createdAt: 1700000003000,
    },
    {
      id: 'alert_04',
      instanceId: 'inst_test',
      vehicleId: 'veh_103',
      fleetId: 'fleet_02',
      kind: AlertKind.DRIVER_HOS,
      severity: AlertSeverity.CRITICAL,
      message: 'Driver HOS violation imminent',
      acknowledged: false,
      createdAt: 1700000004000,
    },
  ];

  test('unreadCount pure function returns correct unacknowledged alert count', () => {
    const count = unreadCount(sampleAlerts);
    expect(count).toBe(3);

    expect(unreadCount([])).toBe(0);

    const allAcked = sampleAlerts.map((a) => ({ ...a, acknowledged: true }));
    expect(unreadCount(allAcked)).toBe(0);
  });

  test('acknowledge pure function creates immutable copy with acknowledged true and ackedAt date', () => {
    const original = sampleAlerts[0];
    const acked = acknowledge(original);

    // Verify original alert remains unchanged
    expect(original.acknowledged).toBe(false);
    expect(original.ackedAt).toBeUndefined();

    // Verify copy features updated attributes
    expect(acked.id).toBe(original.id);
    expect(acked.acknowledged).toBe(true);
    expect(acked.ackedAt).toBeInstanceOf(Date);
  });

  test('severity sorting and filtering works deterministically', () => {
    const severityWeights: Record<string, number> = {
      [AlertSeverity.INFO]: 1,
      [AlertSeverity.WARN]: 2,
      [AlertSeverity.CRITICAL]: 3,
      [AlertSeverity.DANGER]: 4,
    };

    const sorted = [...sampleAlerts].sort(
      (a, b) => (severityWeights[b.severity] || 0) - (severityWeights[a.severity] || 0)
    );

    expect(sorted[0].severity).toBe(AlertSeverity.DANGER);
    expect(sorted[1].severity).toBe(AlertSeverity.CRITICAL);
    expect(sorted[2].severity).toBe(AlertSeverity.WARN);

    const criticalAndDanger = sampleAlerts.filter(
      (a) => a.severity === AlertSeverity.CRITICAL || a.severity === AlertSeverity.DANGER
    );
    expect(criticalAndDanger.length).toBe(2);
  });

  test('YjsAlertManager CRDT doc state management and subscription', () => {
    const manager = new YjsAlertManager('test_inst');

    let notifyCount = 0;
    const unsub = manager.subscribe(() => {
      notifyCount++;
    });

    const created = manager.addAlert({
      id: 'alert_yjs_01',
      instanceId: 'test_inst',
      vehicleId: 'veh_99',
      fleetId: 'fleet_99',
      kind: AlertKind.LOW_BATTERY,
      severity: AlertSeverity.CRITICAL,
      message: 'Aux battery voltage below 11.8V',
    });

    expect(created.id).toBe('alert_yjs_01');
    expect(created.acknowledged).toBe(false);
    expect(manager.listAlerts().length).toBe(1);
    expect(notifyCount).toBe(1);

    const acked = manager.acknowledgeAlert('alert_yjs_01');
    expect(acked?.acknowledged).toBe(true);
    expect(notifyCount).toBe(2);

    unsub();
  });
});
