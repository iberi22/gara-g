import 'package:flutter_test/flutter_test.dart';
import 'package:gara_g_pilot/src/services/solanaWalletDelegated.dart';

void main() {
  group('SolanaWalletDelegated', () {
    test('SolanaWalletDelegated should be a singleton', () {
      final s1 = SolanaWalletDelegated();
      final s2 = SolanaWalletDelegated();
      expect(identical(s1, s2), isTrue);
    });

    test('authorize connects via VaultService', () async {
      final wallet = SolanaWalletDelegated();
      final result = await wallet.authorize();

      expect(result, isTrue);
      expect(wallet.isConnected, isTrue);
      expect(wallet.getPublicKey(), isNotNull);
    });

    test('signTransaction delegates to VaultService', () async {
      final wallet = SolanaWalletDelegated();
      await wallet.authorize();

      final sig = await wallet.signTransaction('test_tx');
      expect(sig, contains('delegated_signature_from_swal_vault'));
    });

    test('deauthorize disconnects delegated wallet', () async {
      final wallet = SolanaWalletDelegated();
      await wallet.authorize();
      expect(wallet.isConnected, isTrue);

      await wallet.deauthorize();
      expect(wallet.isConnected, isFalse);
      expect(wallet.getPublicKey(), isNull);
    });
  });
}
