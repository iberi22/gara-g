import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:gara_g_pilot/src/rust/api.dart';
import 'package:gara_g_pilot/src/widgets/telemetry_card.dart';
import 'package:gara_g_pilot/src/widgets/coverage_heatmap.dart';

class MapScreen extends StatefulWidget {
  const MapScreen({super.key});

  @override
  State<MapScreen> createState() => _MapScreenState();
}

class _MapScreenState extends State<MapScreen> {
  final MapController _mapController = MapController();
  List<HeatmapCell> _heatmapCells = [];
  TelemetryDisplayData? _latestTelemetry;
  Timer? _updateTimer;
  List<LatLng> _routePoints = [];

  @override
  void initState() {
    super.initState();
    _loadHeatmapData();
    _startTelemetryUpdates();
  }

  @override
  void dispose() {
    _updateTimer?.cancel();
    super.dispose();
  }

  Future<void> _loadHeatmapData() async {
    final cells = await getHeatmapData();
    setState(() {
      _heatmapCells = cells;
    });
  }

  void _startTelemetryUpdates() {
    _updateTimer = Timer.periodic(const Duration(seconds: 2), (timer) async {
      final data = await getLatestTelemetry();
      setState(() {
        _latestTelemetry = data;
        // Mock movement around NYC
        final newPoint = LatLng(
          40.7128 + (_routePoints.length * 0.001),
          -74.0060 + (_routePoints.length * 0.0005),
        );
        _routePoints.add(newPoint);
        _mapController.move(newPoint, _mapController.camera.zoom);
      });
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Stack(
        children: [
          FlutterMap(
            mapController: _mapController,
            options: MapOptions(
              initialCenter: const LatLng(40.7128, -74.0060),
              initialZoom: 14.0,
            ),
            children: [
              TileLayer(
                urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                userAgentPackageName: 'com.gara.gpilot',
              ),
              if (_heatmapCells.isNotEmpty)
                CoverageHeatmap(cells: _heatmapCells),
              PolylineLayer(
                polylines: [
                  Polyline(
                    points: _routePoints,
                    strokeWidth: 4.0,
                    color: Colors.blueAccent,
                  ),
                ],
              ),
              MarkerLayer(
                markers: [
                  if (_routePoints.isNotEmpty)
                    Marker(
                      point: _routePoints.last,
                      width: 40,
                      height: 40,
                      child: const Icon(
                        Icons.navigation,
                        color: Colors.redAccent,
                        size: 40,
                      ),
                    ),
                ],
              ),
            ],
          ),

          // HUD - Telemetry Card
          if (_latestTelemetry != null)
            Positioned(
              bottom: 20,
              left: 20,
              right: 20,
              child: TelemetryCard(
                data: _latestTelemetry!,
                showDetailed: true,
              ),
            ),

          // Back button
          Positioned(
            top: 40,
            left: 20,
            child: CircleAvatar(
              backgroundColor: Colors.black54,
              child: IconButton(
                icon: const Icon(Icons.arrow_back, color: Colors.white),
                onPressed: () => Navigator.pop(context),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
