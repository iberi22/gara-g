import 'package:flutter/material.dart';
import '../services/fleet_service.dart';

/// Multi-Fleet Dashboard Screen
/// Shows cross-fleet analytics with fleet selection tabs
class MultiFleetScreen extends StatefulWidget {
  const MultiFleetScreen({super.key});

  @override
  State<MultiFleetScreen> createState() => _MultiFleetScreenState();
}

class _MultiFleetScreenState extends State<MultiFleetScreen>
    with SingleTickerProviderStateMixin {
  final FleetService _fleetService = FleetService(
    baseUrl: 'https://gara-g.swal.network',
    organizationId: 'org_1',
  );

  late TabController _tabController;
  List<dynamic> _fleets = [];
  Map<String, dynamic>? _analytics;
  Map<String, dynamic>? _stats;
  String? _selectedFleetId;
  bool _isLoading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this);
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
      final results = await Future.wait([
        _fleetService.listFleets(),
        _fleetService.getFleetStats(),
        _fleetService.getAnalytics(),
      ]);

      setState(() {
        _fleets = results[0]['data'] as List<dynamic>;
        _stats = results[1]['data'] as Map<String, dynamic>?;
        _analytics = results[2]['data'] as Map<String, dynamic>?;
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
        title: const Text('Multi-Fleet Dashboard'),
        bottom: TabBar(
          controller: _tabController,
          tabs: const [
            Tab(text: 'Overview', icon: Icon(Icons.dashboard)),
            Tab(text: 'Analytics', icon: Icon(Icons.analytics)),
            Tab(text: 'Compare', icon: Icon(Icons.compare_arrows)),
          ],
        ),
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Icon(Icons.error_outline, size: 48, color: Colors.red),
                      const SizedBox(height: 16),
                      Text('Error: $_error'),
                      const SizedBox(height: 16),
                      ElevatedButton(onPressed: _loadData, child: const Text('Retry')),
                    ],
                  ),
                )
              : TabBarView(
                  controller: _tabController,
                  children: [
                    _buildOverviewTab(),
                    _buildAnalyticsTab(),
                    _buildComparisonTab(),
                  ],
                ),
    );
  }

  Widget _buildOverviewTab() {
    return RefreshIndicator(
      onRefresh: _loadData,
      child: SingleChildScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Fleet selector
            if (_fleets.isNotEmpty) ...[
              const Text('Select Fleet', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: Colors.grey)),
              const SizedBox(height: 8),
              SizedBox(
                height: 40,
                child: ListView(
                  scrollDirection: Axis.horizontal,
                  children: [
                    _buildFleetChip(null, 'All Fleets'),
                    ..._fleets.map((f) => _buildFleetChip(f['id'], f['name'])),
                  ],
                ),
              ),
              const SizedBox(height: 24),
            ],

            // KPI Cards
            if (_stats != null)
              GridView.count(
                crossAxisCount: 2,
                crossAxisSpacing: 12,
                mainAxisSpacing: 12,
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                children: [
                  _buildKpiCard('Total Fleets', '${_stats!['totalFleets'] ?? 0}', Icons.folder, Colors.blue),
                  _buildKpiCard('Total Vehicles', '${_stats!['totalVehicles'] ?? 0}', Icons.directions_car, Colors.green),
                  _buildKpiCard('Active Routes', '${_stats!['activeRoutes'] ?? 0}', Icons.route, Colors.orange),
                  _buildKpiCard('Compliance', '${_stats!['averageCompliance'] ?? 0}%', Icons.shield, Colors.purple),
                ],
              ),

            const SizedBox(height: 24),

            // Fleet list
            const Text('All Fleets', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),
            ...(_selectedFleetId == null
                ? _fleets
                : _fleets.where((f) => f['id'] == _selectedFleetId).toList()
            ).map((fleet) => _buildFleetCard(fleet)).toList(),
          ],
        ),
      ),
    );
  }

  Widget _buildFleetChip(String? id, String label) {
    final isSelected = _selectedFleetId == id;
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: ChoiceChip(
        label: Text(label, style: const TextStyle(fontSize: 13)),
        selected: isSelected,
        onSelected: (selected) {
          setState(() => _selectedFleetId = selected ? id : null);
        },
        selectedColor: Colors.blue.withOpacity(0.2),
      ),
    );
  }

  Widget _buildKpiCard(String label, String value, IconData icon, Color color) {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, color: color, size: 28),
            const SizedBox(height: 8),
            Text(value, style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: color)),
            const SizedBox(height: 4),
            Text(label, style: const TextStyle(fontSize: 12, color: Colors.grey)),
          ],
        ),
      ),
    );
  }

  Widget _buildAnalyticsTab() {
    return RefreshIndicator(
      onRefresh: _loadData,
      child: SingleChildScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (_analytics != null) ...[
              const Text('Fleet Analytics', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
              const SizedBox(height: 16),
              // Summary metrics
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('Summary', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
                      const SizedBox(height: 12),
                      _buildAnalyticsRow('Total Distance', '${(_analytics!['summary']?['totalDistance'] ?? 0) / 1000} km'),
                      _buildAnalyticsRow('Total Trips', '${_analytics!['summary']?['totalTrips'] ?? 0}'),
                      _buildAnalyticsRow('Avg Trip Duration', '${_analytics!['summary']?['avgTripDuration'] ?? 0} min'),
                      _buildAnalyticsRow('CO₂ Emissions', '${(_analytics!['summary']?['co2Emissions'] ?? 0) / 1000} t'),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 16),
              // Fleet breakdown
              const Text('Fleet Performance', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
              const SizedBox(height: 8),
              ...(_analytics!['fleetBreakdown'] as List<dynamic>).map((f) => Card(
                margin: const EdgeInsets.only(bottom: 8),
                child: ListTile(
                  title: Text(f['fleetName']),
                  subtitle: Text('Trips: ${f['trips']}  |  Compliance: ${f['compliance']}%'),
                  trailing: Text('${f['fuelEfficiency']} km/L', style: const TextStyle(fontWeight: FontWeight.bold)),
                ),
              )).toList(),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildComparisonTab() {
    return RefreshIndicator(
      onRefresh: _loadData,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const Text('Fleet Comparison', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
          const SizedBox(height: 16),
          ..._fleets.map((fleet) {
            final statusColor = fleet['status'] == 'active' ? Colors.green : Colors.orange;
            return Card(
              margin: const EdgeInsets.only(bottom: 12),
              child: ListTile(
                leading: CircleAvatar(
                  backgroundColor: statusColor.withOpacity(0.2),
                  child: Icon(Icons.directions_car, color: statusColor),
                ),
                title: Text(fleet['name'], style: const TextStyle(fontWeight: FontWeight.bold)),
                subtitle: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const SizedBox(height: 4),
                    Text('${fleet['vehicleCount']} vehicles · ${fleet['complianceScore']}% compliance'),
                    LinearProgressIndicator(
                      value: (fleet['complianceScore'] ?? 0) / 100,
                      color: fleet['complianceScore'] > 80 ? Colors.green : Colors.orange,
                      backgroundColor: Colors.grey.withOpacity(0.2),
                    ),
                  ],
                ),
                isThreeLine: true,
                trailing: Text('\$${fleet['monthlyCost'] ?? 0}',
                    style: const TextStyle(fontWeight: FontWeight.bold)),
              ),
            );
          }).toList(),
        ],
      ),
    );
  }

  Widget _buildAnalyticsRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(color: Colors.grey)),
          Text(value, style: const TextStyle(fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildFleetCard(Map<String, dynamic> fleet) {
    final statusColor = fleet['status'] == 'active' ? Colors.green : Colors.orange;
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Expanded(
                    child: Text(fleet['name'] ?? '',
                        style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                        overflow: TextOverflow.ellipsis),
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(
                      color: statusColor.withOpacity(0.1),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(fleet['status']?.toString().toUpperCase() ?? '',
                        style: TextStyle(color: statusColor, fontSize: 10, fontWeight: FontWeight.bold)),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  _buildInfoChip(fleet, 'vehicleCount', Icons.directions_car, 'Vehicles'),
                  const SizedBox(width: 12),
                  _buildInfoChip(fleet, 'complianceScore', Icons.shield, 'Compliance'),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildInfoChip(Map<String, dynamic> fleet, String field, IconData icon, String label) {
    return Row(
      children: [
        Icon(icon, size: 16, color: Colors.grey[600]),
        const SizedBox(width: 4),
        Text('${fleet[field] ?? 0} $label',
            style: TextStyle(fontSize: 12, color: Colors.grey[600])),
      ],
    );
  }
}
