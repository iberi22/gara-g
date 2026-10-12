import 'package:flutter_test/flutter_test.dart';
import 'package:gara_g_pilot/src/services/optInService.dart';

void main() {
  group('OptInScheduleConfig Tests', () {
    test('creates with default values', () {
      const schedule = OptInScheduleConfig();
      expect(schedule.startHour, 0);
      expect(schedule.endHour, 24);
      expect(schedule.daysOfWeek.length, 7);
    });

    test('serializes and deserializes correctly', () {
      const schedule = OptInScheduleConfig(
        startHour: 8,
        endHour: 18,
        daysOfWeek: [1, 2, 3, 4, 5],
      );
      final json = schedule.toJson();
      final deserialized = OptInScheduleConfig.fromJson(json);

      expect(deserialized.startHour, 8);
      expect(deserialized.endHour, 18);
      expect(deserialized.daysOfWeek, [1, 2, 3, 4, 5]);
    });
  });

  group('ExtendedOptInPreferences Tests', () {
    test('creates with default values', () {
      const prefs = ExtendedOptInPreferences();
      expect(prefs.enabled, isTrue);
      expect(prefs.minPayoutGara, 10.0);
      expect(prefs.maxDistanceKm, 50.0);
      expect(prefs.categories.contains('telemetry'), isTrue);
    });

    test('serializes and deserializes correctly', () {
      const prefs = ExtendedOptInPreferences(
        enabled: false,
        minPayoutGara: 25.0,
        maxDistanceKm: 100.0,
        categories: ['telemetry', 'deals'],
      );
      final json = prefs.toJson();
      final deserialized = ExtendedOptInPreferences.fromJson(json);

      expect(deserialized.enabled, isFalse);
      expect(deserialized.minPayoutGara, 25.0);
      expect(deserialized.maxDistanceKm, 100.0);
      expect(deserialized.categories, ['telemetry', 'deals']);
    });

    test('copyWith updates specified fields', () {
      const prefs = ExtendedOptInPreferences();
      final updated = prefs.copyWith(
        minPayoutGara: 30.0,
        enabled: false,
      );

      expect(updated.minPayoutGara, 30.0);
      expect(updated.enabled, isFalse);
      expect(updated.maxDistanceKm, prefs.maxDistanceKm);
      expect(updated.categories, prefs.categories);
    });
  });
}
