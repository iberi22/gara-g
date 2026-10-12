import 'package:flutter_test/flutter_test.dart';
import 'package:gara_g_pilot/src/services/dms_service.dart';
import 'package:gara_g_pilot/src/services/voice_safety_agent.dart';
import 'package:mockito/annotations.dart';

@GenerateNiceMocks([MockSpec<VoiceSafetyAgent>()])
import 'dms_test.mocks.dart';

void main() {
  late DmsService dmsService;
  late MockVoiceSafetyAgent mockVoiceAgent;

  setUp(() {
    mockVoiceAgent = MockVoiceSafetyAgent();
    dmsService = DmsService(mockVoiceAgent);
  });

  test('DmsStatus parsing from JSON with HeadPose and DmsSafetyEvent', () {
    final json = {
      'dms_status': {
        'ear_left': 0.15,
        'ear_right': 0.14,
        'mar': 0.6,
        'drowsiness_score': 0.85,
        'yawning_score': 0.6,
        'is_distracted': false,
        'is_drowsy': true,
        'is_yawning': true,
        'seatbelt_state': 'Buckled',
        'head_pose': {
          'pitch': 5.0,
          'yaw': 2.0,
          'roll': 0.0,
        }
      },
      'event': {
        'id': 'dms_drowsy_123456789',
        'event_type': 'drowsiness',
        'severity': 'Critical',
        'message': 'Critical Warning: Driver drowsiness detected! Wake up!',
        'timestamp': 123456789,
      }
    };

    final status = DmsStatus.fromJson(json);

    expect(status.isDrowsy, isTrue);
    expect(status.isYawning, isTrue);
    expect(status.earLeft, 0.15);
    expect(status.headPose['pitch'], 5.0);
    expect(status.event, isNotNull);
    expect(status.event!.severity, 'Critical');
    expect(status.event!.eventType, 'drowsiness');
  });

  test('DmsService status stream emits status on landmark processing', () async {
    expect(dmsService.statusStream, emits(isA<DmsStatus>()));
    await dmsService.processLandmarks([]);
  });
}
