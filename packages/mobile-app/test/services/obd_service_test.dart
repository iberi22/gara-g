import 'package:flutter_test/flutter_test.dart';
import 'package:gara_g_pilot/src/services/obdService.dart';

void main() {
  group('ObdService', () {
    late ObdService service;

    setUp(() {
      service = ObdService();
    });

    tearDown(() {
      service.stop();
    });

    test('ObdReading model maps correctly', () {
      final map = {
        'speed': 85.5,
        'rpm': 2400.0,
        'coolantTemp': 92.0,
        'engineLoad': 45.0,
        'fuelLevel': 80.0,
        'throttlePosition': 30.0,
        'timestamp': 1700000000000,
      };

      final reading = ObdReading.fromMap(map);
      expect(reading.speed, equals(85.5));
      expect(reading.rpm, equals(2400.0));
      expect(reading.coolantTemp, equals(92.0));
      expect(reading.engineLoad, equals(45.0));
      expect(reading.fuelLevel, equals(80.0));
      expect(reading.toMap()['speed'], equals(85.5));
    });

    test('Simulation mode generates readings stream', () async {
      service.startSimulation();
      expect(service.isConnected, isTrue);

      final readingFuture = service.obdDataStream.first;
      final reading = await readingFuture;

      expect(reading.speed, greaterThanOrEqualTo(0.0));
      expect(reading.rpm, greaterThanOrEqualTo(0.0));
      expect(reading.coolantTemp, equals(88.0));
    });

    test('Stop clears simulation and resets connection state', () async {
      service.startSimulation();
      expect(service.isConnected, isTrue);

      await service.stop();
      expect(service.isConnected, isFalse);
    });
  });
}
