import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:mockito/annotations.dart';
import 'package:mockito/mockito.dart';
import 'package:gara_g_pilot/src/services/trip_service.dart';
import 'package:gara_g_pilot/src/services/activity_recognition_service.dart';
import 'package:gara_g_pilot/src/models/user_activity_model.dart';

import 'trip_service_test.mocks.dart';

@GenerateMocks([ActivityRecognitionService])
void main() {
  group('TripService', () {
    late MockActivityRecognitionService mockActivityService;
    late TripService tripService;
    late StreamController<UserActivity> activityController;

    setUp(() {
      mockActivityService = MockActivityRecognitionService();
      activityController = StreamController<UserActivity>.broadcast();
      when(mockActivityService.activityStream).thenAnswer((_) => activityController.stream);
      tripService = TripService(mockActivityService);
    });

    tearDown(() {
      activityController.close();
      tripService.dispose();
    });

    test('Initial state is Idle', () {
      expect(tripService.currentState, TripState.Idle);
    });

    test('Transition Idle -> Detecting -> Driving', () async {
      tripService.start();

      activityController.add(UserActivity.STILL);
      await Future.delayed(Duration.zero);
      expect(tripService.currentState, TripState.Detecting);

      activityController.add(UserActivity.IN_VEHICLE);
      await Future.delayed(Duration.zero);
      expect(tripService.currentState, TripState.Driving);
    });

    test('Transition Driving -> Stopped -> Idle', () async {
      tripService.start();

      // Force Driving state
      activityController.add(UserActivity.IN_VEHICLE);
      await Future.delayed(Duration.zero);
      expect(tripService.currentState, TripState.Driving);

      activityController.add(UserActivity.STILL);
      await Future.delayed(Duration.zero);
      expect(tripService.currentState, TripState.Stopped);

      activityController.add(UserActivity.WALKING);
      await Future.delayed(Duration.zero);
      expect(tripService.currentState, TripState.Idle);
    });

    test('Stop resets state to Idle', () {
      tripService.start();
      activityController.add(UserActivity.IN_VEHICLE);

      tripService.stop();
      expect(tripService.currentState, TripState.Idle);
      verify(mockActivityService.stopActivityMonitoring()).called(1);
    });
  });
}
