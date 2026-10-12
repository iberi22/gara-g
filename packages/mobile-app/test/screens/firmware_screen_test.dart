import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gara_g_pilot/src/screens/firmware_screen.dart';
import 'package:gara_g_pilot/src/providers/depin_provider.dart';
import 'package:mockito/mockito.dart';
import 'package:provider/provider.dart';

class MockDepinProvider extends Mock implements DepinProvider {
  @override
  bool get isLoading => false;
  @override
  List<Map<String, dynamic>> get firmwareVersions => [];
  @override
  Future<void> loadFirmware() async {}

  @override
  void addListener(VoidCallback listener) {}
  @override
  void removeListener(VoidCallback listener) {}
}

void main() {
  testWidgets('FirmwareScreen shows version list', (WidgetTester tester) async {
    final mockProvider = MockDepinProvider();
    when(mockProvider.isLoading).thenReturn(false);
    when(mockProvider.firmwareVersions).thenReturn([
      {'version': '1.2.4', 'releaseDate': '2024-10-01', 'status': 'stable'},
      {'version': '1.2.5', 'releaseDate': '2024-10-20', 'critical': true},
    ]);

    await tester.pumpWidget(
      ChangeNotifierProvider<DepinProvider>.value(
        value: mockProvider,
        child: const MaterialApp(home: FirmwareScreen()),
      ),
    );

    expect(find.text('Version 1.2.4'), findsOneWidget);
    expect(find.text('Version 1.2.5'), findsOneWidget);
    expect(find.text('CRITICAL'), findsOneWidget);
    expect(find.text('DEPLOY TO NETWORK'), findsOneWidget);
    expect(find.text('CHECK FOR UPDATES'), findsOneWidget);
  });
}
