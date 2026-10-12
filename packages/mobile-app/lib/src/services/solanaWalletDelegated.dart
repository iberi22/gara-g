import 'package:flutter/foundation.dart';
import 'package:solana/solana.dart';
import 'vaultService.dart';

/// SolanaWalletDelegated provides Solana wallet capabilities by delegating
/// transaction signing to swal-vault while maintaining read-only RPC access.
/// Replaces direct Solana keypair / web3dart local key management.
class SolanaWalletDelegated {
  static final SolanaWalletDelegated _instance = SolanaWalletDelegated._internal();
  factory SolanaWalletDelegated() => _instance;
  SolanaWalletDelegated._internal();

  final VaultService _vaultService = VaultService();
  final SolanaClient _client = SolanaClient(
    rpcUrl: Uri.parse('https://api.devnet.solana.com'),
    websocketUrl: Uri.parse('ws://api.devnet.solana.com'),
  );

  bool get isConnected => _vaultService.isConnected;

  Future<bool> authorize() async {
    return _vaultService.connectVault();
  }

  Future<bool> reauthorize() async {
    return _vaultService.connectVault();
  }

  Future<void> deauthorize() async {
    await _vaultService.disconnectVault();
  }

  String? getPublicKey() {
    return _vaultService.vaultAddress;
  }

  /// Requests transaction signing delegated to swal-vault
  Future<String> signTransaction(String transactionMessage) async {
    return _vaultService.requestSignature(transactionMessage);
  }

  /// Read-only balance query via Solana RPC client
  Future<double> getGaraBalance() async {
    final address = getPublicKey();
    if (address == null) return 0.0;

    try {
      final balance = await _client.rpcClient.getBalance(address);
      return balance.value.toDouble() / 1000000000.0;
    } catch (e) {
      debugPrint('Error fetching GARA balance via RPC: $e');
      return 0.0;
    }
  }
}
