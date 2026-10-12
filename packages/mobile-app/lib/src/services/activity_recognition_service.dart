import 'dart:async';
import 'package:flutter_activity_recognition/flutter_activity_recognition.dart';
import '../models/user_activity_model.dart';
import 'package:permission_handler/permission_handler.dart';

class ActivityRecognitionService {
  final _activityController = StreamController<UserActivity>.broadcast();
  StreamSubscription<Activity>? _activitySubscription;

  Stream<UserActivity> get activityStream => _activityController.stream;

  Future<bool> requestPermission() async {
    var status = await Permission.activityRecognition.status;
    if (status.isDenied) {
      status = await Permission.activityRecognition.request();
    }
    return status.isGranted;
  }

  void startActivityMonitoring() async {
    if (_activitySubscription != null) {
      return; // Already monitoring
    }

    if (await requestPermission()) {
      _activitySubscription = FlutterActivityRecognition.instance.activityStream.listen((Activity activity) {
        _activityController.add(mapEventToActivity(activity));
      });
    } else {
      _activityController.addError('Activity recognition permission not granted.');
    }
  }

  void stopActivityMonitoring() {
    _activitySubscription?.cancel();
    _activitySubscription = null;
  }

  UserActivity mapEventToActivity(Activity activity) {
    if (activity.confidence == ActivityConfidence.LOW) {
      return UserActivity.UNKNOWN;
    }

    if (activity.type == ActivityType.IN_VEHICLE) {
      return UserActivity.IN_VEHICLE;
    } else if (activity.type == ActivityType.STILL) {
      return UserActivity.STILL;
    } else if (activity.type == ActivityType.WALKING) {
      return UserActivity.WALKING;
    } else {
      return UserActivity.UNKNOWN;
    }
  }

  void dispose() {
    stopActivityMonitoring();
    _activityController.close();
  }
}
