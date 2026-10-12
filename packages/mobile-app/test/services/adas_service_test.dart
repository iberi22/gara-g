import 'dart:typed_data';
import 'package:flutter_test/flutter_test.dart';
import 'package:mockito/annotations.dart';
import 'package:mockito/mockito.dart';
import 'package:gara_g_pilot/src/services/adas_service.dart';
import 'package:gara_g_pilot/src/services/ai_bridge.dart';

import 'adas_service_test.mocks.dart';

@GenerateMocks([AiBridge])
void main() {
  group('AdasService', () {
    late MockAiBridge mockAiBridge;
    late AdasService adasService;

    setUp(() {
      mockAiBridge = MockAiBridge();
      adasService = AdasService(mockAiBridge);
    });

    test('processFrame returns AdasState based on AiAnalysisResult', () async {
      final frameData = Uint8List(10);
      final mockAnalysis = AiAnalysisResult(
        detections: [
          Detection(label: 'car', confidence: 0.9, bbox: BoundingBox(x: 0, y: 0, width: 100, height: 100)),
        ],
        events: [],
        alerts: ['Lane departure left'],
        processingMode: 'normal',
      );

      when(mockAiBridge.analyzeVideoFrame(any)).thenAnswer((_) async => mockAnalysis);

      final state = await adasService.processFrame(frameData);

      expect(state.detections.length, 1);
      expect(state.detections[0].label, 'car');
      expect(state.laneState.isDepartingLeft, isTrue);
      expect(state.laneState.isDepartingRight, isFalse);
      expect(state.riskLevel, AdasRiskLevel.low); // Default currently
    });

    test('AdasAlert.fromJson parses severity correctly', () {
      final json = {
        'id': '1',
        'severity': 'Emergency',
        'message': 'Brake!',
        'source': 'test',
        'timestamp': 100
      };
      final alert = AdasAlert.fromJson(json);
      expect(alert.severity, AdasAlertSeverity.emergency);
    });

    test('Initial AdasState is correct', () {
      final initial = AdasState.initial();
      expect(initial.riskLevel, AdasRiskLevel.low);
      expect(initial.detections, isEmpty);
    });
  });
}
