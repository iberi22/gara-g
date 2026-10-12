import 'dart:async';
import '../models/user_activity_model.dart';
import 'activity_recognition_service.dart';

class TripService {
  final ActivityRecognitionService _activityRecognitionService;
  final _tripStateController = StreamController<TripState>.broadcast();
  StreamSubscription<UserActivity>? _activitySubscription;
  TripState _currentState = TripState.Idle;

  TripService(this._activityRecognitionService);

  Stream<TripState> get tripStateStream => _tripStateController.stream;
  TripState get currentState => _currentState;

  void start() {
    if (_activitySubscription != null) {
      return; // Already started
    }

    _activitySubscription = _activityRecognitionService.activityStream.listen((activity) {
      _updateTripState(activity);
    });
    _activityRecognitionService.startActivityMonitoring();
  }

  void stop() {
    _activitySubscription?.cancel();
    _activitySubscription = null;
    _activityRecognitionService.stopActivityMonitoring();
    _updateTripState(UserActivity.UNKNOWN, forceStop: true);
  }

  void _updateTripState(UserActivity activity, {bool forceStop = false}) {
    if (forceStop) {
      _currentState = TripState.Idle;
    } else {
      switch (_currentState) {
        case TripState.Idle:
          if (activity == UserActivity.IN_VEHICLE) {
            _currentState = TripState.Driving;
          } else {
            _currentState = TripState.Detecting;
          }
          break;
        case TripState.Detecting:
          if (activity == UserActivity.IN_VEHICLE) {
            _currentState = TripState.Driving;
          }
          break;
        case TripState.Driving:
          if (activity != UserActivity.IN_VEHICLE) {
            _currentState = TripState.Stopped;
          }
          break;
        case TripState.Stopped:
          if (activity == UserActivity.IN_VEHICLE) {
            _currentState = TripState.Driving;
          } else {
            _currentState = TripState.Idle;
          }
          break;
      }
    }
    _tripStateController.add(_currentState);
  }

  void dispose() {
    stop();
    _tripStateController.close();
  }
}
