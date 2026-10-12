import 'package:flutter_test/flutter_test.dart';
import 'package:gara_g_pilot/src/services/nearby_service.dart';

void main() {
  group('NearbyService', () {
    test('isAdvertising should initially be false', () {
      final service = NearbyService();
      expect(service.isAdvertising, isFalse);
    });

    test('isDiscovering should initially be false', () {
      final service = NearbyService();
      expect(service.isDiscovering, isFalse);
    });
  });
}
