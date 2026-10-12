import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gara_g_pilot/src/screens/exchange_screen.dart';

void main() {
  testWidgets('ExchangeScreen renders market pairs and swap card', (WidgetTester tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: ExchangeScreen(),
      ),
    );

    // Should show loading initially
    expect(find.byType(CircularProgressIndicator), findsOneWidget);

    // Wait for fetchPrices (EnterpriseService mock data)
    await tester.pump();

    expect(find.text('Exchange'), findsOneWidget);
    expect(find.text('Market Pairs'), findsOneWidget);
    expect(find.text('Quick Swap'), findsOneWidget);
    expect(find.text('Swap Now'), findsOneWidget);
    expect(find.text('Recent Activity'), findsOneWidget);

    // Verify swap input boxes
    expect(find.text('From'), findsOneWidget);
    expect(find.text('To'), findsOneWidget);
    expect(find.text('USDT'), findsOneWidget);
    expect(find.text('GARA'), findsOneWidget);
  });
}
