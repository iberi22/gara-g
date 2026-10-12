import 'package:flutter_test/flutter_test.dart';
import 'package:gara_g_pilot/src/services/telemetry_service.dart';

void main() {
  group('TelemetryService', () {
    late TelemetryService service;

    setUp(() {
      service = TelemetryService();
    });

    test('Service can be instantiated', () {
      expect(service, isNotNull);
    });

    // TelemetryService calls top-level functions from rust/api.dart
    // and uses sensors_plus plugin.
    // Testing startMonitoring/stopMonitoring properly would require
    // mocking the platform channel for sensors and the rust bridge.
    // For now we verify it can be created and doesn't crash on stop if not started.

    test('Stop monitoring doesn\'t crash if not started', () {
      expect(() => service.stopMonitoring(), returnsNormally);
    });
  });
}
