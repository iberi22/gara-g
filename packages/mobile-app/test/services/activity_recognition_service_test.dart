import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:mockito/annotations.dart';
import 'package:mockito/mockito.dart';
import 'package:flutter_activity_recognition/flutter_activity_recognition.dart';
import 'package:gara_g_pilot/src/services/activity_recognition_service.dart';
import 'package:gara_g_pilot/src/models/user_activity_model.dart';
import 'package:permission_handler/permission_handler.dart';

void main() {
  group('ActivityRecognitionService', () {
    late ActivityRecognitionService service;

    setUp(() {
      service = ActivityRecognitionService();
    });

    tearDown(() {
      service.dispose();
    });

    test('Service can be instantiated', () {
      expect(service, isNotNull);
    });

    test('mapEventToActivity maps correctly', () {
      expect(service.mapEventToActivity(Activity(ActivityType.IN_VEHICLE, ActivityConfidence.HIGH)), UserActivity.IN_VEHICLE);
      expect(service.mapEventToActivity(Activity(ActivityType.STILL, ActivityConfidence.HIGH)), UserActivity.STILL);
      expect(service.mapEventToActivity(Activity(ActivityType.WALKING, ActivityConfidence.HIGH)), UserActivity.WALKING);
      expect(service.mapEventToActivity(Activity(ActivityType.RUNNING, ActivityConfidence.HIGH)), UserActivity.UNKNOWN);
      expect(service.mapEventToActivity(Activity(ActivityType.IN_VEHICLE, ActivityConfidence.LOW)), UserActivity.UNKNOWN);
    });
  });
}
