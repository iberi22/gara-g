import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gara_g_pilot/src/screens/maintenance_screen.dart';
import 'package:gara_g_pilot/src/screens/garage_screen.dart';

void main() {
  final mockVehicle = VehicleNft(
    tokenId: 1,
    name: 'Test Car',
    imageUrl: '',
    status: 'Active',
    mileage: 1000,
    hasDevice: false,
  );

  testWidgets('MaintenanceScreen renders', (WidgetTester tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: MaintenanceScreen(vehicle: mockVehicle),
      ),
    );

    expect(find.text('Maintenance: Test Car'), findsOneWidget);
    expect(find.text('Maintenance Screen - Coming Soon!'), findsOneWidget);
  });
}
