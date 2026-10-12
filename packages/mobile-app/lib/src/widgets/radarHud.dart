// ignore_for_file: file_names, deprecated_member_use

import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../services/radarService.dart';

/// Radar HUD Widget rendering nearby V2V virtual nodes with NearbyConnections
/// edge-mesh transport, color coding, hazard flags, and Yjs sync status.
class RadarHud extends StatefulWidget {
  final List<VirtualRadarNode> nodes;
  final String activeTransport;
  final double userHeading;
  final double maxRangeMeters;
  final bool isSyncing;
  final void Function(VirtualRadarNode)? onNodeTap;

  const RadarHud({
    super.key,
    this.nodes = const [],
    this.activeTransport = 'NearbyConnections',
    this.userHeading = 0.0,
    this.maxRangeMeters = 100.0,
    this.isSyncing = false,
    this.onNodeTap,
  });

  @override
  State<RadarHud> createState() => _RadarHudState();
}

class _RadarHudState extends State<RadarHud>
    with SingleTickerProviderStateMixin {
  late AnimationController _sweepController;

  @override
  void initState() {
    super.initState();
    _sweepController = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 4),
    )..repeat();
  }

  @override
  void dispose() {
    _sweepController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: const Color(0xFF0F172A),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: Colors.cyanAccent.withOpacity(0.3),
          width: 1.5,
        ),
      ),
      child: Column(
        children: [
          _buildHeaderBar(),
          Expanded(
            child: LayoutBuilder(
              builder: (context, constraints) {
                final size = math.min(constraints.maxWidth, constraints.maxHeight);
                return Center(
                  child: SizedBox(
                    width: size,
                    height: size,
                    child: Stack(
                      alignment: Alignment.center,
                      children: [
                        AnimatedBuilder(
                          animation: _sweepController,
                          builder: (context, child) {
                            return CustomPaint(
                              size: Size(size, size),
                              painter: RadarCanvasPainter(
                                nodes: widget.nodes,
                                maxRangeMeters: widget.maxRangeMeters,
                                sweepAngle: _sweepController.value * 2 * math.pi,
                                userHeading: widget.userHeading,
                              ),
                            );
                          },
                        ),
                        // Center vehicle indicator
                        Container(
                          width: 36,
                          height: 36,
                          decoration: BoxDecoration(
                            color: Colors.greenAccent,
                            shape: BoxShape.circle,
                            boxShadow: [
                              BoxShadow(
                                color: Colors.greenAccent.withOpacity(0.5),
                                blurRadius: 10,
                                spreadRadius: 2,
                              ),
                            ],
                          ),
                          child: const Icon(
                            Icons.navigation,
                            color: Colors.black,
                            size: 22,
                          ),
                        ),
                        // Overlay interactive node tap targets
                        ...widget.nodes.map((node) {
                          return _buildNodeTapTarget(node, size);
                        }),
                      ],
                    ),
                  ),
                );
              },
            ),
          ),
          _buildHazardSummaryBar(),
        ],
      ),
    );
  }

  Widget _buildHeaderBar() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: const BoxDecoration(
        color: Color(0xFF1E293B),
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Expanded(
            child: Row(
              children: [
                const Icon(
                  Icons.radar,
                  color: Colors.cyanAccent,
                  size: 20,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Radar HUD Virtual Nodes',
                    style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.bold,
                      fontSize: 14,
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: Colors.cyanAccent.withOpacity(0.15),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(
                    color: Colors.cyanAccent.withOpacity(0.4),
                  ),
                ),
                child: Text(
                  widget.activeTransport,
                  style: const TextStyle(
                    color: Colors.cyanAccent,
                    fontSize: 10,
                    fontWeight: FontWeight.w600,
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              const SizedBox(width: 8),
              Icon(
                widget.isSyncing ? Icons.sync : Icons.cloud_done,
                color: widget.isSyncing ? Colors.amberAccent : Colors.greenAccent,
                size: 16,
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildNodeTapTarget(VirtualRadarNode node, double canvasSize) {
    final radius = canvasSize / 2;
    final clampedDist = math.min(node.distanceMeters, widget.maxRangeMeters);
    final normalizedDist = (clampedDist / widget.maxRangeMeters) * (radius - 24);

    final angleRad = (node.bearingDegrees - 90) * (math.pi / 180);
    final dx = radius + normalizedDist * math.cos(angleRad) - 16;
    final dy = radius + normalizedDist * math.sin(angleRad) - 16;

    return Positioned(
      left: dx,
      top: dy,
      child: GestureDetector(
        onTap: () {
          if (widget.onNodeTap != null) {
            widget.onNodeTap!(node);
          }
        },
        child: Container(
          width: 32,
          height: 32,
          color: Colors.transparent,
        ),
      ),
    );
  }

  Widget _buildHazardSummaryBar() {
    final hazardNodes =
        widget.nodes.where((n) => n.hazardFlags.isNotEmpty).toList();

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      decoration: const BoxDecoration(
        color: Color(0xFF1E293B),
        borderRadius: BorderRadius.vertical(bottom: Radius.circular(16)),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Expanded(
            child: Row(
              children: [
                const Icon(
                  Icons.warning_amber_rounded,
                  color: Colors.amberAccent,
                  size: 18,
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    'Active Hazard Flags: ${hazardNodes.length}',
                    style: const TextStyle(
                      color: Colors.white70,
                      fontSize: 12,
                      fontWeight: FontWeight.w500,
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Text(
            'Nodes Nearby: ${widget.nodes.length}',
            style: const TextStyle(
              color: Colors.cyanAccent,
              fontSize: 12,
              fontWeight: FontWeight.bold,
            ),
          ),
        ],
      ),
    );
  }
}

/// Canvas Painter for drawing radar concentric circles, sweep line, and virtual node markers
class RadarCanvasPainter extends CustomPainter {
  final List<VirtualRadarNode> nodes;
  final double maxRangeMeters;
  final double sweepAngle;
  final double userHeading;

  RadarCanvasPainter({
    required this.nodes,
    required this.maxRangeMeters,
    required this.sweepAngle,
    required this.userHeading,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final maxRadius = size.width / 2;

    // Background circle grid
    final gridPaint = Paint()
      ..color = Colors.cyanAccent.withOpacity(0.15)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.0;

    const ringCount = 4;
    for (int i = 1; i <= ringCount; i++) {
      final ringRadius = (maxRadius / ringCount) * i;
      canvas.drawCircle(center, ringRadius, gridPaint);

      // Ring distance text label
      final distanceText = '${((maxRangeMeters / ringCount) * i).toInt()}m';
      final textPainter = TextPainter(
        text: TextSpan(
          text: distanceText,
          style: TextStyle(
            color: Colors.cyanAccent.withOpacity(0.5),
            fontSize: 9,
          ),
        ),
        textDirection: TextDirection.ltr,
      )..layout();
      textPainter.paint(
        canvas,
        Offset(center.dx + 4, center.dy - ringRadius + 2),
      );
    }

    // Crosshairs
    final crosshairPaint = Paint()
      ..color = Colors.cyanAccent.withOpacity(0.1)
      ..strokeWidth = 1.0;
    canvas.drawLine(
      Offset(center.dx, 0),
      Offset(center.dx, size.height),
      crosshairPaint,
    );
    canvas.drawLine(
      Offset(0, center.dy),
      Offset(size.width, center.dy),
      crosshairPaint,
    );

    // Rotating sweep line
    final sweepGradient = SweepGradient(
      center: Alignment.center,
      startAngle: sweepAngle - 0.5,
      endAngle: sweepAngle,
      colors: [
        Colors.cyanAccent.withOpacity(0.0),
        Colors.cyanAccent.withOpacity(0.25),
      ],
    );

    final sweepPaint = Paint()
      ..shader = sweepGradient.createShader(
        Rect.fromCircle(center: center, radius: maxRadius),
      );

    canvas.drawArc(
      Rect.fromCircle(center: center, radius: maxRadius),
      sweepAngle - 0.5,
      0.5,
      true,
      sweepPaint,
    );

    // Render virtual nodes
    for (final node in nodes) {
      final clampedDist = math.min(node.distanceMeters, maxRangeMeters);
      final normalizedDist = (clampedDist / maxRangeMeters) * (maxRadius - 24);

      // Convert bearing degrees to canvas radians (0 deg = UP)
      final angleRad = (node.bearingDegrees - 90) * (math.pi / 180);
      final nodePos = Offset(
        center.dx + normalizedDist * math.cos(angleRad),
        center.dy + normalizedDist * math.sin(angleRad),
      );

      final color = node.nodeColor;

      // Glow effect for node
      final glowPaint = Paint()
        ..color = color.withOpacity(0.4)
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 6);
      canvas.drawCircle(nodePos, 8, glowPaint);

      // Core node dot
      final nodePaint = Paint()
        ..color = color
        ..style = PaintingStyle.fill;
      canvas.drawCircle(nodePos, 5, nodePaint);

      // Hazard badge indicator
      if (node.hazardFlags.isNotEmpty) {
        final hazardRingPaint = Paint()
          ..color = Colors.redAccent
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1.5;
        canvas.drawCircle(nodePos, 9, hazardRingPaint);
      }

      // Node label
      final labelSpan = TextSpan(
        text: '${node.name}\n${node.distanceMeters.toStringAsFixed(0)}m',
        style: const TextStyle(
          color: Colors.white,
          fontSize: 9,
          fontWeight: FontWeight.bold,
          height: 1.1,
        ),
      );
      final labelPainter = TextPainter(
        text: labelSpan,
        textAlign: TextAlign.center,
        textDirection: TextDirection.ltr,
      )..layout();

      labelPainter.paint(
        canvas,
        Offset(
          nodePos.dx - (labelPainter.width / 2),
          nodePos.dy + 8,
        ),
      );
    }
  }

  @override
  bool shouldRepaint(covariant RadarCanvasPainter oldDelegate) {
    return oldDelegate.sweepAngle != sweepAngle ||
        oldDelegate.nodes != nodes ||
        oldDelegate.maxRangeMeters != maxRangeMeters;
  }
}
