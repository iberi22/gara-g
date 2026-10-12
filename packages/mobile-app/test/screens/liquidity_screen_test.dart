import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gara_g_pilot/src/screens/liquidity_screen.dart';

void main() {
  testWidgets('LiquidityScreen renders pools and add button', (WidgetTester tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: LiquidityScreen(),
      ),
    );

    expect(find.byType(CircularProgressIndicator), findsOneWidget);

    await tester.pump();

    expect(find.text('Liquidity Pools'), findsOneWidget);
    expect(find.text('Add Liquidity'), findsOneWidget);

    // Verify FAB
    expect(find.byType(FloatingActionButton), findsOneWidget);
  });
}
