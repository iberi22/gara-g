import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gara_g_pilot/src/screens/garage_screen.dart';

void main() {
  testWidgets('GarageScreen shows loading then vehicles', (WidgetTester tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: GarageScreen(),
      ),
    );

    // Initial loading state
    expect(find.text('Cargando garaje...'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);

    // Wait for mock data (1s delay in code)
    await tester.pump(const Duration(seconds: 1));
    await tester.pump();

    // Verify mock vehicles are shown
    expect(find.text('Toyota Corolla 2020'), findsOneWidget);
    expect(find.text('Honda Civic 2019'), findsOneWidget);
    expect(find.text('Active'), findsOneWidget);
    expect(find.text('Maintenance'), findsOneWidget);
  });

  testWidgets('GarageScreen add vehicle dialog opens', (WidgetTester tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: GarageScreen(),
      ),
    );
    await tester.pump(const Duration(seconds: 1));
    await tester.pump();

    // Find and tap add button in AppBar
    final addButton = find.byIcon(Icons.add_circle_outline);
    await tester.tap(addButton);
    await tester.pumpAndSettle();

    // Verify dialog/bottom sheet content
    expect(find.text('Agregar Vehículo'), findsOneWidget);
    expect(find.text('Escanear VIN'), findsOneWidget);
    expect(find.text('Ingresar Manualmente'), findsOneWidget);
  });
}
