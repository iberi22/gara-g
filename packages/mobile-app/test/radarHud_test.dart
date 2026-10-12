// ignore_for_file: file_names

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gara_g_pilot/src/services/radarService.dart';
import 'package:gara_g_pilot/src/widgets/radarHud.dart';

void main() {
  group('VirtualRadarNode Unit Tests', () {
    test('Calculates nodeColor correctly based on hazard flags and node type', () {
      final emergencyNode = VirtualRadarNode(
        id: 'node-1',
        name: 'Node 1',
        distanceMeters: 30.0,
        bearingDegrees: 45.0,
        hazardFlags: ['hazardAhead'],
      );
      expect(emergencyNode.nodeColor, equals(Colors.redAccent));

      final warningNode = VirtualRadarNode(
        id: 'node-2',
        name: 'Node 2',
        distanceMeters: 50.0,
        bearingDegrees: 120.0,
        hazardFlags: ['trafficJam'],
      );
      expect(warningNode.nodeColor, equals(Colors.orangeAccent));

      final sentinelNode = VirtualRadarNode(
        id: 'node-3',
        name: 'Sentinel 1',
        distanceMeters: 20.0,
        bearingDegrees: 180.0,
        nodeType: 'sentinel',
      );
      expect(sentinelNode.nodeColor, equals(Colors.cyanAccent));

      final connectedNode = VirtualRadarNode(
        id: 'node-4',
        name: 'Vehicle 1',
        distanceMeters: 40.0,
        bearingDegrees: 270.0,
        isConnected: true,
      );
      expect(connectedNode.nodeColor, equals(Colors.greenAccent));

      final disconnectedNode = VirtualRadarNode(
        id: 'node-5',
        name: 'Vehicle 2',
        distanceMeters: 80.0,
        bearingDegrees: 0.0,
        isConnected: false,
      );
      expect(disconnectedNode.nodeColor, equals(Colors.blueAccent));
    });

    test('JSON serialization and deserialization retains properties', () {
      final node = VirtualRadarNode(
        id: 'node-10',
        name: 'Test Vehicle',
        distanceMeters: 45.5,
        bearingDegrees: 90.0,
        nodeType: 'vehicle',
        hazardFlags: ['policeAhead', 'roadWork'],
        signalStrength: 0.85,
        isConnected: true,
        speedKmh: 65.0,
      );

      final jsonMap = node.toJson();
      final restoredNode = VirtualRadarNode.fromJson(jsonMap);

      expect(restoredNode.id, equals(node.id));
      expect(restoredNode.name, equals(node.name));
      expect(restoredNode.distanceMeters, equals(node.distanceMeters));
      expect(restoredNode.bearingDegrees, equals(node.bearingDegrees));
      expect(restoredNode.hazardFlags, equals(node.hazardFlags));
      expect(restoredNode.signalStrength, equals(node.signalStrength));
      expect(restoredNode.isConnected, equals(node.isConnected));
      expect(restoredNode.speedKmh, equals(node.speedKmh));
    });

    test('copyWith modifies specified fields', () {
      final initialNode = VirtualRadarNode(
        id: 'node-1',
        name: 'Initial',
        distanceMeters: 10.0,
        bearingDegrees: 0.0,
      );

      final updatedNode = initialNode.copyWith(
        distanceMeters: 25.0,
        hazardFlags: ['accidentAhead'],
      );

      expect(updatedNode.id, equals('node-1'));
      expect(updatedNode.name, equals('Initial'));
      expect(updatedNode.distanceMeters, equals(25.0));
      expect(updatedNode.hazardFlags, equals(['accidentAhead']));
    });
  });

  group('RadarService Unit Tests', () {
    late RadarService service;

    setUp(() {
      service = RadarService();
      service.clear();
    });

    test('Manages active nodes and scanning state correctly', () {
      expect(service.isScanning, isFalse);
      expect(service.activeNodes, isEmpty);

      service.startScanning();
      expect(service.isScanning, isTrue);
      expect(service.isYjsSynced, isTrue);

      final node = VirtualRadarNode(
        id: 'v1',
        name: 'Car A',
        distanceMeters: 15.0,
        bearingDegrees: 30.0,
      );

      service.addOrUpdateNode(node);
      expect(service.activeNodes.length, equals(1));
      expect(service.activeNodes.first.id, equals('v1'));

      service.updateNodeHazard('v1', ['hazardAhead']);
      expect(service.activeNodes.first.hazardFlags, equals(['hazardAhead']));

      service.removeNode('v1');
      expect(service.activeNodes, isEmpty);

      service.stopScanning();
      expect(service.isScanning, isFalse);
    });

    test('Serializes and applies Yjs CRDT payloads', () {
      final node = VirtualRadarNode(
        id: 'yjs-node-1',
        name: 'Mesh Vehicle',
        distanceMeters: 33.0,
        bearingDegrees: 150.0,
        hazardFlags: ['trafficJam'],
      );

      service.addOrUpdateNode(node);

      final yjsPayload = service.serializeYjsPayload();
      expect(yjsPayload['namespace'], equals('swal/gara-g/radar/nodes'));
      expect(yjsPayload['transport'], equals('NearbyConnections'));
      expect((yjsPayload['nodes'] as List).length, equals(1));

      final secondService = RadarService();
      secondService.clear();
      secondService.applyYjsUpdate(yjsPayload);

      expect(secondService.activeNodes.length, equals(1));
      expect(secondService.activeNodes.first.id, equals('yjs-node-1'));
      expect(secondService.activeNodes.first.hazardFlags, equals(['trafficJam']));
    });
  });

  group('RadarHud Widget Tests', () {
    testWidgets('Renders Radar HUD with virtual nodes, transport badge, and hazard bar', (WidgetTester tester) async {
      final testNodes = [
        VirtualRadarNode(
          id: 'hud-1',
          name: 'Alpha',
          distanceMeters: 20.0,
          bearingDegrees: 45.0,
          hazardFlags: ['hazardAhead'],
        ),
        VirtualRadarNode(
          id: 'hud-2',
          name: 'Beta',
          distanceMeters: 60.0,
          bearingDegrees: 180.0,
        ),
      ];

      VirtualRadarNode? tappedNode;

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SizedBox(
              width: 400,
              height: 400,
              child: RadarHud(
                nodes: testNodes,
                activeTransport: 'NearbyConnections',
                userHeading: 0.0,
                maxRangeMeters: 100.0,
                isSyncing: false,
                onNodeTap: (node) {
                  tappedNode = node;
                },
              ),
            ),
          ),
        ),
      );

      await tester.pump(const Duration(milliseconds: 100));

      expect(find.text('Radar HUD Virtual Nodes'), findsOneWidget);
      expect(find.text('NearbyConnections'), findsOneWidget);
      expect(find.text('Active Hazard Flags: 1'), findsOneWidget);
      expect(find.text('Nodes Nearby: 2'), findsOneWidget);

      // Verify node tap interaction
      final tapTarget = find.byType(GestureDetector).first;
      await tester.tap(tapTarget);
      await tester.pump();

      expect(tappedNode, isNotNull);
    });
  });
}
