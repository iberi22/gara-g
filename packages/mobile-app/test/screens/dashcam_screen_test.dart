import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gara_g_pilot/src/screens/dashcam_screen.dart';
import 'package:gara_g_pilot/src/providers/adas_provider.dart';
import 'package:gara_g_pilot/src/services/adas_service.dart';
import 'package:provider/provider.dart';
import 'package:mockito/mockito.dart';

class MockAdasProvider extends Mock implements AdasProvider {
  @override
  AdasState get state => AdasState(
    riskLevel: AdasRiskLevel.low,
    laneState: LaneState(isDepartingLeft: false, isDepartingRight: false),
    activeAlerts: [],
    detections: [],
  );

  @override
  void addListener(VoidCallback listener) {}
  @override
  void removeListener(VoidCallback listener) {}
}

void main() {
  testWidgets('DashcamScreen shows initializing state', (WidgetTester tester) async {
    final mockAdasProvider = MockAdasProvider();

    await tester.pumpWidget(
      ChangeNotifierProvider<AdasProvider>.value(
        value: mockAdasProvider,
        child: const MaterialApp(
          home: DashcamScreen(),
        ),
      ),
    );

    // Should show "Initializing..." or similar because camera is not mocked yet
    expect(find.text('Initializing...'), findsWidgets);
  });
}
