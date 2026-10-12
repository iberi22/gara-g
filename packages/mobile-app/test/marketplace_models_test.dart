import 'package:flutter_test/flutter_test.dart';
import 'package:gara_g_pilot/src/models/marketplace_models.dart';

void main() {
  group('DataPackage', () {
    test('creates DataPackage with all fields', () {
      final package = DataPackage(
        id: 'test-id',
        type: 'telemetry',
        timestamp: DateTime(2024, 1, 1),
        earnedGara: 1.5,
        status: 'pending',
        dataPoints: 100,
      );

      expect(package.id, 'test-id');
      expect(package.type, 'telemetry');
      expect(package.earnedGara, 1.5);
      expect(package.status, 'pending');
      expect(package.dataPoints, 100);
    });

    test('serializes to JSON correctly', () {
      final package = DataPackage(
        id: 'test-id',
        type: 'telemetry',
        timestamp: DateTime(2024, 1, 1),
        earnedGara: 1.5,
        status: 'pending',
        dataPoints: 100,
      );

      final json = package.toJson();

      expect(json['id'], 'test-id');
      expect(json['type'], 'telemetry');
      expect(json['earnedGara'], 1.5);
      expect(json['status'], 'pending');
      expect(json['dataPoints'], 100);
    });

    test('deserializes from JSON correctly', () {
      final json = {
        'id': 'test-id',
        'type': 'video',
        'timestamp': '2024-01-01T00:00:00.000',
        'earnedGara': 2.5,
        'status': 'sold',
        'dataPoints': 200,
      };

      final package = DataPackage.fromJson(json);

      expect(package.id, 'test-id');
      expect(package.type, 'video');
      expect(package.earnedGara, 2.5);
      expect(package.status, 'sold');
      expect(package.dataPoints, 200);
    });
  });

  group('MarketplaceSettings', () {
    test('creates with default values', () {
      const settings = MarketplaceSettings();

      expect(settings.shareLocation, false);
      expect(settings.shareTelemetry, false);
      expect(settings.shareVideo, false);
      expect(settings.shareRoadConditions, false);
      expect(settings.minimumPrice, 0.01);
    });

    test('creates with custom values', () {
      const settings = MarketplaceSettings(
        shareLocation: true,
        shareTelemetry: true,
        minimumPrice: 0.05,
      );

      expect(settings.shareLocation, true);
      expect(settings.shareTelemetry, true);
      expect(settings.shareVideo, false);
      expect(settings.minimumPrice, 0.05);
    });

    test('copyWith updates only specified fields', () {
      const settings = MarketplaceSettings(
        shareLocation: true,
        shareTelemetry: false,
      );

      final updated = settings.copyWith(shareTelemetry: true);

      expect(updated.shareLocation, true);
      expect(updated.shareTelemetry, true);
      expect(updated.shareVideo, false);
    });

    test('serializes and deserializes correctly', () {
      const settings = MarketplaceSettings(
        shareLocation: true,
        shareTelemetry: true,
        shareVideo: false,
        shareRoadConditions: true,
        minimumPrice: 0.02,
      );

      final json = settings.toJson();
      final restored = MarketplaceSettings.fromJson(json);

      expect(restored.shareLocation, settings.shareLocation);
      expect(restored.shareTelemetry, settings.shareTelemetry);
      expect(restored.shareVideo, settings.shareVideo);
      expect(restored.shareRoadConditions, settings.shareRoadConditions);
      expect(restored.minimumPrice, settings.minimumPrice);
    });
  });

  group('EarningsHistory', () {
    test('calculates total pending correctly', () {
      const history = EarningsHistory(
        totalEarned: 10.0,
        totalClaimed: 6.0,
      );

      expect(history.totalPending, 4.0);
    });

    test('handles empty entries', () {
      const history = EarningsHistory();

      expect(history.entries, isEmpty);
      expect(history.totalEarned, 0.0);
      expect(history.totalClaimed, 0.0);
      expect(history.totalPending, 0.0);
    });

    test('serializes and deserializes with entries', () {
      final history = EarningsHistory(
        entries: [
          EarningEntry(
            timestamp: DateTime(2024, 1, 1),
            amount: 1.5,
            type: 'telemetry',
            status: 'claimed',
          ),
          EarningEntry(
            timestamp: DateTime(2024, 1, 2),
            amount: 2.5,
            type: 'video',
            status: 'pending',
          ),
        ],
        totalEarned: 4.0,
        totalClaimed: 1.5,
      );

      final json = history.toJson();
      final restored = EarningsHistory.fromJson(json);

      expect(restored.entries.length, 2);
      expect(restored.totalEarned, 4.0);
      expect(restored.totalClaimed, 1.5);
      expect(restored.entries[0].amount, 1.5);
      expect(restored.entries[1].amount, 2.5);
    });
  });

  group('EarningEntry', () {
    test('creates entry with all fields', () {
      final entry = EarningEntry(
        timestamp: DateTime(2024, 1, 1),
        amount: 1.5,
        type: 'telemetry',
        status: 'claimed',
      );

      expect(entry.amount, 1.5);
      expect(entry.type, 'telemetry');
      expect(entry.status, 'claimed');
    });

    test('serializes and deserializes correctly', () {
      final entry = EarningEntry(
        timestamp: DateTime(2024, 1, 1),
        amount: 1.5,
        type: 'telemetry',
        status: 'claimed',
      );

      final json = entry.toJson();
      final restored = EarningEntry.fromJson(json);

      expect(restored.amount, entry.amount);
      expect(restored.type, entry.type);
      expect(restored.status, entry.status);
      expect(restored.timestamp.year, entry.timestamp.year);
      expect(restored.timestamp.month, entry.timestamp.month);
      expect(restored.timestamp.day, entry.timestamp.day);
    });
  });
}
