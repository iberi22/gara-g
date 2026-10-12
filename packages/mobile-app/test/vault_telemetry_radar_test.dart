import 'dart:typed_data';
import 'package:flutter_test/flutter_test.dart';
import 'package:mockito/mockito.dart';
import 'package:gara_g_pilot/src/services/vaultService.dart';
import 'package:gara_g_pilot/src/providers/telemetry_provider.dart';
import 'package:gara_g_pilot/src/services/radarService.dart';
import 'package:gara_g_pilot/src/services/adas_service.dart';
import 'package:gara_g_pilot/src/services/dms_service.dart';
import 'package:gara_g_pilot/src/services/seatbelt_service.dart' as sb;

import 'helpers/mocks.mocks.dart';

void main() {
  group('Vault, Telemetry, Radar, ADAS & DMS Suite', () {
    late MockVaultService mockVaultService;
    late MockTelemetryProvider mockTelemetryProvider;
    late MockRadarService mockRadarService;
    late MockAdasService mockAdasService;
    late MockDmsService mockDmsService;

    setUp(() {
      mockVaultService = MockVaultService();
      mockTelemetryProvider = MockTelemetryProvider();
      mockRadarService = MockRadarService();
      mockAdasService = MockAdasService();
      mockDmsService = MockDmsService();
    });

    test('VaultService: connectVault returns true and connects delegated vault', () async {
      when(mockVaultService.connectVault()).thenAnswer((_) async => true);
      when(mockVaultService.isConnected).thenReturn(true);
      when(mockVaultService.vaultAddress).thenReturn('11111111111111111111111111111111');

      final connected = await mockVaultService.connectVault();
      expect(connected, isTrue);
      expect(mockVaultService.isConnected, isTrue);
      expect(mockVaultService.vaultAddress, equals('11111111111111111111111111111111'));
      verify(mockVaultService.connectVault()).called(1);
    });

    test('VaultService: disconnectVault clears address and sets isConnected false', () async {
      when(mockVaultService.disconnectVault()).thenAnswer((_) async {});
      when(mockVaultService.isConnected).thenReturn(false);
      when(mockVaultService.vaultAddress).thenReturn(null);

      await mockVaultService.disconnectVault();
      expect(mockVaultService.isConnected, isFalse);
      expect(mockVaultService.vaultAddress, isNull);
      verify(mockVaultService.disconnectVault()).called(1);
    });

    test('VaultService: requestSignature delegates payload signing to swal-vault', () async {
      const payload = 'telemetry_chunk_hash_999';
      const expectedSig = '0x_delegated_signature_from_swal_vault_123';
      when(mockVaultService.requestSignature(payload)).thenAnswer((_) async => expectedSig);

      final sig = await mockVaultService.requestSignature(payload);
      expect(sig, equals(expectedSig));
      verify(mockVaultService.requestSignature(payload)).called(1);
    });

    test('TelemetryProvider: reports background monitoring state', () {
      when(mockTelemetryProvider.isMonitoring).thenReturn(true);
      expect(mockTelemetryProvider.isMonitoring, isTrue);
    });

    test('TelemetryProvider: exposes telemetry speed and rpm metrics', () {
      when(mockTelemetryProvider.currentSpeed).thenReturn(65.4);
      when(mockTelemetryProvider.currentRpm).thenReturn(2500.0);
      when(mockTelemetryProvider.currentLatitude).thenReturn(37.7749);
      when(mockTelemetryProvider.currentLongitude).thenReturn(-122.4194);

      expect(mockTelemetryProvider.currentSpeed, equals(65.4));
      expect(mockTelemetryProvider.currentRpm, equals(2500.0));
      expect(mockTelemetryProvider.currentLatitude, equals(37.7749));
      expect(mockTelemetryProvider.currentLongitude, equals(-122.4194));
    });

    test('TelemetryProvider: startTelemetryMonitoring and stopTelemetryMonitoring', () async {
      when(mockTelemetryProvider.startTelemetryMonitoring(walletAddress: anyNamed('walletAddress')))
          .thenAnswer((_) async {});
      when(mockTelemetryProvider.stopTelemetryMonitoring(walletAddress: anyNamed('walletAddress')))
          .thenAnswer((_) async {});

      await mockTelemetryProvider.startTelemetryMonitoring(walletAddress: '0xWallet');
      verify(mockTelemetryProvider.startTelemetryMonitoring(walletAddress: '0xWallet')).called(1);

      await mockTelemetryProvider.stopTelemetryMonitoring(walletAddress: '0xWallet');
      verify(mockTelemetryProvider.stopTelemetryMonitoring(walletAddress: '0xWallet')).called(1);
    });

    test('RadarService: virtual node lifecycle management', () {
      final node = VirtualRadarNode(
        id: 'node_01',
        name: 'GARA Sentinel Alpha',
        distanceMeters: 15.2,
        bearingDegrees: 45.0,
        hazardFlags: ['trafficJam'],
      );

      when(mockRadarService.activeNodes).thenReturn([node]);
      expect(mockRadarService.activeNodes.length, equals(1));
      expect(mockRadarService.activeNodes.first.id, equals('node_01'));
      expect(mockRadarService.activeNodes.first.nodeColor, isNotNull);
    });

    test('RadarService: serializes and handles Yjs CRDT payload', () {
      final yjsMap = {
        'namespace': 'swal/gara-g/radar/nodes',
        'transport': 'NearbyConnections',
        'timestamp': 1700000000000,
        'nodes': [],
      };
      when(mockRadarService.serializeYjsPayload()).thenReturn(yjsMap);
      when(mockRadarService.encodeYjsPayload()).thenReturn('{"namespace":"swal/gara-g/radar/nodes"}');

      expect(mockRadarService.serializeYjsPayload(), containsPair('transport', 'NearbyConnections'));
      expect(mockRadarService.encodeYjsPayload(), contains('swal/gara-g/radar/nodes'));
    });

    test('RadarService: scanning and Yjs sync status toggling', () {
      when(mockRadarService.isScanning).thenReturn(true);
      when(mockRadarService.isYjsSynced).thenReturn(true);

      expect(mockRadarService.isScanning, isTrue);
      expect(mockRadarService.isYjsSynced, isTrue);
    });

    test('AdasService: processFrame returns valid AdasState', () async {
      final dummyFrame = Uint8List.fromList([0, 1, 2, 3, 4]);
      final expectedState = AdasState(
        detections: [],
        laneState: LaneState(leftLaneVisible: true, rightLaneVisible: true),
        riskLevel: AdasRiskLevel.low,
        activeAlerts: [],
      );

      when(mockAdasService.processFrame(dummyFrame)).thenAnswer((_) async => expectedState);

      final state = await mockAdasService.processFrame(dummyFrame);
      expect(state.riskLevel, equals(AdasRiskLevel.low));
      expect(state.laneState.leftLaneVisible, isTrue);
      verify(mockAdasService.processFrame(dummyFrame)).called(1);
    });

    test('DmsService: processLandmarks handles driver monitoring data', () async {
      final landmarks = List<double>.generate(1404, (i) => 0.5);
      when(mockDmsService.processLandmarks(landmarks)).thenAnswer((_) async {});

      await mockDmsService.processLandmarks(landmarks);
      verify(mockDmsService.processLandmarks(landmarks)).called(1);
    });

    test('DmsService: checkAlerts evaluates safety status correctly', () {
      final status = DmsStatus(
        earLeft: 0.15,
        earRight: 0.15,
        mar: 0.6,
        drowsinessScore: 0.95,
        yawningScore: 0.8,
        isDistracted: false,
        isDrowsy: true,
        isYawning: true,
        seatbeltState: sb.SeatbeltStatus.fastened,
        headPose: {'pitch': 0.0, 'yaw': 0.0, 'roll': 0.0},
        alerts: ['Drowsiness alert'],
      );

      when(mockDmsService.checkAlerts(status)).thenReturn(null);
      mockDmsService.checkAlerts(status);
      verify(mockDmsService.checkAlerts(status)).called(1);
    });
  });
}
