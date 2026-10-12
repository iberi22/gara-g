import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:gara_g_pilot/src/services/xavierService.dart';

void main() {
  group('XavierService Mobile Tests', () {
    late XavierService service;

    setUp(() {
      service = XavierService();
      service.setInstanceId('mobile-test-instance');
      service.setEndpoint('http://localhost:8006');
    });

    test('formats canonical namespace with app/gara-g/instance/\$instanceId', () {
      expect(service.getNamespace(), 'app/gara-g/instance/mobile-test-instance');
      expect(service.getNamespace('custom-inst-456'), 'app/gara-g/instance/custom-inst-456');
    });

    test('manages instanceId correctly', () {
      service.setInstanceId('new-mobile-id');
      expect(service.instanceId, 'new-mobile-id');
      expect(service.getNamespace(), 'app/gara-g/instance/new-mobile-id');
    });

    test('probes Xavier health status successfully when online', () async {
      final mockClient = MockClient((request) async {
        if (request.url.path == '/health') {
          return http.Response(jsonEncode({'status': 'ok', 'version': '1.0.0'}), 200);
        }
        return http.Response('Not Found', 404);
      });

      final health = await service.probeXavierHealth(
        endpoint: 'http://localhost:8006',
        client: mockClient,
      );

      expect(health.alive, isTrue);
      expect(health.endpoint, 'http://localhost:8006');
      expect(health.status, 'ok');
      expect(health.version, '1.0.0');
    });

    test('probes Xavier health status correctly when node is offline', () async {
      final mockClient = MockClient((request) async {
        throw Exception('Network unreachable');
      });

      final health = await service.probeXavierHealth(
        endpoint: 'http://localhost:8006',
        client: mockClient,
      );

      expect(health.alive, isFalse);
      expect(health.status, contains('Network unreachable'));
    });

    test('applies 60s heartbeat to Xavier node', () async {
      late String sentBody;
      final mockClient = MockClient((request) async {
        if (request.url.path == '/heartbeat') {
          sentBody = request.body;
          return http.Response(jsonEncode({'acknowledged': true}), 200);
        }
        return http.Response('Error', 500);
      });

      final result = await service.applyHeartbeat(
        endpoint: 'http://localhost:8006',
        client: mockClient,
      );

      expect(result.success, isTrue);
      expect(result.endpoint, 'http://localhost:8006');
      expect(sentBody, contains('app/gara-g/instance/mobile-test-instance'));
      expect(sentBody, contains('"heartbeatIntervalSec":60'));
    });

    test('saves local memory entries and synchronizes with xavier-memory-node', () async {
      service.setInstanceId('sync-mobile-instance');
      final record = service.saveMemoryEntry('vehicle_diagnostics', {'rpm': 2500, 'temp': 90});

      expect(record.key, 'vehicle_diagnostics');
      expect(record.namespace, 'app/gara-g/instance/sync-mobile-instance');
      expect(record.synced, isFalse);

      final entries = service.getMemoryEntries('sync-mobile-instance');
      expect(entries.length, 1);

      final mockClient = MockClient((request) async {
        if (request.url.path == '/health') {
          return http.Response(jsonEncode({'status': 'ok'}), 200);
        }
        if (request.url.path == '/memory/sync') {
          return http.Response(jsonEncode({'success': true}), 200);
        }
        return http.Response('Error', 500);
      });

      final syncResult = await service.syncMemoryNode(
        endpoint: 'http://localhost:8006',
        client: mockClient,
      );

      expect(syncResult.isOnline, isTrue);
      expect(syncResult.unsyncedCount, 0);

      final syncedRecord = service.getMemoryEntries('sync-mobile-instance').first;
      expect(syncedRecord.synced, isTrue);
    });
  });
}
