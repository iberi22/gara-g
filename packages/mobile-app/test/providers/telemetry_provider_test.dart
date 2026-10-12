import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/services.dart';
import 'package:gara_g_pilot/src/providers/telemetry_provider.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const MethodChannel geolocatorChannel = MethodChannel('flutter.baseflow.com/geolocator');
  const MethodChannel permissionChannel = MethodChannel('flutter.baseflow.com/permissions/methods');
  const MethodChannel sensorsChannel = MethodChannel('dev.fluttercommunity.plus/sensors/method');

  setUpAll(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
      geolocatorChannel,
      (MethodCall methodCall) async {
        if (methodCall.method == 'isLocationServiceEnabled') {
          return true;
        }
        if (methodCall.method == 'checkPermission') {
          return 3; // LocationPermission.whileInUse
        }
        return null;
      },
    );

    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
      permissionChannel,
      (MethodCall methodCall) async {
        return {
          0: 3, // Permission.location -> PermissionStatus.granted
        };
      },
    );

    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
      sensorsChannel,
      (MethodCall methodCall) async {
        return null;
      },
    );
  });

  group('TelemetryProvider', () {
    late TelemetryProvider provider;

    setUp(() {
      provider = TelemetryProvider();
    });

    tearDown(() {
      provider.dispose();
    });

    test('TelemetryProvider can be instantiated with initial state', () {
      expect(provider, isNotNull);
      expect(provider.isMonitoring, isFalse);
      expect(provider.latestRecord, isNull);
      expect(provider.latestObdReading, isNull);
      expect(provider.currentSpeed, equals(0.0));
      expect(provider.currentRpm, equals(0.0));
    });

    test('Start and stop telemetry monitoring updates state', () async {
      await provider.startTelemetryMonitoring(walletAddress: '0x1234567890123456789012345678901234567890');
      expect(provider.isMonitoring, isTrue);

      await provider.stopTelemetryMonitoring(walletAddress: '0x1234567890123456789012345678901234567890');
      expect(provider.isMonitoring, isFalse);
    });
  });
}
