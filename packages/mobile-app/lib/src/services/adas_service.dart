import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter/foundation.dart';
import 'package:gara_g_pilot/src/rust/api.dart' as rust_api;
import 'package:gara_g_pilot/src/services/ai_bridge.dart';

enum AdasRiskLevel { low, medium, high, critical }

enum AdasAlertSeverity { info, warning, emergency }

class AdasAlert {
  final String id;
  final AdasAlertSeverity severity;
  final String message;
  final String source;
  final int timestamp;

  AdasAlert({
    required this.id,
    required this.severity,
    required this.message,
    required this.source,
    required this.timestamp,
  });

  factory AdasAlert.fromJson(Map<String, dynamic> json) {
    return AdasAlert(
      id: json['id'],
      severity: _parseSeverity(json['severity']),
      message: json['message'],
      source: json['source'],
      timestamp: json['timestamp'],
    );
  }

  static AdasAlertSeverity _parseSeverity(String severity) {
    switch (severity.toLowerCase()) {
      case 'emergency':
        return AdasAlertSeverity.emergency;
      case 'warning':
        return AdasAlertSeverity.warning;
      case 'info':
      default:
        return AdasAlertSeverity.info;
    }
  }
}

class LaneState {
  final bool leftLaneVisible;
  final bool rightLaneVisible;
  final bool isDepartingLeft;
  final bool isDepartingRight;

  LaneState({
    this.leftLaneVisible = false,
    this.rightLaneVisible = false,
    this.isDepartingLeft = false,
    this.isDepartingRight = false,
  });
}

class AdasState {
  final List<Detection> detections;
  final LaneState laneState;
  final AdasRiskLevel riskLevel;
  final List<AdasAlert> activeAlerts;

  AdasState({
    required this.detections,
    required this.laneState,
    required this.riskLevel,
    required this.activeAlerts,
  });

  factory AdasState.initial() {
    return AdasState(
      detections: [],
      laneState: LaneState(),
      riskLevel: AdasRiskLevel.low,
      activeAlerts: [],
    );
  }
}

class AdasService {
  final AiBridge _aiBridge;

  AdasService(this._aiBridge);

  Future<AdasState> processFrame(Uint8List frameData) async {
    // 1. Run Vision Analysis
    final visionResult = await _aiBridge.analyzeVideoFrame(frameData);

    // 2. Feed Vision Analysis to Copilot Engine (Rust)
    // To avoid redundant inference, we use the already decoded result if we had a way
    // to pass it back to Rust. Since processCopilotCycle expects JSON, we'd have to
    // re-encode it.

    // Process cycle in Copilot Engine
    // final riskLevelJson = await rust_api.processCopilotCycle(
    //   visionAnalysisJson: jsonEncode({
    //     'detections': visionResult.detections.map((d) => {
    //       'label': d.label,
    //       'confidence': d.confidence,
    //       'bbox': d.bbox != null ? {
    //         'x': d.bbox!.x,
    //         'y': d.bbox!.y,
    //         'width': d.bbox!.width,
    //         'height': d.bbox!.height,
    //       } : null,
    //     }).toList(),
    //     'alerts': visionResult.alerts,
    //   })
    // );
    // final riskLevel = _parseRiskLevel(riskLevelJson);
    final riskLevel = AdasRiskLevel.low; // Fallback until bindings are updated

    // 3. Fetch any new alerts from Copilot Engine
    final List<AdasAlert> alerts = [];
    // String? alertJson;
    // while ((alertJson = await rust_api.getNextCopilotAlert()) != null) {
    //   alerts.add(AdasAlert.fromJson(jsonDecode(alertJson!)));
    // }

    // 4. Heuristic Lane Detection (Placeholder - in real app would be part of vision model)
    // For now, we simulate lane state based on detections or alerts
    final laneState = _inferLaneState(visionResult);

    return AdasState(
      detections: visionResult.detections,
      laneState: laneState,
      riskLevel: riskLevel,
      activeAlerts: alerts,
    );
  }

  AdasRiskLevel _parseRiskLevel(String jsonStr) {
    // Rust returns enum as string: "Low", "Medium", "High", "Critical"
    final clean = jsonStr.replaceAll('"', '').toLowerCase();
    switch (clean) {
      case 'medium':
        return AdasRiskLevel.medium;
      case 'high':
        return AdasRiskLevel.high;
      case 'critical':
        return AdasRiskLevel.critical;
      case 'low':
      default:
        return AdasRiskLevel.low;
    }
  }

  LaneState _inferLaneState(AiAnalysisResult vision) {
    bool departingLeft = false;
    bool departingRight = false;

    for (final alert in vision.alerts) {
      if (alert.toLowerCase().contains("lane departure left")) departingLeft = true;
      if (alert.toLowerCase().contains("lane departure right")) departingRight = true;
    }

    return LaneState(
      leftLaneVisible: true, // Mocked
      rightLaneVisible: true, // Mocked
      isDepartingLeft: departingLeft,
      isDepartingRight: departingRight,
    );
  }
}
