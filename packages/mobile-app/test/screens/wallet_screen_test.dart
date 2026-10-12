import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gara_g_pilot/src/screens/wallet_screen.dart';

void main() {
  testWidgets('WalletScreen renders balance and sync button', (WidgetTester tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: WalletScreen(),
      ),
    );

    // Initial state might show error or 0.00 since it calls Rust api
    expect(find.text('Gara Wallet'), findsOneWidget);
    expect(find.text('\$GARA (Testnet)'), findsOneWidget);
    expect(find.text('0.00'), findsOneWidget);

    expect(find.text('Sync Vault & Claim Rewards'), findsOneWidget);
    expect(find.text('Network Status'), findsOneWidget);
    expect(find.text('Vault Status'), findsOneWidget);
  });
}
