import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/depin_provider.dart';

class DepinNodeDetailScreen extends StatefulWidget {
  final String nodeId;

  const DepinNodeDetailScreen({Key? key, required this.nodeId}) : super(key: key);

  @override
  _DepinNodeDetailScreenState createState() => _DepinNodeDetailScreenState();
}

class _DepinNodeDetailScreenState extends State<DepinNodeDetailScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      Provider.of<DepinProvider>(context, listen: false).loadNodeDetail(widget.nodeId);
    });
  }

  @override
  Widget build(BuildContext context) {
    final depinProvider = Provider.of<DepinProvider>(context);
    final node = depinProvider.selectedNode;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Node Details'),
      ),
      body: depinProvider.isLoading
          ? const Center(child: CircularProgressIndicator())
          : node == null
              ? const Center(child: Text('Node not found'))
              : SingleChildScrollView(
                  padding: const EdgeInsets.all(16.0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _buildHeader(node),
                      const SizedBox(height: 24),
                      _buildStatsGrid(node),
                      const SizedBox(height: 24),
                      const Text(
                        'Connected Peers',
                        style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                      ),
                      const SizedBox(height: 8),
                      _buildPeersList(node),
                      const SizedBox(height: 32),
                      SizedBox(
                        width: double.infinity,
                        child: ElevatedButton(
                          onPressed: () {
                            // Action for node management
                          },
                          style: ElevatedButton.styleFrom(
                            padding: const EdgeInsets.symmetric(vertical: 16),
                            backgroundColor: Colors.indigo,
                            foregroundColor: Colors.white,
                          ),
                          child: const Text('REBOOT NODE'),
                        ),
                      ),
                    ],
                  ),
                ),
    );
  }

  Widget _buildHeader(Map<String, dynamic> node) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          children: [
            const CircleAvatar(
              radius: 40,
              backgroundColor: Colors.indigo,
              child: Icon(Icons.router, size: 40, color: Colors.white),
            ),
            const SizedBox(height: 16),
            Text(
              widget.nodeId,
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 8),
            Chip(
              label: Text(node['status']?.toUpperCase() ?? 'OFFLINE'),
              backgroundColor: node['status'] == 'online' ? Colors.green.shade100 : Colors.red.shade100,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildStatsGrid(Map<String, dynamic> node) {
    return GridView.count(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      crossAxisCount: 2,
      childAspectRatio: 1.5,
      crossAxisSpacing: 16,
      mainAxisSpacing: 16,
      children: [
        _buildStatItem('Battery', '${node['batteryLevel']?.toStringAsFixed(0)}%', Icons.battery_charging_full),
        _buildStatItem('Signal', '${node['signalStrength']} dBm', Icons.signal_cellular_alt),
        _buildStatItem('Peers', '${(node['peers'] as List?)?.length ?? 0}', Icons.group),
        _buildStatItem('Storage', '${(node['storageUsed'] as num?)?.toStringAsFixed(1)} MB', Icons.storage),
      ],
    );
  }

  Widget _buildStatItem(String label, String value, IconData icon) {
    return Card(
      elevation: 2,
      child: Padding(
        padding: const EdgeInsets.all(12.0),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, color: Colors.indigo, size: 20),
            const SizedBox(height: 4),
            Text(value, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
            Text(label, style: const TextStyle(fontSize: 12, color: Colors.grey)),
          ],
        ),
      ),
    );
  }

  Widget _buildPeersList(Map<String, dynamic> node) {
    final peers = node['peers'] as List? ?? [];
    if (peers.isEmpty) return const Text('No peers connected', style: TextStyle(fontStyle: FontStyle.italic));

    return Column(
      children: peers.map((peer) => Card(
        child: ListTile(
          dense: true,
          leading: const Icon(Icons.link),
          title: Text(peer.toString()),
        ),
      )).toList(),
    );
  }
}
