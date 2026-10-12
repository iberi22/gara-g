import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gara_g_pilot/src/screens/vehicle_detail_screen.dart';
import 'package:gara_g_pilot/src/screens/garage_screen.dart';

void main() {
  final mockVehicle = VehicleNft(
    tokenId: 1,
    name: 'Test Toyota',
    status: 'Active',
    mileage: 12000,
    imageUrl: '',
    hasDevice: true,
  );

  testWidgets('VehicleDetailScreen renders vehicle info', (WidgetTester tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: VehicleDetailScreen(vehicle: mockVehicle),
      ),
    );

    // Verify name in AppBar
    expect(find.text('Test Toyota'), findsWidgets);

    // Verify status card
    expect(find.textContaining('Estado: Active'), findsOneWidget);

    // Verify quick stats
    expect(find.text('12000'), findsOneWidget);
    expect(find.text('Kilometraje'), findsOneWidget);

    // Verify action buttons
    expect(find.text('OBD en Vivo'), findsOneWidget);
    expect(find.text('Mantenimiento'), findsOneWidget);
    expect(find.text('Diagnóstico'), findsOneWidget);

    // Verify device section
    expect(find.text('Sentinel Pro'), findsOneWidget);
  });

  testWidgets('VehicleDetailScreen shows activity', (WidgetTester tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: VehicleDetailScreen(vehicle: mockVehicle),
      ),
    );

    expect(find.text('Actividad Reciente'), findsOneWidget);
    expect(find.text('Tanque lleno'), findsOneWidget);
  });
}
