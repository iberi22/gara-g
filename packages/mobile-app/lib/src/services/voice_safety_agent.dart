import 'dart:async';
import 'dart:collection';
import 'package:flutter_tts/flutter_tts.dart';
import 'package:vibration/vibration.dart';
import 'package:gara_g_pilot/src/rust/api.dart';
import 'package:gara_g_pilot/src/rust/frb_generated.dart';

/// Alert priority levels for the Voice Safety Agent
enum AlertPriority {
  low,      // Informational (e.g., "Fuel station ahead")
  medium,   // Warning (e.g., "Traffic slowdown ahead")
  high,     // Urgent (e.g., "Vehicle braking ahead")
  critical, // Emergency (e.g., "Collision warning!")
}

AlertPriority _parsePriority(String priority) {
  switch (priority.toLowerCase()) {
    case 'critical':
      return AlertPriority.critical;
    case 'high':
      return AlertPriority.high;
    case 'medium':
      return AlertPriority.medium;
    default:
      return AlertPriority.low;
  }
}

/// A safety alert to be announced
class SafetyAlert {
  final String message;
  final AlertPriority priority;
  final DateTime timestamp;
  final String? source; // "v2v", "ai", "sensor", "system"
  final bool vibrate;

  SafetyAlert({
    required this.message,
    required this.priority,
    DateTime? timestamp,
    this.source,
    bool? vibrate,
  }) : timestamp = timestamp ?? DateTime.now(),
       vibrate = vibrate ?? (priority.index >= AlertPriority.high.index);

  /// Get speech rate based on priority (faster = more urgent)
  double get speechRate {
    switch (priority) {
      case AlertPriority.low: return 0.45;
      case AlertPriority.medium: return 0.5;
      case AlertPriority.high: return 0.55;
      case AlertPriority.critical: return 0.6;
    }
  }

  /// Get speech pitch based on priority (higher = more urgent)
  double get speechPitch {
    switch (priority) {
      case AlertPriority.low: return 1.0;
      case AlertPriority.medium: return 1.0;
      case AlertPriority.high: return 1.1;
      case AlertPriority.critical: return 1.2;
    }
  }

  /// Get vibration pattern based on priority
  List<int> get vibrationPattern {
    switch (priority) {
      case AlertPriority.low: return [0, 100];
      case AlertPriority.medium: return [0, 200, 100, 200];
      case AlertPriority.high: return [0, 300, 100, 300, 100, 300];
      case AlertPriority.critical: return [0, 500, 100, 500, 100, 500, 100, 500];
    }
  }
}

/// Voice Safety Agent - Proactive voice alerts for driver safety
///
/// Features:
/// - Priority queue for alerts (higher priority interrupts lower)
/// - Text-to-Speech with configurable voice
/// - Haptic feedback for urgent alerts
/// - Rate limiting to prevent alert fatigue
/// - Cooldown for repeated alerts
class VoiceSafetyAgent {
  final FlutterTts _tts = FlutterTts();

  // Priority queue (highest priority first)
  final Queue<SafetyAlert> _alertQueue = Queue();

  // State
  bool _isInitialized = false;
  bool _isSpeaking = false;
  bool _isEnabled = true;
  SafetyAlert? _currentAlert;

  // Rate limiting
  final Map<String, DateTime> _lastAlertTime = {};
  static const Duration _minAlertInterval = Duration(seconds: 3);
  static const Duration _sameMessageCooldown = Duration(seconds: 10);

  // Stream for UI updates
  final _alertStreamController = StreamController<SafetyAlert>.broadcast();
  Stream<SafetyAlert> get alertStream => _alertStreamController.stream;

  // Callbacks
  Function(SafetyAlert)? onAlertStart;
  Function(SafetyAlert)? onAlertComplete;

  /// Initialize the TTS engine
  Future<void> initialize() async {
    if (_isInitialized) return;

    // Initialize Rust bridge
    await RustLib.init();

    // Listen to the Rust stream for voice alerts (if applicable)
    // For now, DMS alerts are triggered directly from DmsService via announce()

    // Configure TTS
    await _tts.setLanguage("en-US");
    await _tts.setSpeechRate(0.5);
    await _tts.setPitch(1.0);
    await _tts.setVolume(1.0);

    // Set up completion handler
    _tts.setCompletionHandler(() {
      _onSpeechComplete();
    });

    _tts.setErrorHandler((error) {
      print("TTS Error: $error");
      _isSpeaking = false;
      _processNextAlert();
    });

    _isInitialized = true;
  }

  /// Enable/disable the voice agent
  void setEnabled(bool enabled) {
    _isEnabled = enabled;
    if (!enabled) {
      _tts.stop();
      _alertQueue.clear();
      _isSpeaking = false;
    }
  }

  /// Queue a new safety alert
  Future<void> announce(SafetyAlert alert) async {
    if (!_isEnabled) return;
    if (!_isInitialized) await initialize();

    // Rate limiting - check if same message was announced recently
    final messageKey = alert.message.toLowerCase().trim();
    final lastTime = _lastAlertTime[messageKey];
    if (lastTime != null &&
        DateTime.now().difference(lastTime) < _sameMessageCooldown) {
      return; // Skip duplicate
    }

    // Check minimum interval between any alerts
    final anyLastTime = _lastAlertTime['_any_'];
    if (anyLastTime != null &&
        DateTime.now().difference(anyLastTime) < _minAlertInterval) {
      // Queue it for later if high priority, otherwise skip
      if (alert.priority.index >= AlertPriority.high.index) {
        _queueAlert(alert);
      }
      return;
    }

    // Critical alerts interrupt current speech
    if (alert.priority == AlertPriority.critical && _isSpeaking) {
      await _tts.stop();
      _isSpeaking = false;
    }

    // Add to queue and process
    _queueAlert(alert);
    _processNextAlert();
  }

  /// Queue alert by priority (higher priority at front)
  void _queueAlert(SafetyAlert alert) {
    // Simple insertion: critical goes to front, others to back
    if (alert.priority == AlertPriority.critical) {
      // Insert at front
      final temp = _alertQueue.toList();
      _alertQueue.clear();
      _alertQueue.add(alert);
      _alertQueue.addAll(temp);
    } else {
      _alertQueue.add(alert);
    }

    // Limit queue size
    while (_alertQueue.length > 5) {
      _alertQueue.removeLast();
    }
  }

  /// Process the next alert in queue
  Future<void> _processNextAlert() async {
    if (_isSpeaking || _alertQueue.isEmpty || !_isEnabled) return;

    final alert = _alertQueue.removeFirst();
    _currentAlert = alert;
    _isSpeaking = true;

    // Record timing
    _lastAlertTime[alert.message.toLowerCase().trim()] = DateTime.now();
    _lastAlertTime['_any_'] = DateTime.now();

    // Notify listeners
    _alertStreamController.add(alert);
    onAlertStart?.call(alert);

    // Haptic feedback for high priority
    if (alert.vibrate) {
      _triggerVibration(alert);
    }

    // Configure voice for this alert
    await _tts.setSpeechRate(alert.speechRate);
    await _tts.setPitch(alert.speechPitch);

    // Speak the alert
    await _tts.speak(alert.message);
  }

  /// Trigger vibration pattern
  Future<void> _triggerVibration(SafetyAlert alert) async {
    final hasVibrator = await Vibration.hasVibrator() ?? false;
    if (hasVibrator) {
      Vibration.vibrate(pattern: alert.vibrationPattern);
    }
  }

  /// Called when speech completes
  void _onSpeechComplete() {
    onAlertComplete?.call(_currentAlert!);
    _currentAlert = null;
    _isSpeaking = false;

    // Small delay before next alert
    Future.delayed(const Duration(milliseconds: 300), () {
      _processNextAlert();
    });
  }

  /// Convenience methods for common alerts

  void announceEmergencyBraking({String? vehicleInfo}) {
    announce(SafetyAlert(
      message: vehicleInfo != null
        ? "Warning! $vehicleInfo braking hard ahead!"
        : "Warning! Emergency braking ahead!",
      priority: AlertPriority.critical,
      source: "v2v",
    ));
  }

  void announceCollisionWarning({String? direction}) {
    announce(SafetyAlert(
      message: direction != null
        ? "Collision warning! Vehicle approaching from $direction!"
        : "Collision warning! Take evasive action!",
      priority: AlertPriority.critical,
      source: "sensor",
    ));
  }

  void announceTrafficSlowdown({int? distanceMeters}) {
    final distance = distanceMeters != null ? "$distanceMeters meters" : "ahead";
    announce(SafetyAlert(
      message: "Traffic slowing down $distance",
      priority: AlertPriority.medium,
      source: "v2v",
    ));
  }

  void announceHazard(String hazardType, {String? location}) {
    announce(SafetyAlert(
      message: location != null
        ? "$hazardType reported $location"
        : "$hazardType ahead, proceed with caution",
      priority: AlertPriority.high,
      source: "v2v",
    ));
  }

  void announceAiDetection(String detection) {
    announce(SafetyAlert(
      message: detection,
      priority: AlertPriority.high,
      source: "ai",
    ));
  }

  void announceInfo(String message) {
    announce(SafetyAlert(
      message: message,
      priority: AlertPriority.low,
      source: "system",
    ));
  }

  /// Stop all alerts
  Future<void> stop() async {
    await _tts.stop();
    _alertQueue.clear();
    _isSpeaking = false;
  }

  /// Dispose resources
  void dispose() {
    _tts.stop();
    _alertStreamController.close();
  }
}
