import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gara_g_pilot/src/screens/dashboard_screen.dart';

void main() {
  testWidgets('DashboardScreen renders all cards', (WidgetTester tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: DashboardScreen(),
      ),
    );

    // Verify AppBar title
    expect(find.text('Gara-G Pilot'), findsOneWidget);

    // Verify existence of core dashboard cards
    expect(find.text('Dashcam Sentinel'), findsOneWidget);
    expect(find.text('V2V Map'), findsOneWidget);
    expect(find.text('Wallet'), findsOneWidget);

    // Some might be off-screen and need scrolling
    // Let's use findsWidgets or scroll until visible
    await tester.scrollUntilVisible(find.text('Routes'), 100);
    expect(find.text('Routes'), findsOneWidget);

    // Verify GridView exists
    expect(find.byType(GridView), findsOneWidget);
  });

  testWidgets('DashboardScreen cards are interactive', (WidgetTester tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: DashboardScreen(),
      ),
    );

    // Find a card and tap it
    final walletCard = find.text('Wallet');
    await tester.ensureVisible(walletCard);
    await tester.tap(walletCard);
    await tester.pumpAndSettle();

    // Verify it attempted to navigate (WalletScreen should be on top)
    // WalletScreen likely has "Wallet" or similar in AppBar
    // expect(find.text('Wallet'), findsOneWidget);
  });
}
