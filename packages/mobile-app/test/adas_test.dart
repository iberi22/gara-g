import 'package:flutter_test/flutter_test.dart';
import 'package:gara_g_pilot/src/services/adas_service.dart';
import 'package:gara_g_pilot/src/providers/adas_provider.dart';
import 'dart:typed_data';

class FakeAdasService implements AdasService {
  int processFrameCalled = 0;
  late AdasState nextState;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  @override
  Future<AdasState> processFrame(Uint8List frameData) async {
    processFrameCalled++;
    return nextState;
  }
}

void main() {
  group('AdasProvider', () {
    late AdasProvider adasProvider;
    late FakeAdasService fakeAdasService;

    setUp(() {
      fakeAdasService = FakeAdasService();
      adasProvider = AdasProvider(fakeAdasService);
    });

    test('initial state is correct', () {
      expect(adasProvider.state.riskLevel, AdasRiskLevel.low);
      expect(adasProvider.state.detections, isEmpty);
      expect(adasProvider.state.activeAlerts, isEmpty);
      expect(adasProvider.isProcessing, isFalse);
    });

    test('updateFromFrame throttles updates', () async {
      final frameData = Uint8List(0);
      fakeAdasService.nextState = AdasState(
        detections: [],
        laneState: LaneState(),
        riskLevel: AdasRiskLevel.low,
        activeAlerts: [],
      );

      // We need to wait for the throttle period to expire from the provider's creation
      // Or we can just wait 200ms
      await Future.delayed(const Duration(milliseconds: 250));

      // First update
      await adasProvider.updateFromFrame(frameData);
      expect(adasProvider.state.riskLevel, AdasRiskLevel.low);
      expect(fakeAdasService.processFrameCalled, 1);

      // Immediate second update (should be throttled)
      await adasProvider.updateFromFrame(frameData);
      expect(fakeAdasService.processFrameCalled, 1);
    });
  });
}
