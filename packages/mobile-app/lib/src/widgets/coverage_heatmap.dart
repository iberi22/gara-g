import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:gara_g_pilot/src/rust/api.dart';
import 'package:latlong2/latlong.dart';

class CoverageHeatmap extends StatelessWidget {
  final List<HeatmapCell> cells;

  const CoverageHeatmap({
    super.key,
    required this.cells,
  });

  @override
  Widget build(BuildContext context) {
    // In a real implementation with H3, we would decode the h3_index to coordinates
    // For this simulation, we'll use the cells as approximate centers for visualization

    return PolygonLayer(
      polygons: cells.map((cell) {
        // Mock decoding: H3 indexes are complex, here we just use them to seed some positions
        // based on the simulated data from Rust.
        // For a real app, use a Dart H3 library or call back into Rust.

        final center = _mockH3ToLatLng(cell.h3Index);
        final weight = cell.weight;

        return Polygon(
          points: _calculateHexPoints(center, 0.005),
          color: Colors.greenAccent.withValues(alpha: weight * 0.5),
          borderStrokeWidth: 1,
          borderColor: Colors.greenAccent.withValues(alpha: 0.3),
        );
      }).toList(),
    );
  }

  LatLng _mockH3ToLatLng(String h3Index) {
    // This is a placeholder since we don't have a real H3 decoder here.
    // In Rust we generated them around 40.7128, -74.0060.
    // We'll parse the index if it was numeric, but it's a string from cell.to_string().
    // Just a dummy implementation for the visual effect.
    final hash = h3Index.hashCode;
    final lat = 40.7128 + ((hash % 100) - 50) * 0.001;
    final lon = -74.0060 + (((hash ~/ 100) % 100) - 50) * 0.001;
    return LatLng(lat, lon);
  }

  List<LatLng> _calculateHexPoints(LatLng center, double radius) {
    final points = <LatLng>[];
    for (var i = 0; i < 6; i++) {
      final angle = 2 * 3.14159 / 6 * i;
      points.add(LatLng(
        center.latitude + radius * 0.8 * (angle == 0 || angle == 3.14159 ? 1.0 : 0.8) * (3.14159 / 180) * (angle % 3.14159 == 0 ? 0 : (angle < 3.14159 ? 1 : -1)),
        center.longitude + radius * (angle % 3.14159 == 0 ? (angle == 0 ? 1 : -1) : 0.5) * (3.14159 / 180),
      ));
    }

    // Better hex calculation
    final res = <LatLng>[];
    for(int i=0; i<6; i++) {
        double x = center.longitude + radius * 1.5 * (3.14159/180) * (i == 0 ? 1 : (i == 3 ? -1 : (i == 1 || i == 2 ? 0.5 : -0.5)));
        double y = center.latitude + radius * (3.14159/180) * (i == 1 ? 1 : (i == 4 ? -1 : (i == 0 || i == 3 ? 0 : (i == 2 || i == 5 ? 0.866 : -0.866))));
        // Simplified but looks like a hex
        res.add(LatLng(center.latitude + radius * 0.01 * _sinDeg(i * 60), center.longitude + radius * 0.01 * _cosDeg(i * 60)));
    }

    return [
      LatLng(center.latitude + radius * 0.008, center.longitude),
      LatLng(center.latitude + radius * 0.004, center.longitude + radius * 0.007),
      LatLng(center.latitude - radius * 0.004, center.longitude + radius * 0.007),
      LatLng(center.latitude - radius * 0.008, center.longitude),
      LatLng(center.latitude - radius * 0.004, center.longitude - radius * 0.007),
      LatLng(center.latitude + radius * 0.004, center.longitude - radius * 0.007),
    ];
  }

  double _sinDeg(double deg) => 0.0; // dummy
  double _cosDeg(double deg) => 0.0; // dummy
}
