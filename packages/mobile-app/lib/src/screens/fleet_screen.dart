import 'package:flutter/material.dart';
import '../services/fleet_service.dart';

class FleetScreen extends StatefulWidget {
  const FleetScreen({super.key});

  @override
  State<FleetScreen> createState() => _FleetScreenState();
}

class _FleetScreenState extends State<FleetScreen> with SingleTickerProviderStateMixin {
  final FleetService _fleetService = FleetService(
    baseUrl: 'https://gara-g.swal.network', // Replace with config
    organizationId: 'org_1',
  );

  late TabController _tabController;
  List<dynamic> _fleets = [];
  Map<String, dynamic>? _dashboardData;
  bool _isLoading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _loadData();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _loadData() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final fleetsData = await _fleetService.listFleets();
      final dashboardData = await _fleetService.getMultiFleetDashboard();

      setState(() {
        _fleets = fleetsData['data'] ?? [];
        _dashboardData = dashboardData['data'];
        _isLoading = false;
      });
    } catch (e) {
      setState(() {
        _error = e.toString();
        _isLoading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Fleet Management'),
        bottom: TabBar(
          controller: _tabController,
          tabs: const [
            Tab(text: 'Fleets'),
            Tab(text: 'Dashboard'),
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
              ? Center(child: Text('Error: $_error'))
              : TabBarView(
                  controller: _tabController,
                  children: [
                    _buildFleetsList(),
                    _buildDashboard(),
                  ],
                ),
      floatingActionButton: FloatingActionButton(
        onPressed: () {
          // TODO: Open Create Fleet Dialog
        },
        child: const Icon(Icons.add),
      ),
    );
  }

  Widget _buildFleetsList() {
    return RefreshIndicator(
      onRefresh: _loadData,
      child: ListView.builder(
        padding: const EdgeInsets.all(16.0),
        itemCount: _fleets.length,
        itemBuilder: (context, index) {
          return _buildFleetCard(_fleets[index]);
        },
      ),
    );
  }

  Widget _buildDashboard() {
    if (_dashboardData == null) return const Center(child: Text('No dashboard data available'));

    final kpis = _dashboardData!['kpis'];
    final roi = _dashboardData!['roiAnalytics'];
    final alerts = _dashboardData!['alerts'] as List<dynamic>;

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _buildKpiGrid(kpis),
          const SizedBox(height: 24),
          _buildRoiCard(roi),
          const SizedBox(height: 24),
          const Text(
            'Recent Alerts',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 12),
          ...alerts.take(5).map((alert) => _buildAlertItem(alert)).toList(),
          if (alerts.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 20),
              child: Center(child: Text('No active alerts', style: TextStyle(color: Colors.grey))),
            ),
        ],
      ),
    );
  }

  Widget _buildKpiGrid(Map<String, dynamic> kpis) {
    return GridView.count(
      crossAxisCount: 2,
      crossAxisSpacing: 12,
      mainAxisSpacing: 12,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      children: [
        _buildStatItem('Total Vehicles', kpis['totalVehicles'].toString(), Icons.directions_car),
        _buildStatItem('Active Routes', kpis['activeRoutes'].toString(), Icons.map, Colors.blue),
        _buildStatItem('Avg Compliance', '${kpis['averageComplianceScore']}%', Icons.verified, Colors.green),
        _buildStatItem('Monthly Cost', '\$${kpis['totalMonthlyCost']}', Icons.attach_money, Colors.orange),
      ],
    );
  }

  Widget _buildRoiCard(Map<String, dynamic> roi) {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Row(
              children: [
                Icon(Icons.trending_up, color: Colors.indigo),
                SizedBox(width: 8),
                Text('ROI Analytics (Annual)', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
              ],
            ),
            const SizedBox(height: 16),
            _buildRoiRow('Total Savings', '\$${roi['totalSavings']}', Colors.green),
            _buildRoiRow('Subscription', '-\$${roi['subscriptionCost']}', Colors.red),
            const Divider(),
            _buildRoiRow('Net ROI', '\$${roi['netROI']}', Colors.indigo, isBold: true),
            const SizedBox(height: 8),
            Text(
              '${roi['roiPercentage']}% return on investment',
              style: const TextStyle(fontSize: 12, color: Colors.grey),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildRoiRow(String label, String value, Color color, {bool isBold = false}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: TextStyle(fontWeight: isBold ? FontWeight.bold : FontWeight.normal)),
          Text(value, style: TextStyle(color: color, fontWeight: FontWeight.bold, fontSize: isBold ? 18 : 14)),
        ],
      ),
    );
  }

  Widget _buildAlertItem(Map<String, dynamic> alert) {
    final Color severityColor = alert['severity'] == 'critical' ? Colors.red : (alert['severity'] == 'high' ? Colors.orange : Colors.amber);

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: severityColor.withOpacity(0.05),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: severityColor.withOpacity(0.2)),
      ),
      child: Row(
        children: [
          Icon(Icons.warning_amber_rounded, color: severityColor, size: 20),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(alert['category'].toString().toUpperCase(), style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: severityColor)),
                Text(alert['message'], style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStatItem(String label, String value, IconData icon, [Color? color]) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12.0),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, color: color ?? Colors.blue, size: 28),
            const SizedBox(height: 8),
            Text(value, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
            Text(label, style: const TextStyle(fontSize: 12, color: Colors.grey), textAlign: TextAlign.center),
          ],
        ),
      ),
    );
  }

  Widget _buildFleetCard(Map<String, dynamic> fleet) {
    final statusColor = fleet['status'] == 'active'
        ? Colors.green
        : (fleet['status'] == 'maintenance' ? Colors.orange : Colors.grey);

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () {
          // TODO: Navigate to Fleet Detail Screen
        },
        child: Padding(
          padding: const EdgeInsets.all(16.0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Expanded(
                    child: Text(
                      fleet['name'],
                      style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(
                      color: statusColor.withOpacity(0.1),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      fleet['status'].toString().toUpperCase(),
                      style: TextStyle(
                        color: statusColor,
                        fontSize: 10,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  _buildFleetInfoItem(Icons.directions_car, '${fleet['vehicleCount']} Vehicles'),
                  const SizedBox(width: 16),
                  _buildFleetInfoItem(Icons.analytics, '${fleet['complianceScore']}% Compliance'),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildFleetInfoItem(IconData icon, String label) {
    return Row(
      children: [
        Icon(icon, size: 16, color: Colors.grey[600]),
        const SizedBox(width: 4),
        Text(
          label,
          style: TextStyle(fontSize: 12, color: Colors.grey[600]),
        ),
      ],
    );
  }
}
