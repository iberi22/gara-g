import 'package:flutter_test/flutter_test.dart';
import 'package:mockito/annotations.dart';
import 'package:mockito/mockito.dart';
import 'package:gara_g_pilot/src/services/dms_service.dart';
import 'package:gara_g_pilot/src/services/voice_safety_agent.dart';
import 'package:gara_g_pilot/src/services/seatbelt_service.dart';

import 'dms_service_test.mocks.dart';

@GenerateMocks([VoiceSafetyAgent, SeatbeltService])
void main() {
  group('DmsService', () {
    late MockVoiceSafetyAgent mockVoiceAgent;
    late MockSeatbeltService mockSeatbeltService;
    late DmsService dmsService;

    setUp(() {
      mockVoiceAgent = MockVoiceSafetyAgent();
      mockSeatbeltService = MockSeatbeltService();
      dmsService = DmsService(mockVoiceAgent, mockSeatbeltService);
    });

    test('processLandmarks triggers status stream', () async {
      expect(dmsService.statusStream, emits(isA<DmsStatus>()));
      await dmsService.processLandmarks([]);
    });

    test('checkAlerts triggers voice agent for drowsy', () {
      final status = DmsStatus(
        earLeft: 0.1,
        earRight: 0.1,
        mar: 0.2,
        drowsinessScore: 0.8,
        yawningScore: 0.0,
        isDistracted: false,
        isDrowsy: true,
        isYawning: false,
        seatbeltState: SeatbeltStatus.fastened,
        headPose: {'pitch': 0.0, 'yaw': 0.0, 'roll': 0.0},
        alerts: [],
      );

      dmsService.checkAlerts(status);

      verify(mockVoiceAgent.announce(argThat(predicate<SafetyAlert>((a) =>
        a.priority == AlertPriority.critical && a.message.contains('Drowsiness'))))).called(1);
    });

    test('checkAlerts triggers voice agent for distracted', () {
      final status = DmsStatus(
        earLeft: 0.3,
        earRight: 0.3,
        mar: 0.2,
        drowsinessScore: 0.1,
        yawningScore: 0.0,
        isDistracted: true,
        isDrowsy: false,
        isYawning: false,
        seatbeltState: SeatbeltStatus.fastened,
        headPose: {'pitch': 0.0, 'yaw': 0.0, 'roll': 0.0},
        alerts: [],
      );

      dmsService.checkAlerts(status);

      verify(mockVoiceAgent.announce(argThat(predicate<SafetyAlert>((a) =>
        a.priority == AlertPriority.high && a.message.contains('eyes on the road'))))).called(1);
    });
  });
}
