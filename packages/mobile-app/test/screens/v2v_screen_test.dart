import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gara_g_pilot/src/screens/v2v_screen.dart';
import 'package:gara_g_pilot/src/providers/v2v_provider.dart';
import 'package:gara_g_pilot/src/services/v2v_service.dart';
import 'package:mockito/mockito.dart';
import 'package:provider/provider.dart';

class MockV2VProvider extends Mock implements V2VProvider {
  @override
  bool get isActive => false;
  @override
  List<NearbyVehicle> get nearbyVehicles => [];
  @override
  int get messageCount => 0;
  @override
  Future<String> getFormattedPendingReward() async => '0 GARA';

  @override
  void addListener(VoidCallback listener) {}
  @override
  void removeListener(VoidCallback listener) {}
}

void main() {
  testWidgets('V2VScreen renders radar and buttons', (WidgetTester tester) async {
    final mockProvider = MockV2VProvider();
    when(mockProvider.isActive).thenReturn(false);
    when(mockProvider.nearbyVehicles).thenReturn([]);
    when(mockProvider.messageCount).thenReturn(0);
    when(mockProvider.getFormattedPendingReward()).thenAnswer((_) async => '10 GARA');

    await tester.pumpWidget(
      ChangeNotifierProvider<V2VProvider>.value(
        value: mockProvider,
        child: const MaterialApp(home: V2VScreen()),
      ),
    );

    expect(find.text('Gara-G V2V'), findsOneWidget);
    expect(find.text('Recompensas V2V'), findsOneWidget);
    expect(find.text('V2V desactivado'), findsOneWidget);

    // Quick actions
    expect(find.text('Peligro'), findsOneWidget);
    expect(find.text('Policía'), findsOneWidget);
    expect(find.text('SOS'), findsOneWidget);

    expect(find.text('Conectar'), findsOneWidget);
  });
}
