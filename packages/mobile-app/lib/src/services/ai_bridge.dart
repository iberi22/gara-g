import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'package:gara_g_pilot/src/rust/api.dart';

/// AI Analysis result from Rust backend
class AiAnalysisResult {
  final List<Detection> detections;
  final List<AudioEvent> events;
  final List<String> alerts;
  final String processingMode;

  AiAnalysisResult({
    required this.detections,
    required this.events,
    required this.alerts,
    required this.processingMode,
  });

  factory AiAnalysisResult.fromJson(Map<String, dynamic> json) {
    return AiAnalysisResult(
      detections: (json['detections'] as List? ?? [])
          .map((d) => Detection.fromJson(d))
          .toList(),
      events: (json['events'] as List? ?? [])
          .map((e) => AudioEvent.fromJson(e))
          .toList(),
      alerts: (json['alerts'] as List? ?? []).cast<String>(),
      processingMode: json['processing_mode'] ?? 'unknown',
    );
  }

  bool get hasAlerts => alerts.isNotEmpty;
  bool get hasHighConfidenceDetections =>
      detections.any((d) => d.confidence > 0.7);
}

/// Object detection result
class Detection {
  final String label;
  final double confidence;
  final BoundingBox? bbox;

  Detection({
    required this.label,
    required this.confidence,
    this.bbox,
  });

  factory Detection.fromJson(Map<String, dynamic> json) {
    return Detection(
      label: json['label'] ?? '',
      confidence: (json['confidence'] as num?)?.toDouble() ?? 0.0,
      bbox: json['bbox'] != null ? BoundingBox.fromJson(json['bbox']) : null,
    );
  }
}

/// Bounding box for detected objects
class BoundingBox {
  final double x;
  final double y;
  final double width;
  final double height;

  BoundingBox({
    required this.x,
    required this.y,
    required this.width,
    required this.height,
  });

  factory BoundingBox.fromJson(Map<String, dynamic> json) {
    return BoundingBox(
      x: (json['x'] as num?)?.toDouble() ?? 0.0,
      y: (json['y'] as num?)?.toDouble() ?? 0.0,
      width: (json['width'] as num?)?.toDouble() ?? 0.0,
      height: (json['height'] as num?)?.toDouble() ?? 0.0,
    );
  }
}

/// Audio event detection result
class AudioEvent {
  final String label;
  final double confidence;
  final int timestampMs;
  final bool isAlert;

  AudioEvent({
    required this.label,
    required this.confidence,
    required this.timestampMs,
    required this.isAlert,
  });

  factory AudioEvent.fromJson(Map<String, dynamic> json) {
    return AudioEvent(
      label: json['label'] ?? '',
      confidence: (json['confidence'] as num?)?.toDouble() ?? 0.0,
      timestampMs: json['timestamp_ms'] ?? 0,
      isAlert: json['is_alert'] ?? false,
    );
  }
}

/// Bridge to Rust AI processing engine
class AiBridge {
  // Stream controllers for real-time alerts
  final _alertController = StreamController<String>.broadcast();
  final _detectionController = StreamController<Detection>.broadcast();

  /// Stream of alerts (glass break, crash, etc.)
  Stream<String> get alertStream => _alertController.stream;

  /// Stream of object detections
  Stream<Detection> get detectionStream => _detectionController.stream;

  /// Analyze a video frame for objects and threats
  Future<AiAnalysisResult> analyzeVideoFrame(Uint8List frameData) async {
    try {
      final resultJson = await analyzeFrame(frameData: frameData);
      final result = AiAnalysisResult.fromJson(jsonDecode(resultJson));

      // Emit alerts to stream
      for (final alert in result.alerts) {
        _alertController.add(alert);
      }

      // Emit high-confidence detections
      for (final detection in result.detections) {
        if (detection.confidence > 0.6) {
          _detectionController.add(detection);
        }
      }

      return result;
    } catch (e) {
      return AiAnalysisResult(
        detections: [],
        events: [],
        alerts: ['Error: $e'],
        processingMode: 'error',
      );
    }
  }

  /// Analyze audio buffer for safety events
  Future<AiAnalysisResult> analyzeAudioBuffer(Uint8List audioData) async {
    try {
      final resultJson = await analyzeAudio(audioData: audioData);
      final result = AiAnalysisResult.fromJson(jsonDecode(resultJson));

      // Emit alerts to stream
      for (final alert in result.alerts) {
        _alertController.add(alert);
      }

      return result;
    } catch (e) {
      return AiAnalysisResult(
        detections: [],
        events: [],
        alerts: ['Audio Error: $e'],
        processingMode: 'error',
      );
    }
  }

  /// Enable external API for complex analysis (requires user consent)
  /// Note: Requires flutter_rust_bridge regeneration after Rust API update
  Future<void> enableExternalApi(String apiKey) async {
    // TODO: Call Rust function after regenerating bindings
    // await enableAiExternalApi(apiKey: apiKey);
    _externalApiKey = apiKey;
  }

  String? _externalApiKey;

  /// Disable external API
  Future<void> disableExternalApi() async {
    // TODO: Call Rust function after regenerating bindings
    // await disableAiExternalApi();
    _externalApiKey = null;
  }

  /// Dispose resources
  void dispose() {
    _alertController.close();
    _detectionController.close();
  }
}
