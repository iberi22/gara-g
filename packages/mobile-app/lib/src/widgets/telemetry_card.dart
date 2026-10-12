import 'package:flutter/material.dart';
import 'package:gara_g_pilot/src/rust/api.dart';

class TelemetryCard extends StatelessWidget {
  final TelemetryDisplayData data;
  final bool showDetailed;
  final VoidCallback? onTap;

  const TelemetryCard({
    super.key,
    required this.data,
    this.showDetailed = false,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Card(
        color: const Color(0xFF16213E).withOpacity(0.9),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: BorderSide(
            color: _getStatusColor(data.accuracy).withOpacity(0.5),
            width: 1,
          ),
        ),
        child: Padding(
          padding: const EdgeInsets.all(16.0),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  _buildStat(
                    label: 'VELOCIDAD',
                    value: '${data.speed.toStringAsFixed(1)} km/h',
                    icon: Icons.speed,
                    color: Colors.blueAccent,
                  ),
                  _buildStat(
                    label: 'RUMBO',
                    value: '${data.heading.toStringAsFixed(0)}°',
                    icon: Icons.explore,
                    color: Colors.orangeAccent,
                  ),
                ],
              ),
              if (showDetailed) ...[
                const Divider(color: Colors.white24, height: 24),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    _buildStat(
                      label: 'ALTITUD',
                      value: '${data.altitude.toStringAsFixed(0)} m',
                      icon: Icons.height,
                      color: Colors.purpleAccent,
                    ),
                    _buildStat(
                      label: 'PRECISIÓN',
                      value: '${data.accuracy.toStringAsFixed(1)} m',
                      icon: Icons.gps_fixed,
                      color: _getStatusColor(data.accuracy),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    _buildStat(
                      label: 'BATERÍA',
                      value: '${data.battery.toStringAsFixed(0)}%',
                      icon: Icons.battery_charging_full,
                      color: data.battery > 20 ? Colors.greenAccent : Colors.redAccent,
                    ),
                    _buildStat(
                      label: 'SEÑAL',
                      value: '${data.signal.toStringAsFixed(0)}/5',
                      icon: Icons.signal_cellular_alt,
                      color: data.signal > 2 ? Colors.greenAccent : Colors.orangeAccent,
                    ),
                  ],
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildStat({
    required String label,
    required String value,
    required IconData icon,
    required Color color,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Icon(icon, size: 14, color: Colors.white70),
            const SizedBox(width: 4),
            Text(
              label,
              style: const TextStyle(
                color: Colors.white70,
                fontSize: 10,
                fontWeight: FontWeight.bold,
              ),
            ),
          ],
        ),
        const SizedBox(height: 4),
        Text(
          value,
          style: TextStyle(
            color: color,
            fontSize: 18,
            fontWeight: FontWeight.bold,
          ),
        ),
      ],
    );
  }

  Color _getStatusColor(double accuracy) {
    if (accuracy < 10) return Colors.greenAccent;
    if (accuracy < 30) return Colors.yellowAccent;
    return Colors.redAccent;
  }
}
