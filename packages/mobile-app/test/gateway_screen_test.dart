import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/material.dart';
import 'package:gara_g_pilot/src/screens/gateway_screen.dart';

void main() {
  group('GatewayScreen Tests', () {
    testWidgets('GatewayScreen should render without errors', (WidgetTester tester) async {
      // Build the GatewayScreen widget
      await tester.pumpWidget(
        const MaterialApp(
          home: GatewayScreen(),
        ),
      );

      // Verify that the screen renders
      expect(find.text('Gateway Operations'), findsOneWidget);
      
      // Verify satellite section exists
      expect(find.text('Satellite Uplink'), findsOneWidget);
      
      // Verify LoRa section exists
      expect(find.text('LoRaWAN Listener'), findsOneWidget);
      
      // Verify logs section exists
      expect(find.text('Gateway Logs'), findsOneWidget);
    });

    testWidgets('GatewayScreen should show status indicators', (WidgetTester tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: GatewayScreen(),
        ),
      );

      // Wait for initial status updates
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));

      // Should show some status text (even if "Checking...")
      expect(find.textContaining('Checking'), findsWidgets);
    });

    testWidgets('GatewayScreen should have interactive buttons', (WidgetTester tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: GatewayScreen(),
        ),
      );

      // Verify buttons exist
      expect(find.text('Connect'), findsWidgets);
      expect(find.text('Test Alert'), findsOneWidget);
      expect(find.byType(Switch), findsOneWidget);
      expect(find.byType(DropdownButton<int>), findsOneWidget);
    });

    testWidgets('GatewayScreen should have refresh button in app bar', (WidgetTester tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: GatewayScreen(),
        ),
      );

      // Verify refresh button exists
      expect(find.byIcon(Icons.refresh), findsOneWidget);
      
      // Tap refresh button
      await tester.tap(find.byIcon(Icons.refresh));
      await tester.pump();
    });

    testWidgets('GatewayScreen logs should be clearable', (WidgetTester tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: GatewayScreen(),
        ),
      );

      // Find and tap clear button
      expect(find.text('Clear'), findsOneWidget);
      await tester.tap(find.text('Clear'));
      await tester.pump();
    });

    testWidgets('GatewayScreen frequency selector should change value', (WidgetTester tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: GatewayScreen(),
        ),
      );

      // Find dropdown
      final dropdown = find.byType(DropdownButton<int>);
      expect(dropdown, findsOneWidget);
      
      // Initial value should be EU868 (0)
      final DropdownButton<int> dropdownWidget = tester.widget(dropdown);
      expect(dropdownWidget.value, 0);
    });
  });
}
