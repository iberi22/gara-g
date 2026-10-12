import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:gara_g_pilot/main.dart' as app;

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  group('E2E App Tests', () {
    testWidgets('Verify Dashboard and Navigation to Wallet', (WidgetTester tester) async {
      // Start the app
      await app.main();
      await tester.pumpAndSettle(const Duration(seconds: 2));

      // 1. Verify Dashboard title is present
      expect(find.text('Gara-G Pilot'), findsOneWidget);

      // 2. Navigate to Wallet
      final walletCard = find.text('Wallet');
      expect(walletCard, findsOneWidget);
      await tester.tap(walletCard);
      await tester.pumpAndSettle();

      // 3. Verify Wallet Screen title
      expect(find.text('Gara Wallet'), findsOneWidget);
      expect(find.text("\$GARA (Testnet)"), findsOneWidget);

      // 4. Go back to Dashboard
      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(find.text('Gara-G Pilot'), findsOneWidget);
    });

    testWidgets('Verify Navigation to Dashcam Sentinel', (WidgetTester tester) async {
      await app.main();
      await tester.pumpAndSettle(const Duration(seconds: 2));

      final dashcamCard = find.text('Dashcam Sentinel');
      expect(dashcamCard, findsOneWidget);
      await tester.tap(dashcamCard);
      await tester.pumpAndSettle();

      // Should show dashcam screen or error if no camera (Initializing...)
      expect(find.text('Initializing...'), findsWidgets);
    });

    testWidgets('Verify V2V Connection UI', (WidgetTester tester) async {
      await app.main();
      await tester.pumpAndSettle(const Duration(seconds: 2));

      final v2vCard = find.text('V2V Settings');
      expect(v2vCard, findsOneWidget);
      await tester.tap(v2vCard);
      await tester.pumpAndSettle();
      expect(find.text('V2V Configuration'), findsOneWidget);
      expect(find.text('Nearby Devices'), findsOneWidget);
    });

    testWidgets('Verify Marketplace and Product Details', (WidgetTester tester) async {
      await app.main();
      await tester.pumpAndSettle(const Duration(seconds: 2));

      final marketplaceCard = find.text('Marketplace');
      expect(marketplaceCard, findsOneWidget);
      await tester.tap(marketplaceCard);
      await tester.pumpAndSettle();

      expect(find.text('DePIN Marketplace'), findsOneWidget);
      // Wait for products to load (mocked)
      await tester.pumpAndSettle(const Duration(seconds: 1));
      expect(find.byType(Card), findsWidgets);
    });

    testWidgets('Verify DePIN Nodes Management', (WidgetTester tester) async {
      await app.main();
      await tester.pumpAndSettle(const Duration(seconds: 2));

      final nodesCard = find.text('My Nodes');
      expect(nodesCard, findsOneWidget);
      await tester.tap(nodesCard);
      await tester.pumpAndSettle();
      expect(find.text('Active Nodes'), findsOneWidget);
    });

    testWidgets('Verify AI & Analytics Screen', (WidgetTester tester) async {
      await app.main();
      await tester.pumpAndSettle(const Duration(seconds: 2));

      final analyticsCard = find.text('Analytics');
      expect(analyticsCard, findsOneWidget);
      await tester.tap(analyticsCard);
      await tester.pumpAndSettle();
      expect(find.text('Performance Insights'), findsOneWidget);
    });
  });
}
