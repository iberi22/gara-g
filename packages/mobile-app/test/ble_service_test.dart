import 'package:flutter_test/flutter_test.dart';
import 'package:gara_g_pilot/src/services/ble_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('BleService', () {
    test('BleService should be a singleton', () {
      final s1 = BleService();
      final s2 = BleService();
      expect(s1, same(s2));
    });
  });
}
