import 'package:flutter/material.dart';
import '../services/governance_service.dart';

class GovernanceScreen extends StatefulWidget {
  const GovernanceScreen({super.key});

  @override
  State<GovernanceScreen> createState() => _GovernanceScreenState();
}

class _GovernanceScreenState extends State<GovernanceScreen> {
  final GovernanceService _governanceService = GovernanceService();
  List<Map<String, dynamic>> _proposals = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    try {
      final proposals = await _governanceService.getProposals();
      setState(() {
        _proposals = proposals;
        _loading = false;
      });
    } catch (e) {
      setState(() {
        _loading = false;
      });
    }
  }

  Future<void> _vote(int proposalId, bool support) async {
    try {
      final success = await _governanceService.castVote(proposalId, support);
      if (success) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Vote cast successfully!')),
        );
        _loadData();
      }
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Error voting: $e')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    return Scaffold(
      appBar: AppBar(title: const Text('DAO Governance')),
      body: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildStatCard(
              'Voting Power',
              '2,500 GARA',
              Icons.bolt
            ),
            const SizedBox(height: 10),
            _buildStatCard(
              'Delegated To',
              'None',
              Icons.how_to_vote
            ),
            const SizedBox(height: 20),
            const Text('Active Proposals', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
            const SizedBox(height: 10),
            Expanded(
              child: _proposals.isEmpty
                ? const Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(Icons.how_to_vote, size: 64, color: Colors.white24),
                        SizedBox(height: 16),
                        Text(
                          'No active proposals',
                          style: TextStyle(color: Colors.white54),
                        ),
                        SizedBox(height: 8),
                        Text(
                          'Check back later or connect to testnet',
                          style: TextStyle(color: Colors.white38, fontSize: 12),
                        ),
                      ],
                    ),
                  )
                : ListView.builder(
                    itemCount: _proposals.length,
                    itemBuilder: (context, index) {
                      final proposal = _proposals[index];
                      return Card(
                        color: const Color(0xFF16213E),
                        child: ListTile(
                          title: Text(proposal['title'], style: const TextStyle(color: Colors.white)),
                          subtitle: Text(
                            'Status: ${proposal['status']} • For: ${proposal['forVotes']} Against: ${proposal['againstVotes']}',
                            style: const TextStyle(color: Colors.white54),
                          ),
                          trailing: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              IconButton(
                                icon: const Icon(Icons.thumb_up, color: Colors.greenAccent),
                                onPressed: () => _vote(proposal['id'], true),
                              ),
                              IconButton(
                                icon: const Icon(Icons.thumb_down, color: Colors.redAccent),
                                onPressed: () => _vote(proposal['id'], false),
                              ),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildStatCard(String title, String value, IconData icon) {
    return Card(
      color: Colors.white10,
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Row(
          children: [
            Icon(icon, size: 30, color: Colors.blueAccent),
            const SizedBox(width: 15),
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: const TextStyle(color: Colors.white70)),
                Text(value, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
