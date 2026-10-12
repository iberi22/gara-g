import 'package:flutter/material.dart';
import '../services/dashcamService.dart';

/// HUD Overlay widget for Dashcam AI displaying bounding boxes,
/// telemetry, status indicators, and emergency event banners.
class DashcamHud extends StatelessWidget {
  final List<Yolov8Detection> detections;
  final RecordingEvent? event;
  final bool isRecording;
  final bool isNightMode;
  final double speedKmh;
  final double latitude;
  final double longitude;
  final Widget? child;

  const DashcamHud({
    super.key,
    this.detections = const [],
    this.event,
    this.isRecording = false,
    this.isNightMode = false,
    this.speedKmh = 0.0,
    this.latitude = 0.0,
    this.longitude = 0.0,
    this.child,
  });

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        if (child != null) ...[child!],
        Positioned.fill(
          child: CustomPaint(
            painter: _HudBoundingBoxPainter(detections: detections),
          ),
        ),
        SafeArea(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              _buildTopBar(),
              if (event != null) _buildEventBanner(event!),
              _buildBottomTelemetryBar(),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildTopBar() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      margin: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: Colors.black.withValues(alpha: 0.6),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Colors.greenAccent.withValues(alpha: 0.5)),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          const Text(
            'GARAG SENTINEL AI',
            style: TextStyle(
              color: Colors.greenAccent,
              fontWeight: FontWeight.bold,
              fontSize: 14,
              letterSpacing: 1.2,
            ),
          ),
          Row(
            children: [
              if (isNightMode)
                Container(
                  margin: const EdgeInsets.only(right: 8),
                  padding:
                      const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: Colors.indigoAccent,
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: const Text(
                    'IR NIGHT',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 10,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              if (isRecording)
                Row(
                  children: const [
                    Icon(Icons.fiber_manual_record,
                        color: Colors.redAccent, size: 14),
                    SizedBox(width: 4),
                    Text(
                      'REC',
                      style: TextStyle(
                        color: Colors.redAccent,
                        fontWeight: FontWeight.bold,
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildEventBanner(RecordingEvent event) {
    final isCritical = event.severity == 'CRITICAL';
    final bgColor = isCritical
        ? Colors.red.withValues(alpha: 0.85)
        : Colors.orange.withValues(alpha: 0.85);

    return Container(
      width: double.infinity,
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      decoration: BoxDecoration(
        color: bgColor,
        borderRadius: BorderRadius.circular(8),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.3),
            blurRadius: 6,
          ),
        ],
      ),
      child: Row(
        children: [
          Icon(
            isCritical ? Icons.warning : Icons.info,
            color: Colors.white,
            size: 24,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  '${event.eventType} EVENT (${event.severity})',
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.bold,
                    fontSize: 12,
                  ),
                ),
                Text(
                  event.description,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 11,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildBottomTelemetryBar() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      margin: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: Colors.black.withValues(alpha: 0.6),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceAround,
        children: [
          _telemetryItem(
            Icons.speed,
            '${speedKmh.toStringAsFixed(0)} km/h',
          ),
          _telemetryItem(
            Icons.location_on,
            '${latitude.toStringAsFixed(4)}, ${longitude.toStringAsFixed(4)}',
          ),
          _telemetryItem(
            Icons.remove_red_eye,
            '${detections.length} Obj',
          ),
        ],
      ),
    );
  }

  Widget _telemetryItem(IconData icon, String label) {
    return Row(
      children: [
        Icon(icon, color: Colors.greenAccent, size: 16),
        const SizedBox(width: 4),
        Text(
          label,
          style: const TextStyle(color: Colors.white, fontSize: 12),
        ),
      ],
    );
  }
}

class _HudBoundingBoxPainter extends CustomPainter {
  final List<Yolov8Detection> detections;

  _HudBoundingBoxPainter({required this.detections});

  @override
  void paint(Canvas canvas, Size size) {
    final boxPaint = Paint()
      ..color = Colors.redAccent
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.0;

    final bgPaint = Paint()..color = Colors.redAccent.withValues(alpha: 0.8);

    const textStyle = TextStyle(
      color: Colors.white,
      fontSize: 10,
      fontWeight: FontWeight.bold,
    );

    for (final det in detections) {
      final rect = Rect.fromLTWH(
        det.x * size.width,
        det.y * size.height,
        det.width * size.width,
        det.height * size.height,
      );

      canvas.drawRect(rect, boxPaint);

      final label =
          '${det.className} ${(det.confidence * 100).toStringAsFixed(0)}%';
      final textSpan = TextSpan(text: label, style: textStyle);
      final textPainter = TextPainter(
        text: textSpan,
        textDirection: TextDirection.ltr,
      )..layout();

      final labelBgRect = Rect.fromLTWH(
        rect.left,
        rect.top > 16 ? rect.top - 16 : rect.top,
        textPainter.width + 8,
        textPainter.height + 4,
      );

      canvas.drawRect(labelBgRect, bgPaint);
      textPainter.paint(
        canvas,
        Offset(labelBgRect.left + 4, labelBgRect.top + 2),
      );
    }
  }

  @override
  bool shouldRepaint(covariant _HudBoundingBoxPainter oldDelegate) {
    return oldDelegate.detections != detections;
  }
}
