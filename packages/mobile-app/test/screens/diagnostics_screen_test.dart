import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gara_g_pilot/src/screens/diagnostics_screen.dart';
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

  testWidgets('DiagnosticsScreen renders', (WidgetTester tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: DiagnosticsScreen(vehicle: mockVehicle),
      ),
    );

    expect(find.text('Diagnostics: Test Car'), findsOneWidget);
    expect(find.text('Diagnostics Screen - Coming Soon!'), findsOneWidget);
  });
}
