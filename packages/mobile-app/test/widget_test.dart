import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gara_g_pilot/main.dart';
import 'package:gara_g_pilot/src/providers/appProvider.dart';
import 'package:gara_g_pilot/src/services/telemetry_service.dart';
import 'package:gara_g_pilot/src/services/activity_recognition_service.dart';
import 'package:gara_g_pilot/src/services/trip_service.dart';

class FakeActivityRecognitionService extends ActivityRecognitionService {}

void main() {
  testWidgets('App smoke test', (WidgetTester tester) async {
    final activityService = FakeActivityRecognitionService();
    final tripService = TripService(activityService);
    final appProvider = AppProvider();
    final telemetryService = TelemetryService();

    // Build our app and trigger a frame.
    await tester.pumpWidget(GaraGApp(
      appProvider: appProvider,
      telemetryService: telemetryService,
      activityRecognitionService: activityService,
      tripService: tripService,
    ));

    // Verify compliance
    expect(find.byType(MaterialApp), findsOneWidget);

    // Handle pending timers from services/providers without infinite pumpAndSettle
    await tester.pump(const Duration(milliseconds: 100));
  });
}
