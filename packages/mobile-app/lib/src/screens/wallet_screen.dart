import 'package:flutter/material.dart';
import 'package:gara_g_pilot/src/rust/api.dart';

class WalletScreen extends StatefulWidget {
  const WalletScreen({super.key});

  @override
  State<WalletScreen> createState() => _WalletScreenState();
}

class _WalletScreenState extends State<WalletScreen> {
  bool _isSyncing = false;
  String _status = "Ready";
  double _balance = 0.0;
  String? _publicKey;

  @override
  void initState() {
    super.initState();
    _loadWalletData();
  }

  Future<void> _loadWalletData() async {
    try {
      final pubkey = await walletGetPublicKey();
      setState(() {
        _publicKey = pubkey;
        _status = "Wallet loaded, fetching balance...";
      });
      await _fetchBalance(pubkey);
    } catch (e) {
      setState(() {
        _status = "Failed to load wallet: $e";
      });
    }
  }

  Future<void> _fetchBalance(String pubkey) async {
    try {
      // The Rust function returns 0 for now, so this will show 0.00
      final balanceBigInt = await getWalletBalance(pubkey: pubkey);
      setState(() {
        // Assuming the value is in the smallest unit (e.g., micro-GARA)
        _balance = balanceBigInt.toDouble() / 1000000.0;
        _status = "Balance updated";
      });
    } catch (e) {
      setState(() {
        _status = "Failed to fetch balance: $e";
      });
    }
  }


  Future<void> _syncVault() async {
    setState(() {
      _isSyncing = true;
      _status = "Syncing vault...";
    });

    try {
      // Configure API first
      await setApiConfig(apiKey: "test-key", apiUrl: "https://api.gara-network.org");

      // Call Rust sync function
      final countBig = await syncTelemetryToCloud();
      final count = countBig.toInt();

      setState(() {
        _status = "Synced $count records!";
      });

      // After syncing, refresh the balance
      if (_publicKey != null) {
        await _fetchBalance(_publicKey!);
      }

    } catch (e) {
      setState(() {
        _status = "Sync failed: $e";
      });
    } finally {
      setState(() {
        _isSyncing = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF1A1A2E),
      appBar: AppBar(
        title: const Text("Gara Wallet"),
        backgroundColor: Colors.transparent,
        elevation: 0,
      ),
      body: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            const Icon(Icons.account_balance_wallet, size: 80, color: Colors.greenAccent),
            const SizedBox(height: 20),
            Text(
              "\$GARA (Testnet)",
              style: Theme.of(context).textTheme.headlineSmall?.copyWith(color: Colors.white70),
            ),
            Text(
              _balance.toStringAsFixed(2),
              style: Theme.of(context).textTheme.displayMedium?.copyWith(
                    fontWeight: FontWeight.bold,
                    color: Colors.greenAccent,
                  ),
            ),
            const SizedBox(height: 40),
            _buildStatCard("Network Status", "Online", Icons.wifi),
            const SizedBox(height: 16),
            _buildStatCard("Vault Status", "Encrypted", Icons.lock),
            const Spacer(),
            Text(
                _status,
                style: const TextStyle(color: Colors.white54),
                textAlign: TextAlign.center,
            ),
            const SizedBox(height: 20),
            SizedBox(
              width: double.infinity,
              height: 56,
              child: ElevatedButton.icon(
                onPressed: _isSyncing ? null : _syncVault,
                icon: _isSyncing
                    ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Icon(Icons.cloud_upload),
                label: Text(
                    _isSyncing ? "Syncing..." : "Sync Vault & Claim Rewards",
                    style: const TextStyle(fontSize: 16),
                ),
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.greenAccent,
                  foregroundColor: Colors.black,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildStatCard(String title, String value, IconData icon) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF2A2A3E),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.white10),
      ),
      child: Row(
        children: [
          Icon(icon, color: Colors.greenAccent),
          const SizedBox(width: 16),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: const TextStyle(color: Colors.grey)),
              Text(value, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.white)),
            ],
          ),
        ],
      ),
    );
  }
}
