import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'package:flutter/foundation.dart';
import 'package:gara_g_pilot/src/services/voice_safety_agent.dart';

/// Seatbelt status enum matching Rust's SeatbeltStatus
enum SeatbeltStatus {
  fastened,
  unfastened,
  driverAbsent,
  unknown;

  bool get isFastened => this == SeatbeltStatus.fastened;
  bool get isUnfastened => this == SeatbeltStatus.unfastened;
  bool get isDriverAbsent => this == SeatbeltStatus.driverAbsent;

  static SeatbeltStatus fromString(String value) {
    switch (value.toLowerCase()) {
      case 'fastened':
        return SeatbeltStatus.fastened;
      case 'unfastened':
        return SeatbeltStatus.unfastened;
      case 'driverabsent':
        return SeatbeltStatus.driverAbsent;
      default:
        return SeatbeltStatus.unknown;
    }
  }
}

/// Alias for compatibility with other parts of the app if needed
typedef SeatbeltState = SeatbeltStatus;

/// Seatbelt data from Rust analysis
class SeatbeltData {
  final SeatbeltStatus status;
  final double confidence;
  final int timestamp;
  final bool alerted;

  SeatbeltData({
    required this.status,
    required this.confidence,
    required this.timestamp,
    this.alerted = false,
  });

  factory SeatbeltData.fromJson(Map<String, dynamic> json) {
    return SeatbeltData(
      status: SeatbeltStatus.fromString(json['status'] as String? ?? 'unknown'),
      confidence: (json['confidence'] as num?)?.toDouble() ?? 0.0,
      timestamp: (json['timestamp'] as num?)?.toInt() ?? 0,
      alerted: json['alerted'] as bool? ?? false,
    );
  }

  factory SeatbeltData.initial() {
    return SeatbeltData(
      status: SeatbeltStatus.unknown,
      confidence: 0.0,
      timestamp: DateTime.now().millisecondsSinceEpoch,
    );
  }
}

/// Service that handles seatbelt detection from pose keypoints.
///
/// Streams seatbelt status to listeners. Integrates with Rust's
/// SeatbeltDetector when keypoints are available, otherwise falls
/// back to the placeholder heuristic.
class SeatbeltService {
  final VoiceSafetyAgent? _voiceAgent;
  final _statusController = StreamController<SeatbeltData>.broadcast();
  SeatbeltData _currentStatus = SeatbeltData.initial();
  bool _isMonitoring = false;
  DateTime _lastUnbuckledAlert = DateTime.fromMillisecondsSinceEpoch(0);

  SeatbeltService([this._voiceAgent]);

  /// Stream of seatbelt status updates.
  Stream<SeatbeltData> get statusStream => _statusController.stream;

  /// Current seatbelt status.
  SeatbeltData get currentStatus => _currentStatus;

  /// Start monitoring seatbelt status.
  /// Invoke [processKeypoints] periodically with MediaPipe Pose data.
  void startMonitoring() {
    if (_isMonitoring) return;
    _isMonitoring = true;
    _currentStatus = SeatbeltData.initial();
    _statusController.add(_currentStatus);
    debugPrint('SeatbeltService: monitoring started');
  }

  /// Stop monitoring.
  void stopMonitoring() {
    if (!_isMonitoring) return;
    _isMonitoring = false;
    debugPrint('SeatbeltService: monitoring stopped');
  }

  /// Process a flattened list of MediaPipe Pose keypoints.
  Future<void> processKeypoints(List<double> keypoints) async {
    if (!_isMonitoring) return;

    try {
      final status = _analyzeWithHeuristic(keypoints);
      _updateStatus(status);
    } catch (e) {
      debugPrint('SeatbeltService: error processing keypoints: $e');
    }
  }

  void _updateStatus(SeatbeltData newData) {
    if (_currentStatus.status == newData.status &&
        (_currentStatus.confidence - newData.confidence).abs() < 0.05) return;

    final oldStatus = _currentStatus.status;
    _currentStatus = newData;
    _statusController.add(newData);

    if (newData.status == SeatbeltStatus.unfastened && oldStatus != SeatbeltStatus.unfastened) {
      _triggerAlert();
    }
  }

  void _triggerAlert() {
    if (_voiceAgent == null) return;

    final now = DateTime.now();
    // Cooldown for seatbelt alerts to avoid spamming
    if (now.difference(_lastUnbuckledAlert).inSeconds > 15) {
      _voiceAgent!.announce(SafetyAlert(
        message: "⚠️ Seatbelt unbuckled! Please fasten your seatbelt for your safety.",
        priority: AlertPriority.critical,
        source: "ai",
      ));
      _lastUnbuckledAlert = now;
    }
  }

  /// Heuristic seatbelt analysis on Dart side.
  SeatbeltData _analyzeWithHeuristic(List<double> keypoints) {
    final timestamp = DateTime.now().millisecondsSinceEpoch;

    // Need at least 25 keypoints (indices 0-24 valid)
    if (keypoints.length < 75) {
      return SeatbeltData(
        status: SeatbeltStatus.unknown,
        confidence: 0.0,
        timestamp: timestamp,
      );
    }

    double kp(int idx, int coord) => keypoints[idx * 3 + coord];

    final leftShoulder = (kp(11, 0), kp(11, 1), kp(11, 2));
    final rightShoulder = (kp(12, 0), kp(12, 1), kp(12, 2));
    final leftHip = (kp(23, 0), kp(23, 1), kp(23, 2));
    final rightHip = (kp(24, 0), kp(24, 1), kp(24, 2));

    if (!_isDriverPresent(leftShoulder, rightShoulder, leftHip, rightHip)) {
      return SeatbeltData(
        status: SeatbeltStatus.driverAbsent,
        confidence: 0.0,
        timestamp: timestamp,
      );
    }

    final confidence = _computeBeltConfidence(
      leftShoulder, rightShoulder, leftHip, rightHip, keypoints,
    );

    final status = confidence >= 0.45
        ? SeatbeltStatus.fastened
        : SeatbeltStatus.unfastened;

    return SeatbeltData(
      status: status,
      confidence: confidence,
      timestamp: timestamp,
    );
  }

  bool _isDriverPresent(
    (double, double, double) ls,
    (double, double, double) rs,
    (double, double, double) lh,
    (double, double, double) rh,
  ) {
    if (ls.$3 <= -0.5 && rs.$3 <= -0.5) return false;
    if (lh.$3 <= -0.5 && rh.$3 <= -0.5) return false;

    final shoulderMidY = (ls.$2 + rs.$2) / 2.0;
    final hipMidY = (lh.$2 + rh.$2) / 2.0;
    if ((hipMidY - shoulderMidY).abs() < 0.08) return false;

    if ((ls.$2 - rs.$2).abs() > 0.15) return false;

    return true;
  }

  double _computeBeltConfidence(
    (double, double, double) ls,
    (double, double, double) rs,
    (double, double, double) lh,
    (double, double, double) rh,
    List<double> keypoints,
  ) {
    final dx = lh.$1 - rs.$1;
    final dy = lh.$2 - rs.$2;
    final beltAngle = atan2(dy, dx).abs();
    const idealAngle = 0.7854;
    final angleScore = (1.0 - (beltAngle - idealAngle).abs() / idealAngle)
        .clamp(0.0, 1.0);

    final shoulderWidth = (rs.$1 - ls.$1).abs();
    final hipWidth = (rh.$1 - lh.$1).abs();
    final maxWidth = [shoulderWidth, hipWidth, 0.001].reduce((a, b) => a > b ? a : b);
    final horizontalSpan = (lh.$1 - rs.$1).abs() / maxWidth;
    final spanScore = (horizontalSpan / 2.0).clamp(0.0, 1.0);

    const numSamples = 8;
    var contrastSum = 0.0;

    for (var i = 0; i < numSamples; i++) {
      final t = (i + 1) / (numSamples + 1);
      final px = rs.$1 + t * dx;
      final py = rs.$2 + t * dy;

      var minDist = double.infinity;
      for (var j = 0; j < 33; j++) {
        if (j == 11 || j == 12 || j == 23 || j == 24) continue;
        final kpx = keypoints[j * 3];
        final kpy = keypoints[j * 3 + 1];
        final dist = ((kpx - px) * (kpx - px) + (kpy - py) * (kpy - py));
        if (dist < minDist) minDist = dist;
      }

      final sampleScore = minDist > 0.08 ? 1.0 : (minDist / 0.08).clamp(0.0, 1.0);
      contrastSum += sampleScore;
    }
    final contrastScore = contrastSum / numSamples;

    final shoulderMidZ = (ls.$3 + rs.$3) / 2.0;
    final hipMidZ = (lh.$3 + rh.$3) / 2.0;
    final zGradient = (hipMidZ - shoulderMidZ).abs();
    final zScore = (zGradient / 0.5).clamp(0.0, 1.0);

    return (0.35 * angleScore +
            0.25 * spanScore +
            0.25 * contrastScore +
            0.15 * zScore)
        .clamp(0.0, 1.0);
  }

  /// Process a raw Rust SeatbeltResult JSON string.
  void processRustResult(String jsonString) {
    try {
      final json = jsonDecode(jsonString) as Map<String, dynamic>;
      final data = SeatbeltData.fromJson(json);
      _updateStatus(data);
    } catch (e) {
      debugPrint('SeatbeltService: error parsing Rust result: $e');
    }
  }

  /// Reset to initial state.
  void reset() {
    _currentStatus = SeatbeltData.initial();
    _statusController.add(_currentStatus);
  }

  void dispose() {
    stopMonitoring();
    _statusController.close();
  }
}
