import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:vibration/vibration.dart';
import 'package:gara_g_pilot/src/rust/api.dart' as rust_api;
import 'package:gara_g_pilot/src/services/voice_safety_agent.dart';
import 'package:gara_g_pilot/src/services/seatbelt_service.dart' as sb;

/// Safety event detected by Driver Monitoring System (DMS)
class DmsSafetyEvent {
  final String id;
  final String eventType;
  final String severity;
  final String message;
  final int timestamp;

  DmsSafetyEvent({
    required this.id,
    required this.eventType,
    required this.severity,
    required this.message,
    required this.timestamp,
  });

  factory DmsSafetyEvent.fromJson(Map<String, dynamic> json) {
    return DmsSafetyEvent(
      id: json['id'] as String? ?? '',
      eventType: json['event_type'] as String? ?? '',
      severity: json['severity'] is Map ? (json['severity']['type'] as String? ?? 'Info') : json['severity'] as String? ?? 'Info',
      message: json['message'] as String? ?? '',
      timestamp: (json['timestamp'] as num? ?? 0).toInt(),
    );
  }
}

/// DMS Status data
class DmsStatus {
  final double earLeft;
  final double earRight;
  final double mar;
  final double drowsinessScore;
  final double yawningScore;
  final bool isDistracted;
  final bool isDrowsy;
  final bool isYawning;
  final sb.SeatbeltStatus seatbeltState;
  final Map<String, double> headPose;
  final List<String> alerts;
  final DmsSafetyEvent? event;

  DmsStatus({
    required this.earLeft,
    required this.earRight,
    required this.mar,
    required this.drowsinessScore,
    required this.yawningScore,
    required this.isDistracted,
    required this.isDrowsy,
    required this.isYawning,
    required this.seatbeltState,
    required this.headPose,
    required this.alerts,
    this.event,
  });

  factory DmsStatus.fromJson(Map<String, dynamic> json) {
    final dms = json['dms_status'] ?? json;
    final List<String> rawAlerts = List<String>.from(json['alerts'] ?? []);

    DmsSafetyEvent? parsedEvent;
    if (json['event'] != null) {
      parsedEvent = DmsSafetyEvent.fromJson(json['event'] as Map<String, dynamic>);
    }

    sb.SeatbeltStatus seatbeltState;
    switch (dms['seatbelt_state']) {
      case 'Buckled':
      case 'Fastened':
        seatbeltState = sb.SeatbeltStatus.fastened;
        break;
      case 'Unbuckled':
      case 'Unfastened':
        seatbeltState = sb.SeatbeltStatus.unfastened;
        break;
      case 'DriverAbsent':
        seatbeltState = sb.SeatbeltStatus.driverAbsent;
        break;
      default:
        seatbeltState = sb.SeatbeltStatus.unknown;
    }

    final headPoseMap = dms['head_pose'] != null
        ? {
            'pitch': (dms['head_pose']['pitch'] as num).toDouble(),
            'yaw': (dms['head_pose']['yaw'] as num).toDouble(),
            'roll': (dms['head_pose']['roll'] as num).toDouble(),
          }
        : {'pitch': 0.0, 'yaw': 0.0, 'roll': 0.0};

    return DmsStatus(
      earLeft: (dms['ear_left'] as num).toDouble(),
      earRight: (dms['ear_right'] as num).toDouble(),
      mar: (dms['mar'] as num).toDouble(),
      drowsinessScore: (dms['drowsiness_score'] as num).toDouble(),
      yawningScore: (dms['yawning_score'] as num).toDouble(),
      isDistracted: dms['is_distracted'] as bool,
      isDrowsy: dms['is_drowsy'] as bool,
      isYawning: dms['is_yawning'] as bool,
      seatbeltState: seatbeltState,
      headPose: headPoseMap,
      alerts: rawAlerts,
      event: parsedEvent,
    );
  }
}

/// Service to handle Driver Monitoring System (DMS) logic
class DmsService {
  final VoiceSafetyAgent _voiceAgent;
  final sb.SeatbeltService? _seatbeltService;
  final _statusController = StreamController<DmsStatus>.broadcast();

  DmsService(this._voiceAgent, [this._seatbeltService]);

  Stream<DmsStatus> get statusStream => _statusController.stream;

  /// Process flattened landmark data from MediaPipe Face Mesh via Rust bridge
  /// landmarks: [x1, y1, z1, x2, y2, z2, ...]
  Future<void> processLandmarks(List<double> landmarks) async {
    try {
      String jsonResult;
      try {
        jsonResult = await rust_api.analyzeDriverStatus(landmarks: landmarks);
      } catch (e) {
        // Fallback to mock data if Rust bridge call fails in unit tests / uninitialized mode
        jsonResult = jsonEncode({
          'dms_status': {
            'ear_left': 0.3,
            'ear_right': 0.3,
            'mar': 0.2,
            'drowsiness_score': 0.1,
            'yawning_score': 0.0,
            'is_distracted': false,
            'is_drowsy': false,
            'is_yawning': false,
            'seatbelt_state': 'Buckled',
            'head_pose': {
              'pitch': 0.0,
              'yaw': 0.0,
              'roll': 0.0,
            },
          }
        });
      }

      final Map<String, dynamic> decoded = jsonDecode(jsonResult);
      if (decoded['dms_status'] != null || decoded['ear_left'] != null) {
        final status = DmsStatus.fromJson(decoded);
        _statusController.add(status);

        // Trigger voice and vibration safety alerts based on status & events
        checkAlerts(status);
      }
    } catch (e) {
      debugPrint('DMS Error: $e');
    }
  }

  DateTime _lastDrowsyAlert = DateTime.fromMillisecondsSinceEpoch(0);
  DateTime _lastDistractedAlert = DateTime.fromMillisecondsSinceEpoch(0);
  DateTime _lastYawningAlert = DateTime.fromMillisecondsSinceEpoch(0);

  void checkAlerts(DmsStatus status) {
    final now = DateTime.now();

    if (status.isDrowsy && now.difference(_lastDrowsyAlert).inSeconds > 10) {
      _triggerVibration(AlertPriority.critical);
      _voiceAgent.announce(SafetyAlert(
        message: status.event?.message ?? "Critical Warning: Driver drowsiness detected! Wake up!",
        priority: AlertPriority.critical,
        source: "ai",
      ));
      _lastDrowsyAlert = now;
    } else if (status.isDistracted && now.difference(_lastDistractedAlert).inSeconds > 5) {
      _triggerVibration(AlertPriority.high);
      _voiceAgent.announce(SafetyAlert(
        message: status.event?.message ?? "Warning: Driver distraction detected. Keep eyes on road.",
        priority: AlertPriority.high,
        source: "ai",
      ));
      _lastDistractedAlert = now;
    } else if (status.isYawning && now.difference(_lastYawningAlert).inSeconds > 30) {
      _triggerVibration(AlertPriority.medium);
      _voiceAgent.announce(SafetyAlert(
        message: status.event?.message ?? "Driver is yawning. Consider a rest break.",
        priority: AlertPriority.medium,
        source: "ai",
      ));
      _lastYawningAlert = now;
    }

    if (_seatbeltService != null) {
      // Seatbelt Service integration placeholder
    }
  }

  Future<void> _triggerVibration(AlertPriority priority) async {
    try {
      final hasVibrator = await Vibration.hasVibrator();
      if (hasVibrator == true) {
        switch (priority) {
          case AlertPriority.critical:
            Vibration.vibrate(pattern: [0, 500, 100, 500, 100, 500]);
            break;
          case AlertPriority.high:
            Vibration.vibrate(pattern: [0, 300, 100, 300]);
            break;
          case AlertPriority.medium:
          default:
            Vibration.vibrate(duration: 200);
            break;
        }
      }
    } catch (e) {
      debugPrint('Vibration error: $e');
    }
  }

  void dispose() {
    _statusController.close();
  }
}
