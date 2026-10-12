import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gara_g_pilot/src/screens/marketplace_screen.dart';

void main() {
  testWidgets('MarketplaceScreen renders tabs and content', (WidgetTester tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: MarketplaceScreen(),
      ),
    );

    // Verify tabs
    expect(find.text('My Data'), findsOneWidget);
    expect(find.text('Available Streams'), findsOneWidget);

    // Initial loading state for "My Data"
    expect(find.byType(CircularProgressIndicator), findsOneWidget);

    // Wait for loadData
    await tester.pump();

    // Verify content of "My Data" tab
    expect(find.text('Total Earned'), findsOneWidget);
    expect(find.text('Share My Data'), findsOneWidget);
    expect(find.text('Your Privacy is Protected'), findsOneWidget);

    // Switch to "Available Streams" tab
    await tester.tap(find.text('Available Streams'));
    await tester.pumpAndSettle();

    // Verify content of "Available Streams" tab
    expect(find.text('Real-time Traffic NYC'), findsOneWidget);
    expect(find.text('Weather Data SF'), findsOneWidget);
    expect(find.text('10.0 GARA'), findsOneWidget);
    expect(find.text('Buy Access'), findsWidgets);
  });
}
