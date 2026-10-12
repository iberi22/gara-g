import 'dart:async';
import 'package:flutter/material.dart';
import 'package:gara_g_pilot/src/services/seatbelt_service.dart';

/// Semi-transparent overlay widget that shows the current seatbelt status.
///
/// Features:
/// - Fastened → green checkmark icon
/// - Unfastened → red icon with pulsing animation
/// - DriverAbsent → grey icon
/// - Unknown → amber/yellow icon
class SeatbeltIndicator extends StatefulWidget {
  /// Stream of seatbelt data to display.
  final Stream<SeatbeltData> seatbeltStream;

  /// Position from the edge (default: top-right corner).
  final Alignment alignment;

  const SeatbeltIndicator({
    super.key,
    required this.seatbeltStream,
    this.alignment = Alignment.topRight,
  });

  @override
  State<SeatbeltIndicator> createState() => _SeatbeltIndicatorState();
}

class _SeatbeltIndicatorState extends State<SeatbeltIndicator>
    with SingleTickerProviderStateMixin {
  late SeatbeltData _currentData;
  StreamSubscription? _subscription;

  // Pulse animation for unfastened state
  late AnimationController _pulseController;
  late Animation<double> _pulseAnimation;

  // Scale animation for state changes
  late AnimationController _scaleController;
  late Animation<double> _scaleAnimation;

  @override
  void initState() {
    super.initState();

    _currentData = SeatbeltData.initial();

    // Pulse animation (for unfastened alert)
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 800),
    );
    _pulseAnimation = Tween<double>(begin: 1.0, end: 1.3).animate(
      CurvedAnimation(parent: _pulseController, curve: Curves.easeInOut),
    );

    // Scale animation for state transitions
    _scaleController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 300),
    );
    _scaleAnimation = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(parent: _scaleController, curve: Curves.elasticOut),
    );

    // Start scale-in animation
    _scaleController.forward();

    // Listen to the seatbelt stream
    _subscription = widget.seatbeltStream.listen(_onSeatbeltUpdate);

    // Start pulse if unfastened
    if (_currentData.status == SeatbeltStatus.unfastened) {
      _pulseController.repeat(reverse: true);
    }
  }

  void _onSeatbeltUpdate(SeatbeltData data) {
    if (!mounted) return;

    setState(() {
      final prevStatus = _currentData.status;
      _currentData = data;

      // Play scale animation on status change
      if (data.status != prevStatus) {
        _scaleController.reset();
        _scaleController.forward();
      }

      // Control pulse animation
      if (data.status == SeatbeltStatus.unfastened) {
        _pulseController.repeat(reverse: true);
      } else {
        _pulseController.stop();
        _pulseController.reset();
      }
    });
  }

  @override
  void dispose() {
    _subscription?.cancel();
    _pulseController.dispose();
    _scaleController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _pulseAnimation,
      builder: (context, child) {
        return Transform.scale(
          scale: _pulseAnimation.value * _scaleAnimation.value,
          child: _buildIndicator(),
        );
      },
    );
  }

  Widget _buildIndicator() {
    switch (_currentData.status) {
      case SeatbeltStatus.fastened:
        return _buildContainer(
          backgroundColor: Colors.green.withValues(alpha: 0.6),
          icon: Icons.check_circle,
          iconColor: Colors.greenAccent,
          label: 'Cinturón',
          sublabel: 'Abrochado',
          confidence: _currentData.confidence,
        );
      case SeatbeltStatus.unfastened:
        return _buildContainer(
          backgroundColor: Colors.red.withValues(alpha: 0.7),
          icon: Icons.warning_amber_rounded,
          iconColor: Colors.redAccent,
          label: '¡CINTURÓN!',
          sublabel: 'Desabrochado',
          confidence: _currentData.confidence,
          urgent: true,
        );
      case SeatbeltStatus.driverAbsent:
        return _buildContainer(
          backgroundColor: Colors.grey.withValues(alpha: 0.5),
          icon: Icons.person_outline,
          iconColor: Colors.grey[400]!,
          label: 'Conductor',
          sublabel: 'Ausente',
          confidence: _currentData.confidence,
        );
      case SeatbeltStatus.unknown:
        return _buildContainer(
          backgroundColor: Colors.amber.withValues(alpha: 0.5),
          icon: Icons.help_outline,
          iconColor: Colors.amberAccent,
          label: 'Cinturón',
          sublabel: 'Verificando...',
          confidence: _currentData.confidence,
        );
    }
  }

  Widget _buildContainer({
    required Color backgroundColor,
    required IconData icon,
    required Color iconColor,
    required String label,
    required String sublabel,
    required double confidence,
    bool urgent = false,
  }) {
    return Container(
      margin: const EdgeInsets.all(8),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: backgroundColor,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: urgent ? Colors.redAccent : Colors.white24,
          width: urgent ? 2.0 : 1.0,
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, color: iconColor, size: 22),
          const SizedBox(width: 6),
          Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: TextStyle(
                  color: iconColor,
                  fontSize: 12,
                  fontWeight: urgent ? FontWeight.bold : FontWeight.w600,
                ),
              ),
              Text(
                sublabel,
                style: TextStyle(
                  color: Colors.white.withValues(alpha: 0.8),
                  fontSize: 10,
                ),
              ),
            ],
          ),
          if (confidence > 0)
            Padding(
              padding: const EdgeInsets.only(left: 6),
              child: Text(
                '${(confidence * 100).toStringAsFixed(0)}%',
                style: TextStyle(
                  color: Colors.white.withValues(alpha: 0.6),
                  fontSize: 10,
                ),
              ),
            ),
        ],
      ),
    );
  }
}
