import 'package:flutter_test/flutter_test.dart';
import 'package:gara_g_pilot/src/services/vaultService.dart';

void main() {
  group('VaultService', () {
    test('VaultService should be a singleton', () {
      final s1 = VaultService();
      final s2 = VaultService();
      expect(identical(s1, s2), isTrue);
    });

    test('connectVault sets isConnected and vaultAddress', () async {
      final service = VaultService();
      final result = await service.connectVault();

      expect(result, isTrue);
      expect(service.isConnected, isTrue);
      expect(service.vaultAddress, isNotNull);
      expect(service.vaultAddress, '11111111111111111111111111111111');
    });

    test('requestSignature returns delegated signature string', () async {
      final service = VaultService();
      await service.connectVault();

      final sig = await service.requestSignature('test_payload');
      expect(sig, contains('delegated_signature_from_swal_vault'));
    });

    test('disconnectVault resets connection state', () async {
      final service = VaultService();
      await service.connectVault();
      expect(service.isConnected, isTrue);

      await service.disconnectVault();
      expect(service.isConnected, isFalse);
      expect(service.vaultAddress, isNull);
    });
  });
}
