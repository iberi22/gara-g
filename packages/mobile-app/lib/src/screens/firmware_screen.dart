import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/depin_provider.dart';

class FirmwareScreen extends StatefulWidget {
  const FirmwareScreen({Key? key}) : super(key: key);

  @override
  _FirmwareScreenState createState() => _FirmwareScreenState();
}

class _FirmwareScreenState extends State<FirmwareScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      Provider.of<DepinProvider>(context, listen: false).loadFirmware();
    });
  }

  @override
  Widget build(BuildContext context) {
    final depinProvider = Provider.of<DepinProvider>(context);
    final versions = depinProvider.firmwareVersions;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Firmware Management'),
      ),
      body: depinProvider.isLoading
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                _buildStatusBanner(depinProvider),
                Expanded(
                  child: ListView.builder(
                    itemCount: versions.length,
                    itemBuilder: (context, index) {
                      final v = versions[index];
                      return Card(
                        margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                        child: ListTile(
                          leading: const Icon(Icons.system_update, color: Colors.indigo),
                          title: Text(
                            'Version ${v['version']}',
                            style: const TextStyle(fontWeight: FontWeight.bold),
                          ),
                          subtitle: Text('Released on ${v['releaseDate']}'),
                          trailing: v['critical'] == true
                              ? const Chip(
                                  label: Text('CRITICAL', style: TextStyle(color: Colors.white, fontSize: 10)),
                                  backgroundColor: Colors.red,
                                )
                              : Chip(
                                  label: Text(v['status']?.toUpperCase() ?? 'STABLE', style: const TextStyle(fontSize: 10)),
                                ),
                        ),
                      );
                    },
                  ),
                ),
                _buildActionButton(),
              ],
            ),
    );
  }

  Widget _buildStatusBanner(DepinProvider depinProvider) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      color: Colors.indigo.withOpacity(0.1),
      child: Row(
        children: [
          const Icon(Icons.info_outline, color: Colors.indigo),
          const SizedBox(width: 16),
          const Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Latest Stable: v1.2.4',
                  style: TextStyle(fontWeight: FontWeight.bold),
                ),
                Text(
                  'Your nodes are mostly up to date.',
                  style: TextStyle(fontSize: 12),
                ),
              ],
            ),
          ),
          TextButton(
            onPressed: () => depinProvider.loadFirmware(),
            child: const Text('CHECK FOR UPDATES'),
          ),
        ],
      ),
    );
  }

  Widget _buildActionButton() {
    return Padding(
      padding: const EdgeInsets.all(16.0),
      child: SizedBox(
        width: double.infinity,
        child: ElevatedButton.icon(
          onPressed: () {
            // Deploy action
          },
          icon: const Icon(Icons.cloud_upload),
          label: const Text('DEPLOY TO NETWORK'),
          style: ElevatedButton.styleFrom(
            padding: const EdgeInsets.symmetric(vertical: 16),
            backgroundColor: Colors.indigo,
            foregroundColor: Colors.white,
          ),
        ),
      ),
    );
  }
}
