import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gara_g_pilot/src/services/dashcamService.dart';
import 'package:gara_g_pilot/src/widgets/dashcamHud.dart';

void main() {
  group('Yolov8Detector NMS Unit Tests', () {
    test('applyNms suppresses overlapping bounding boxes of same class', () {
      final detector = Yolov8Detector(nmsThreshold: 0.45);

      const box1 = Yolov8Detection(
        className: 'car',
        confidence: 0.90,
        x: 0.50,
        y: 0.50,
        width: 0.30,
        height: 0.30,
      );

      // Box 2 highly overlaps box 1 with lower confidence
      const box2 = Yolov8Detection(
        className: 'car',
        confidence: 0.80,
        x: 0.51,
        y: 0.51,
        width: 0.29,
        height: 0.29,
      );

      // Box 3 is non-overlapping pedestrian
      const box3 = Yolov8Detection(
        className: 'pedestrian',
        confidence: 0.85,
        x: 0.10,
        y: 0.10,
        width: 0.10,
        height: 0.20,
      );

      final detections = [box1, box2, box3];
      final result = detector.applyNms(detections);

      expect(result.length, equals(2));
      expect(result.any((d) => d.confidence == 0.90), isTrue);
      expect(result.any((d) => d.className == 'pedestrian'), isTrue);
      expect(result.any((d) => d.confidence == 0.80), isFalse);
    });

    test('calculateIou computes correct overlap area ratio', () {
      final detector = Yolov8Detector();

      const boxA = Yolov8Detection(
        className: 'car',
        confidence: 0.9,
        x: 0.0,
        y: 0.0,
        width: 0.5,
        height: 0.5,
      );

      const boxB = Yolov8Detection(
        className: 'car',
        confidence: 0.8,
        x: 0.25,
        y: 0.0,
        width: 0.5,
        height: 0.5,
      );

      final iou = detector.calculateIou(boxA, boxB);
      expect(iou, greaterThan(0.3));
      expect(iou, lessThan(0.4));
    });
  });

  group('LoopRecord Circular Buffer Limits', () {
    test('addChunk enforces maxChunksLimit by evicting oldest chunks', () {
      final config = const LoopRecordConfig(maxChunksLimit: 3, maxBytesLimit: 1000);
      final recorder = LoopRecord(config: config);

      recorder.addChunk(Uint8List.fromList([1, 1, 1]));
      recorder.addChunk(Uint8List.fromList([2, 2, 2]));
      recorder.addChunk(Uint8List.fromList([3, 3, 3]));
      expect(recorder.chunkCount, equals(3));

      // Adding 4th chunk evicts 1st
      final evicted = recorder.addChunk(Uint8List.fromList([4, 4, 4]));
      expect(evicted, equals(1));
      expect(recorder.chunkCount, equals(3));
      expect(recorder.chunks.first, equals(Uint8List.fromList([2, 2, 2])));
    });

    test('addChunk enforces maxBytesLimit by evicting oldest chunks', () {
      final config = const LoopRecordConfig(maxChunksLimit: 10, maxBytesLimit: 10);
      final recorder = LoopRecord(config: config);

      recorder.addChunk(Uint8List.fromList([1, 2, 3, 4])); // 4 bytes
      recorder.addChunk(Uint8List.fromList([5, 6, 7, 8])); // 4 bytes (total 8)
      expect(recorder.totalBytes, equals(8));

      // Adding 4 bytes brings total to 12 -> evicts 1st chunk (4 bytes), total becomes 8 bytes
      recorder.addChunk(Uint8List.fromList([9, 10, 11, 12]));
      expect(recorder.totalBytes, lessThanOrEqualTo(10));
      expect(recorder.chunkCount, equals(2));
    });
  });

  group('EventRecorder Emergency & Impact Detection', () {
    test('detectImpact triggers event when G-force magnitude exceeds threshold', () {
      final eventRecorder = EventRecorder(impactThresholdG: 2.5);

      // Normal gravity ~ 1.0G
      final normal = eventRecorder.detectImpact(0.0, 0.0, 1.0);
      expect(normal, isNull);

      // Impact event ~ 3.5G (Warning)
      final impactWarning = eventRecorder.detectImpact(2.0, 2.0, 2.0);
      expect(impactWarning, isNotNull);
      expect(impactWarning!.eventType, equals('IMPACT'));
      expect(impactWarning.severity, equals('WARNING'));

      // Critical impact ~ 5.0G
      final impactCritical = eventRecorder.detectImpact(3.0, 4.0, 0.0);
      expect(impactCritical, isNotNull);
      expect(impactCritical!.severity, equals('CRITICAL'));
    });

    test('detectMotion triggers event on inter-frame pixel changes', () {
      final eventRecorder = EventRecorder(motionThresholdPct: 0.05);

      final frame1 = Uint8List.fromList(List.filled(100, 10));
      final frame2 = Uint8List.fromList(List.filled(100, 200));

      final event1 = eventRecorder.detectMotion(frame1);
      expect(event1, isNull); // First frame initializes baseline

      final event2 = eventRecorder.detectMotion(frame2);
      expect(event2, isNotNull);
      expect(event2!.eventType, equals('MOTION'));
    });
  });

  group('NightModeProcessor Frame Enhancement', () {
    test('enhanceFrame boosts brightness and contrast when enabled', () {
      final processor = NightModeProcessor();
      final config = NightModeConfig(isEnabled: true, brightnessOffset: 30, contrastGain: 1.2);

      final darkFrame = Uint8List.fromList([10, 10, 10, 20, 20, 20]);
      final enhanced = processor.enhanceFrame(darkFrame, config);

      expect(enhanced.length, equals(darkFrame.length));
      expect(enhanced[0], greaterThan(darkFrame[0]));
      expect(enhanced[1], greaterThan(darkFrame[1]));
    });
  });

  group('DashcamHud Widget Tests', () {
    testWidgets('DashcamHud renders telemetry bar, indicators, and event banner', (WidgetTester tester) async {
      const detection = Yolov8Detection(
        className: 'car',
        confidence: 0.95,
        x: 0.2,
        y: 0.2,
        width: 0.4,
        height: 0.4,
      );

      const event = RecordingEvent(
        timestampMs: 1000,
        eventType: 'IMPACT',
        severity: 'CRITICAL',
        description: 'G-force impact 4.2G',
      );

      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: DashcamHud(
              detections: [detection],
              event: event,
              isRecording: true,
              isNightMode: true,
              speedKmh: 65.0,
              latitude: 37.7749,
              longitude: -122.4194,
            ),
          ),
        ),
      );

      expect(find.text('GARAG SENTINEL AI'), findsOneWidget);
      expect(find.text('IR NIGHT'), findsOneWidget);
      expect(find.text('REC'), findsOneWidget);
      expect(find.text('IMPACT EVENT (CRITICAL)'), findsOneWidget);
      expect(find.text('65 km/h'), findsOneWidget);
      expect(find.text('1 Obj'), findsOneWidget);
    });
  });
}
