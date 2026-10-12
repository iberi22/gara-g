import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gara_g_pilot/src/screens/wallet_screen.dart';

void main() {
  testWidgets('WalletScreen renders correctly', (WidgetTester tester) async {
    // Set a larger surface size to avoid overflows in tests
    tester.view.physicalSize = const Size(1200, 2400);
    tester.view.devicePixelRatio = 1.0;

    await tester.pumpWidget(
      const MaterialApp(
        home: WalletScreen(),
      ),
    );

    expect(find.text('Gara Wallet'), findsOneWidget);
    expect(find.text("\$GARA (Testnet)"), findsOneWidget);

    addTearDown(tester.view.resetPhysicalSize);
  });
}
