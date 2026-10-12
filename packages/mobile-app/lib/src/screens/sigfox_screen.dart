import 'dart:async';
import 'package:flutter/material.dart';
import '../services/sigfox_service.dart';

/// Sigfox IoT Device Monitor Screen
/// Shows Sigfox-connected devices and their telemetry data
class SigfoxScreen extends StatefulWidget {
  const SigfoxScreen({super.key});

  @override
  State<SigfoxScreen> createState() => _SigfoxScreenState();
}

class _SigfoxScreenState extends State<SigfoxScreen>
    with SingleTickerProviderStateMixin {
  final SigfoxService _sigfoxService = SigfoxService(
    baseUrl: 'https://gara-g.swal.network',
    organizationId: 'org_1',
  );

  late TabController _tabController;
  List<dynamic> _devices = [];
  List<dynamic> _messages = [];
  bool _isLoading = true;
  String? _error;
  String? _selectedRegion;
  Timer? _refreshTimer;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _loadData();

    // Auto-refresh every 30 seconds for real-time data
    _refreshTimer = Timer.periodic(const Duration(seconds: 30), (_) {
      _loadData();
    });
  }

  @override
  void dispose() {
    _tabController.dispose();
    _refreshTimer?.cancel();
    super.dispose();
  }

  Future<void> _loadData() async {
    try {
      final results = await Future.wait([
        _sigfoxService.listDevices(),
        _sigfoxService.getRecentMessages(),
      ]);

      setState(() {
        _devices = results[0]['data'] as List<dynamic>;
        _messages = results[1]['data'] as List<dynamic>;
        _isLoading = false;
        _error = null;
      });
    } catch (e) {
      setState(() {
        _error = e.toString();
        _isLoading = false;
      });
    }
  }

  String _formatMessagePayload(dynamic message) {
    final data = message['data'];
    if (data == null) return 'Unknown';

    switch (data['type']) {
      case 'GpsHeartbeat':
        return '📍 ${data['position']['lat'].toStringAsFixed(4)}, ${data['position']['lng'].toStringAsFixed(4)}';
      case 'VehicleStatus':
        return '🚗 Battery: ${data['battery_percent']}% | Speed: ${data['speed']} km/h';
      case 'EmergencyAlert':
        return '🚨 Alert Type: ${data['alert_type']}';
      case 'FuelReport':
        return '⛽ ${data['fuel_level_percent']}% | ${data['fuel_consumption_l']}L';
      case 'Temperature':
        return '🌡️ ${data['temp_celsius'] / 10}°C / ${data['humidity_percent']}%';
      case 'ImpactEvent':
        return '💥 ${data['impact_g'] / 10}G at ${data['direction']}°';
      default:
        return '📡 ${message['msg_type'] ?? 'Unknown'}';
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Sigfox IoT Monitor'),
        bottom: TabBar(
          controller: _tabController,
          tabs: const [
            Tab(icon: Icon(Icons.sensors), text: 'Devices'),
            Tab(icon: Icon(Icons.message), text: 'Messages'),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _loadData,
          ),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Icon(Icons.wifi_off, size: 48, color: Colors.red),
                      const SizedBox(height: 16),
                      Text('Error: $_error'),
                      const SizedBox(height: 16),
                      ElevatedButton(
                        onPressed: _loadData,
                        child: const Text('Retry'),
                      ),
                    ],
                  ),
                )
              : TabBarView(
                  controller: _tabController,
                  children: [
                    _buildDevicesTab(),
                    _buildMessagesTab(),
                  ],
                ),
    );
  }

  Widget _buildDevicesTab() {
    if (_devices.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.sensors_off, size: 64, color: Colors.grey),
            const SizedBox(height: 16),
            const Text('No Sigfox devices registered',
                style: TextStyle(fontSize: 18, color: Colors.grey)),
            const SizedBox(height: 24),
            ElevatedButton.icon(
              onPressed: () {
                // TODO: Navigate to register device
              },
              icon: const Icon(Icons.add),
              label: const Text('Register Device'),
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _loadData,
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: _devices.length,
        itemBuilder: (context, index) {
          final device = _devices[index];
          final lastSeen = device['last_seen'] != null
              ? DateTime.fromMillisecondsSinceEpoch(device['last_seen'] as int)
              : null;
          final isOnline = lastSeen != null &&
              DateTime.now().difference(lastSeen).inMinutes < 30;

          return Card(
            margin: const EdgeInsets.only(bottom: 12),
            elevation: 2,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
            ),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Container(
                        width: 12,
                        height: 12,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: isOnline ? Colors.green : Colors.grey,
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              device['device_id'] ?? 'Unknown',
                              style: const TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                            Text(
                              'Vehicle: ${device['vehicle_id'] ?? 'N/A'}',
                              style: const TextStyle(color: Colors.grey),
                            ),
                          ],
                        ),
                      ),
                      Chip(
                        label: Text(
                          device['region']?.toString() ?? 'Unknown',
                          style: const TextStyle(fontSize: 10),
                        ),
                        visualDensity: VisualDensity.compact,
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      _buildInfoBadge(Icons.message,
                          '${device['total_messages'] ?? 0} msgs'),
                      const SizedBox(width: 12),
                      if (device['last_message'] != null)
                        _buildInfoBadge(
                          Icons.last_page,
                          '${device['last_message']}',
                        ),
                    ],
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _buildInfoBadge(IconData icon, String text) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 14, color: Colors.grey[600]),
        const SizedBox(width: 4),
        Text(text, style: TextStyle(fontSize: 12, color: Colors.grey[600])),
      ],
    );
  }

  Widget _buildMessagesTab() {
    if (_messages.isEmpty) {
      return const Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.inbox, size: 64, color: Colors.grey),
            SizedBox(height: 16),
            Text('No recent messages', style: TextStyle(fontSize: 18, color: Colors.grey)),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _loadData,
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: _messages.length,
        itemBuilder: (context, index) {
          final msg = _messages[index];
          return Card(
            margin: const EdgeInsets.only(bottom: 8),
            child: ListTile(
              leading: Icon(
                Icons.wifi,
                color: msg['signal_quality'] != null && msg['signal_quality'] > 70
                    ? Colors.green
                    : Colors.orange,
              ),
              title: Text(
                msg['msg_type'] ?? 'Unknown',
                style: const TextStyle(fontWeight: FontWeight.bold),
              ),
              subtitle: Text(
                _formatMessagePayload(msg),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
              trailing: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    'SQ: ${msg['signal_quality'] ?? 'N/A'}',
                    style: const TextStyle(fontSize: 12, color: Colors.grey),
                  ),
                  Text(
                    '#${msg['sequence'] ?? '-'}',
                    style: const TextStyle(fontSize: 10, color: Colors.grey),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}
