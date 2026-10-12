import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gara_g_pilot/src/screens/analytics_screen.dart';

void main() {
  testWidgets('AnalyticsScreen shows loading state then data', (WidgetTester tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: AnalyticsScreen(),
      ),
    );

    // Verify loading indicator
    expect(find.byType(CircularProgressIndicator), findsOneWidget);

    // Wait for data to load (simulated 1s delay)
    await tester.pump(const Duration(seconds: 1));
    await tester.pump();

    // Verify data is shown
    expect(find.text('Predictive Analytics'), findsOneWidget);
    expect(find.text('Health Score'), findsOneWidget);
    expect(find.text('Est. Cost'), findsOneWidget);
    expect(find.text('Vehicle Health'), findsOneWidget);
    expect(find.text('ML Insights'), findsOneWidget);
  });

  testWidgets('AnalyticsScreen refresh button works', (WidgetTester tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: AnalyticsScreen(),
      ),
    );

    // Wait for initial load
    await tester.pump(const Duration(seconds: 1));
    await tester.pump();

    // Find and tap refresh button
    final refreshButton = find.byIcon(Icons.refresh);
    expect(refreshButton, findsOneWidget);
    await tester.tap(refreshButton);
    await tester.pump();

    // Should show loading again
    expect(find.byType(CircularProgressIndicator), findsOneWidget);

    await tester.pump(const Duration(seconds: 1));
    await tester.pump();
    expect(find.byType(CircularProgressIndicator), findsNothing);
  });
}
