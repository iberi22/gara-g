import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mockito/mockito.dart';
import 'package:provider/provider.dart';
import 'package:gara_g_pilot/src/screens/dashcam_screen.dart';
import 'package:gara_g_pilot/src/screens/v2v_screen.dart';
import 'package:gara_g_pilot/src/providers/adas_provider.dart';
import 'package:gara_g_pilot/src/providers/v2v_provider.dart';
import 'package:gara_g_pilot/src/services/adas_service.dart';
import 'package:gara_g_pilot/src/services/v2v_service.dart';
import 'helpers/mocks.mocks.dart';

void main() {
  late MockAdasProvider mockAdasProvider;
  late MockV2VProvider mockV2VProvider;

  setUp(() {
    mockAdasProvider = MockAdasProvider();
    mockV2VProvider = MockV2VProvider();

    // Default ADAS state
    when(mockAdasProvider.state).thenReturn(AdasState(
      detections: [],
      laneState: LaneState(),
      riskLevel: AdasRiskLevel.low,
      activeAlerts: [],
    ));

    // Default V2V state
    when(mockV2VProvider.isActive).thenReturn(false);
    when(mockV2VProvider.nearbyVehicles).thenReturn([]);
    when(mockV2VProvider.getFormattedPendingReward()).thenAnswer((_) async => "0 GARA");
    when(mockV2VProvider.messageCount).thenReturn(0);
  });

  Widget createTestWidget(Widget child) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider<AdasProvider>.value(value: mockAdasProvider),
        ChangeNotifierProvider<V2VProvider>.value(value: mockV2VProvider),
      ],
      child: MaterialApp(
        theme: ThemeData.dark(),
        home: child,
      ),
    );
  }

  group('DashcamScreen Golden Tests', () {
    testWidgets('DashcamScreen - Initial State', (tester) async {
      await tester.pumpWidget(createTestWidget(const DashcamScreen()));
      await tester.pump();
      await expectLater(
        find.byType(DashcamScreen),
        matchesGoldenFile('goldens/dashcam_idle.png'),
      );
    });
  });

  group('V2VScreen Golden Tests', () {
    testWidgets('V2VScreen - Disconnected', (tester) async {
      when(mockV2VProvider.isActive).thenReturn(false);
      when(mockV2VProvider.nearbyVehicles).thenReturn([]);

      await tester.pumpWidget(createTestWidget(const V2VScreen()));
      await tester.pump();
      await expectLater(
        find.byType(V2VScreen),
        matchesGoldenFile('goldens/v2v_disconnected.png'),
      );
    });

    testWidgets('V2VScreen - Connected with vehicles', (tester) async {
      when(mockV2VProvider.isActive).thenReturn(true);
      final vehicles = [
        NearbyVehicle(
          endpointId: '1',
          deviceName: 'Toyota Corolla',
          discoveredAt: DateTime.now(),
          isConnected: true,
        ),
        NearbyVehicle(
          endpointId: '2',
          deviceName: 'Sentinel Node',
          discoveredAt: DateTime.now(),
          isConnected: true,
          isSentinel: true,
        ),
      ];
      when(mockV2VProvider.nearbyVehicles).thenReturn(vehicles);
      when(mockV2VProvider.getUnreadCount(any)).thenReturn(0);

      await tester.pumpWidget(createTestWidget(const V2VScreen()));
      await tester.pump();
      await expectLater(
        find.byType(V2VScreen),
        matchesGoldenFile('goldens/v2v_connected.png'),
      );
    });
  });
}
