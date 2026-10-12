import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gara_g_pilot/src/screens/sigfox_screen.dart';

void main() {
  testWidgets('SigfoxScreen renders with loading state', (WidgetTester tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: SigfoxScreen(),
      ),
    );

    // Initial loading state
    expect(find.byType(CircularProgressIndicator), findsOneWidget);

    // Wait for data load
    await tester.pump();

    // Verify tabs exist
    expect(find.text('Sigfox IoT Monitor'), findsOneWidget);
    expect(find.text('Devices'), findsWidgets);
    expect(find.text('Messages'), findsWidgets);
  });

  testWidgets('Tab switching works', (WidgetTester tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: SigfoxScreen(),
      ),
    );

    await tester.pump();

    // Tab bar has 2 tabs
    final tabBar = find.byType(TabBar);
    expect(tabBar, findsOneWidget);

    // Tap Messages tab
    await tester.tap(find.text('Messages').last);
    await tester.pump();
  });
}
