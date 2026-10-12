import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gara_g_pilot/src/screens/route_screen.dart';

void main() {
  testWidgets('RouteScreen renders route info and navigation button', (WidgetTester tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: RouteScreen(),
      ),
    );

    expect(find.text('Route Optimization'), findsOneWidget);
    expect(find.text('Current Route'), findsOneWidget);
    expect(find.text('Central Hub'), findsOneWidget);
    expect(find.text('North Delivery'), findsOneWidget);
    expect(find.text('South Distribution'), findsOneWidget);

    expect(find.text('Start Navigation'), findsOneWidget);
    expect(find.byType(ElevatedButton), findsOneWidget);
  });
}
