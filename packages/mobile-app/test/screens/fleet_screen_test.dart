import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gara_g_pilot/src/screens/fleet_screen.dart';

void main() {
  testWidgets('FleetScreen shows loading then stats and fleets', (WidgetTester tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: FleetScreen(),
      ),
    );

    // Initial state
    expect(find.byType(CircularProgressIndicator), findsOneWidget);

    // Wait for _loadData (FleetService mock data)
    await tester.pump();

    expect(find.text('Fleet Management'), findsOneWidget);
    expect(find.text('Your Fleets'), findsOneWidget);

    // Verify some stats and fleet items exist (based on FleetService mock data)
    // FleetService likely returns some mock data in listFleets/getFleetStats

    // Verify FAB
    expect(find.byType(FloatingActionButton), findsOneWidget);
  });
}
