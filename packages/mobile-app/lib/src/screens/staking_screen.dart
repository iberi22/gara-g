import 'package:flutter/material.dart';
import '../services/solanaWalletDelegated.dart';
import '../services/staking_service.dart';

class StakingScreen extends StatefulWidget {
  const StakingScreen({super.key});

  @override
  State<StakingScreen> createState() => _StakingScreenState();
}

class _StakingScreenState extends State<StakingScreen> {
  final SolanaWalletDelegated _walletService = SolanaWalletDelegated();
  final StakingService _stakingService = StakingService();
  double _balance = 0.0;
  double _stakedAmount = 0.0;
  double _accumulatedRewards = 0.0;
  bool _isLoading = false;

  @override
  void initState() {
    super.initState();
    _refreshData();
  }

  Future<void> _refreshData() async {
    if (!_walletService.isConnected) return;

    setState(() => _isLoading = true);
    try {
      final balance = await _walletService.getGaraBalance();
      final stakingData = await _stakingService.getStakingData();

      setState(() {
        _balance = balance;
        _stakedAmount = (stakingData['totalStaked'] as num).toDouble();
        _accumulatedRewards = (stakingData['rewards'] as num).toDouble();
      });
    } catch (e) {
      debugPrint('Error refreshing staking data: $e');
    } finally {
      setState(() => _isLoading = false);
    }
  }

  Future<void> _connectWallet() async {
    try {
      await _walletService.authorize();
      await _refreshData();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Connection failed: $e')),
        );
      }
    }
  }

  Future<void> _stakeTokens() async {
    setState(() => _isLoading = true);
    try {
      final success = await _stakingService.stakeTokens(100.0, 30);
      if (mounted && success) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Tokens staked successfully!')),
        );
      }
      await _refreshData();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Staking failed: $e')),
        );
      }
    } finally {
      setState(() => _isLoading = false);
    }
  }

  Future<void> _claimRewards() async {
    setState(() => _isLoading = true);
    try {
      final success = await _stakingService.claimRewards();
      if (mounted && success) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Rewards claimed successfully!')),
        );
      }
      await _refreshData();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Claim failed: $e')),
        );
      }
    } finally {
      setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('GARA Staking')),
      body: _walletService.isConnected ? _buildStakingUI() : _buildConnectUI(),
    );
  }

  Widget _buildConnectUI() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.account_balance_wallet, size: 100, color: Colors.blueGrey),
          const SizedBox(height: 20),
          const Text('Connect your Solana wallet to start staking'),
          const SizedBox(height: 30),
          ElevatedButton(
            onPressed: _connectWallet,
            child: const Text('Connect Wallet'),
          ),
        ],
      ),
    );
  }

  Widget _buildStakingUI() {
    return RefreshIndicator(
      onRefresh: _refreshData,
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          children: [
            _buildInfoCard('Wallet Balance', '$_balance GARA', Icons.wallet),
            const SizedBox(height: 16),
            _buildInfoCard('Currently Staked', '$_stakedAmount GARA', Icons.lock_clock),
            const SizedBox(height: 16),
            _buildInfoCard('Accumulated Rewards', '$_accumulatedRewards GARA', Icons.card_giftcard),
            const SizedBox(height: 30),
            Row(
              children: [
                Expanded(
                  child: ElevatedButton(
                    onPressed: _isLoading ? null : _stakeTokens,
                    style: ElevatedButton.styleFrom(backgroundColor: Colors.green),
                    child: _isLoading ? const CircularProgressIndicator() : const Text('Stake Tokens'),
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: ElevatedButton(
                    onPressed: _isLoading || _accumulatedRewards <= 0 ? null : _claimRewards,
                    style: ElevatedButton.styleFrom(backgroundColor: Colors.orange),
                    child: _isLoading ? const CircularProgressIndicator() : const Text('Claim Rewards'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildInfoCard(String title, String value, IconData icon) {
    return Card(
      child: ListTile(
        leading: Icon(icon, size: 40, color: Colors.blueAccent),
        title: Text(title),
        trailing: Text(
          value,
          style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
        ),
      ),
    );
  }
}
