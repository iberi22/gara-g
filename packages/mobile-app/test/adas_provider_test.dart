import 'package:flutter_test/flutter_test.dart';
import 'package:gara_g_pilot/src/providers/adas_provider.dart';
import 'package:gara_g_pilot/src/services/adas_service.dart';
import 'package:gara_g_pilot/src/services/ai_bridge.dart';
import 'dart:typed_data';

void main() {
  group('AdasProvider', () {
    late AdasProvider provider;
    late AdasService service;
    late AiBridge bridge;

    setUp(() {
      bridge = AiBridge();
      service = AdasService(bridge);
      provider = AdasProvider(service);
    });

    test('Initial state is low risk', () {
      expect(provider.state.riskLevel, AdasRiskLevel.low);
      expect(provider.state.activeAlerts, isEmpty);
    });

    test('updateFromFrame triggers updates', () async {
      final frame = Uint8List(100);
      await provider.updateFromFrame(frame);
      expect(provider.state, isNotNull);
    });
  });
}
