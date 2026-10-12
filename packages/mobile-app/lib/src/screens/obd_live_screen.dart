import 'dart:async';
import 'package:flutter/material.dart';
import 'package:gara_g_pilot/src/screens/garage_screen.dart';
import 'package:gara_g_pilot/src/rust/api.dart';

class OBDLiveScreen extends StatefulWidget {
  final VehicleNft vehicle;

  const OBDLiveScreen({super.key, required this.vehicle});

  @override
  State<OBDLiveScreen> createState() => _OBDLiveScreenState();
}

class _OBDLiveScreenState extends State<OBDLiveScreen> {
  bool _isConnected = false;
  Map<String, dynamic> _liveData = {};
  Timer? _refreshTimer;

  @override
  void initState() {
    super.initState();
    _connectToOBD();
  }

  @override
  void dispose() {
    _refreshTimer?.cancel();
    super.dispose();
  }

  Future<void> _connectToOBD() async {
    // TODO: Implement actual OBD connection
    await Future.delayed(const Duration(seconds: 2));
    setState(() {
      _isConnected = true;
      _startLiveUpdates();
    });
  }

  void _startLiveUpdates() {
    _refreshTimer = Timer.periodic(const Duration(milliseconds: 500), (_) {
      _fetchLiveData();
    });
  }

  Future<void> _fetchLiveData() async {
    // TODO: Read actual OBD data via BLE
    // Mock data for demo
    setState(() {
      _liveData = {
        'rpm': 2500 + (DateTime.now().millisecond % 500),
        'speed': 65 + (DateTime.now().second % 10),
        'coolant_temp': 90,
        'fuel_level': 68,
        'engine_load': 45 + (DateTime.now().millisecond % 20),
        'intake_temp': 35,
        'throttle': 30 + (DateTime.now().millisecond % 30),
        'oil_temp': 95,
      };
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0D0D1A),
      appBar: AppBar(
        title: const Text('📊 OBD en Vivo'),
        backgroundColor: Colors.transparent,
        actions: [
          Icon(
            _isConnected ? Icons.bluetooth_connected : Icons.bluetooth_disabled,
            color: _isConnected ? Colors.greenAccent : Colors.redAccent,
          ),
          const SizedBox(width: 16),
        ],
      ),
      body: _isConnected ? _buildDashboard() : _buildConnecting(),
    );
  }

  Widget _buildConnecting() {
    return const Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          CircularProgressIndicator(color: Colors.greenAccent),
          SizedBox(height: 24),
          Text('Conectando a OBD-II...', style: TextStyle(color: Colors.white70, fontSize: 18)),
          SizedBox(height: 8),
          Text('Asegúrate de que el dispositivo esté encendido', style: TextStyle(color: Colors.white38)),
        ],
      ),
    );
  }

  Widget _buildDashboard() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        children: [
          // Main Gauges Row
          Row(
            children: [
              Expanded(child: _buildGauge('RPM', _liveData['rpm']?.toDouble() ?? 0, 8000, 'rpm', Colors.redAccent)),
              const SizedBox(width: 16),
              Expanded(child: _buildGauge('Velocidad', _liveData['speed']?.toDouble() ?? 0, 200, 'km/h', Colors.blueAccent)),
            ],
          ),
          const SizedBox(height: 16),

          // Secondary Metrics Grid
          GridView.count(
            crossAxisCount: 2,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            crossAxisSpacing: 12,
            mainAxisSpacing: 12,
            childAspectRatio: 1.8,
            children: [
              _buildMetricCard('Temp. Motor', '${_liveData['coolant_temp'] ?? 0}°C', Icons.thermostat, Colors.orange),
              _buildMetricCard('Combustible', '${_liveData['fuel_level'] ?? 0}%', Icons.local_gas_station, Colors.amber),
              _buildMetricCard('Carga Motor', '${_liveData['engine_load'] ?? 0}%', Icons.speed, Colors.purple),
              _buildMetricCard('Temp. Aceite', '${_liveData['oil_temp'] ?? 0}°C', Icons.opacity, Colors.brown),
              _buildMetricCard('Temp. Admisión', '${_liveData['intake_temp'] ?? 0}°C', Icons.air, Colors.cyan),
              _buildMetricCard('Acelerador', '${_liveData['throttle'] ?? 0}%', Icons.sync, Colors.green),
            ],
          ),
          const SizedBox(height: 24),

          // Record button
          SizedBox(
            width: double.infinity,
            child: ElevatedButton.icon(
              onPressed: _startRecording,
              icon: const Icon(Icons.fiber_manual_record),
              label: const Text('Grabar Sesión'),
              style: ElevatedButton.styleFrom(
                backgroundColor: Colors.redAccent,
                padding: const EdgeInsets.symmetric(vertical: 16),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildGauge(String label, double value, double max, String unit, Color color) {
    final percentage = (value / max).clamp(0.0, 1.0);
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A2E),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        children: [
          SizedBox(
            height: 120,
            width: 120,
            child: Stack(
              alignment: Alignment.center,
              children: [
                CircularProgressIndicator(
                  value: percentage,
                  strokeWidth: 12,
                  backgroundColor: color.withOpacity(0.2),
                  valueColor: AlwaysStoppedAnimation(color),
                ),
                Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      value.toInt().toString(),
                      style: TextStyle(color: color, fontSize: 28, fontWeight: FontWeight.bold),
                    ),
                    Text(unit, style: TextStyle(color: Colors.white.withOpacity(0.5), fontSize: 12)),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          Text(label, style: const TextStyle(color: Colors.white70, fontSize: 14)),
        ],
      ),
    );
  }

  Widget _buildMetricCard(String label, String value, IconData icon, Color color) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A2E),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: color.withOpacity(0.2),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Icon(icon, color: color, size: 24),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(value, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
                Text(label, style: TextStyle(color: Colors.white.withOpacity(0.5), fontSize: 11)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  void _startRecording() {
    // TODO: Implement session recording
  }
}
