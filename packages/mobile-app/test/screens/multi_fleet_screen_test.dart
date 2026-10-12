import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gara_g_pilot/src/screens/multi_fleet_screen.dart';

void main() {
  testWidgets('MultiFleetScreen renders with tabs', (WidgetTester tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: MultiFleetScreen(),
      ),
    );

    // Initial loading state
    expect(find.byType(CircularProgressIndicator), findsOneWidget);

    // Wait for data load
    await tester.pump();

    // Verify tab bar exists
    expect(find.text('Multi-Fleet Dashboard'), findsOneWidget);
    expect(find.text('Overview'), findsWidgets);
    expect(find.text('Analytics'), findsWidgets);
    expect(find.text('Compare'), findsWidgets);
  });

  testWidgets('Tab switching works correctly', (WidgetTester tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: MultiFleetScreen(),
      ),
    );

    // Wait for load
    await tester.pump();

    // Find tab bar and verify it has 3 tabs
    final tabBar = find.byType(TabBar);
    expect(tabBar, findsOneWidget);

    // Tap on Analytics tab
    await tester.tap(find.text('Analytics').last);
    await tester.pump();
    expect(find.text('Fleet Analytics'), findsOneWidget);
  });
}
