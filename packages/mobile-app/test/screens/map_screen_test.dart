import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gara_g_pilot/src/screens/map_screen.dart';
import 'package:flutter_map/flutter_map.dart';

void main() {
  testWidgets('MapScreen renders flutter_map and back button', (WidgetTester tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: MapScreen(),
      ),
    );

    // Verify map is present
    expect(find.byType(FlutterMap), findsOneWidget);

    // Verify back button is present
    expect(find.byIcon(Icons.arrow_back), findsOneWidget);

    // Wait for initial telemetry update
    await tester.pump(const Duration(seconds: 2));
    await tester.pumpAndSettle();

    // Verify telemetry card appears (if mock data returned it)
    // expect(find.byType(TelemetryCard), findsOneWidget);
  });
}
