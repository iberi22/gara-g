import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gara_g_pilot/src/screens/obd_live_screen.dart';
import 'package:gara_g_pilot/src/screens/garage_screen.dart';

void main() {
  final mockVehicle = VehicleNft(
    tokenId: 1,
    name: 'Test Car',
    imageUrl: '',
    status: 'Active',
    mileage: 1000,
    hasDevice: true,
  );

  testWidgets('OBDLiveScreen shows connecting then data', (WidgetTester tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: OBDLiveScreen(vehicle: mockVehicle),
      ),
    );

    // Initial connecting state
    expect(find.text('Conectando a OBD-II...'), findsOneWidget);

    // Wait for mock connection (2s delay in code)
    await tester.pump(const Duration(seconds: 2));
    await tester.pump();

    // Verify gauges and metrics
    expect(find.text('RPM'), findsOneWidget);
    expect(find.text('Velocidad'), findsOneWidget);
    expect(find.text('Temp. Motor'), findsOneWidget);
    expect(find.text('Combustible'), findsOneWidget);

    // Verify record button
    expect(find.text('Grabar Sesión'), findsOneWidget);
  });
}
