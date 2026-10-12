import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gara_g_pilot/src/screens/earnings_screen.dart';
import 'package:fl_chart/fl_chart.dart';

void main() {
  testWidgets('EarningsScreen renders balance and charts', (WidgetTester tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: EarningsScreen(),
      ),
    );

    // Initial state (or mock EnterpriseService if it was injected)
    // Current implementation uses a hardcoded instance in _EarningsScreenState

    // Wait for _loadEarnings (which uses mock EnterpriseService internally)
    await tester.pump();

    expect(find.text('Earnings Dashboard'), findsOneWidget);
    expect(find.text('TOTAL BALANCE'), findsOneWidget);
    expect(find.text('WITHDRAW TO WALLET'), findsOneWidget);
    expect(find.text('Earnings History'), findsOneWidget);

    // Verify chart
    expect(find.byType(LineChart), findsOneWidget);

    // Verify stats grid
    expect(find.text('Active Time'), findsOneWidget);
    expect(find.text('Distance'), findsOneWidget);
    expect(find.text('Total Points'), findsOneWidget);
    expect(find.text('Coverage Score'), findsOneWidget);
  });
}
