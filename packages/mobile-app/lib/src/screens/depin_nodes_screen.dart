import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/depin_provider.dart';
import '../widgets/depin_node_tile.dart';
import 'depin_node_detail_screen.dart';

class DepinNodesScreen extends StatefulWidget {
  const DepinNodesScreen({Key? key}) : super(key: key);

  @override
  _DepinNodesScreenState createState() => _DepinNodesScreenState();
}

class _DepinNodesScreenState extends State<DepinNodesScreen> {
  String _searchQuery = '';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      Provider.of<DepinProvider>(context, listen: false).loadNodes();
    });
  }

  @override
  Widget build(BuildContext context) {
    final depinProvider = Provider.of<DepinProvider>(context);

    final filteredNodes = depinProvider.nodes.where((node) {
      final id = node['id']?.toLowerCase() ?? '';
      final type = node['type']?.toLowerCase() ?? '';
      return id.contains(_searchQuery.toLowerCase()) ||
             type.contains(_searchQuery.toLowerCase());
    }).toList();

    return Scaffold(
      appBar: AppBar(
        title: const Text('DePIN Nodes'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () => depinProvider.loadNodes(),
          ),
        ],
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(16.0),
            child: TextField(
              decoration: InputDecoration(
                hintText: 'Search nodes...',
                prefixIcon: const Icon(Icons.search),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
              onChanged: (value) {
                setState(() => _searchQuery = value);
              },
            ),
          ),
          Expanded(
            child: depinProvider.isLoading
                ? const Center(child: CircularProgressIndicator())
                : filteredNodes.isEmpty
                    ? const Center(child: Text('No nodes found'))
                    : ListView.builder(
                        itemCount: filteredNodes.length,
                        itemBuilder: (context, index) {
                          return DepinNodeTile(
                            node: filteredNodes[index],
                            onTap: () {
                              Navigator.push(
                                context,
                                MaterialPageRoute(
                                  builder: (context) => DepinNodeDetailScreen(
                                    nodeId: filteredNodes[index]['id'],
                                  ),
                                ),
                              );
                            },
                          );
                        },
                      ),
          ),
        ],
      ),
    );
  }
}
