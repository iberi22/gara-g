import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gara_g_pilot/src/screens/home_screen.dart';
import 'package:gara_g_pilot/src/widgets/nav_bar.dart';

void main() {
  testWidgets('HomeScreen renders correctly with bottom navigation', (WidgetTester tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: HomeScreen(),
      ),
    );

    // Verify IndexedStack exists
    expect(find.byType(IndexedStack), findsOneWidget);

    // Verify GaraNavBar exists
    expect(find.byType(GaraNavBar), findsOneWidget);

    // Verify it starts with the first screen (Dashboard)
    // DashboardScreen has an AppBar with "Gara-G Pilot"
    expect(find.text('Gara-G Pilot'), findsOneWidget);
  });

  testWidgets('HomeScreen navigation exists', (WidgetTester tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: HomeScreen(),
      ),
    );

    final navBar = find.byType(GaraNavBar);
    expect(navBar, findsOneWidget);
  });
}
