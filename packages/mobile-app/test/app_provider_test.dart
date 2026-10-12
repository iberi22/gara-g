import 'package:flutter_test/flutter_test.dart';
import 'package:gara_g_pilot/src/providers/appProvider.dart';

void main() {
  group('AppProvider Tests', () {
    late AppProvider appProvider;

    setUp(() {
      appProvider = AppProvider();
    });

    test('Initial default values', () {
      expect(appProvider.isProUser, false);
      expect(appProvider.nodeStatus, 'inactive');
      expect(appProvider.lastNodeHeartbeat, isNull);
      expect(appProvider.stripeBillingActive, false);
      expect(appProvider.isEdgeMeshConnected, false);
      expect(appProvider.isXavierConnected, false);
      expect(appProvider.isVaultInitialized, false);
    });

    test('Basic features unlocked for non-Pro users', () {
      expect(appProvider.isFeatureUnlocked('dashcam'), true);
      expect(appProvider.isFeatureUnlocked('telemetry'), true);
      expect(appProvider.isFeatureUnlocked('obd'), true);
      expect(appProvider.isFeatureUnlocked('wallet'), true);
      expect(appProvider.isFeatureUnlocked('v2v'), true);
    });

    test('Advanced features locked for non-Pro users', () {
      expect(appProvider.isFeatureUnlocked('fleet_management'), false);
      expect(appProvider.isFeatureUnlocked('marketplace_analytics'), false);
    });

    test('Pro status gating via node status and heartbeat', () {
      appProvider.updateNodeStatus(
        status: 'active',
        lastHeartbeat: DateTime.now(),
      );
      expect(appProvider.isProUser, true);
      expect(appProvider.isFeatureUnlocked('fleet_management'), true);

      // Heartbeat older than 60 seconds should deactivate Pro status
      appProvider.updateNodeStatus(
        status: 'active',
        lastHeartbeat: DateTime.now().subtract(const Duration(seconds: 65)),
      );
      expect(appProvider.isProUser, false);
    });

    test('Pro status gating via Stripe billing', () {
      appProvider.updateStripeBilling(active: true);
      expect(appProvider.isProUser, true);
      expect(appProvider.isFeatureUnlocked('marketplace_analytics'), true);

      appProvider.updateStripeBilling(active: false);
      expect(appProvider.isProUser, false);
    });

    test('EdgeMesh, Xavier, and Vault status updates', () {
      appProvider.setEdgeMeshStatus(connected: true, nodeId: 'node-123');
      expect(appProvider.isEdgeMeshConnected, true);
      expect(appProvider.edgeMeshNodeId, 'node-123');

      appProvider.setXavierStatus(connected: true, endpoint: 'http://localhost:8006');
      expect(appProvider.isXavierConnected, true);
      expect(appProvider.xavierEndpoint, 'http://localhost:8006');

      appProvider.setVaultStatus(initialized: true, recordCount: 42);
      expect(appProvider.isVaultInitialized, true);
      expect(appProvider.vaultRecordCount, 42);
    });
  });
}
