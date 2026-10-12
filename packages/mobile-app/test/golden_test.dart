import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gara_g_pilot/src/screens/dashboard_screen.dart';

void main() {
  group('Golden Tests', () {
    testWidgets('DashboardScreen Golden Test', (WidgetTester tester) async {
      tester.view.physicalSize = const Size(1080, 1920);
      tester.view.devicePixelRatio = 1.0;

      await tester.pumpWidget(
        const MaterialApp(
          home: DashboardScreen(),
        ),
      );
      await expectLater(find.byType(DashboardScreen), matchesGoldenFile('goldens/dashboard_screen.png'));
      addTearDown(tester.view.resetPhysicalSize);
    });
  });
}
