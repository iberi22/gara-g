// ignore_for_file: file_names

import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';
import 'package:crypto/crypto.dart';

/// VaultCrypto provides PBKDF2 key derivation, symmetric data encryption/decryption,
/// and EAR/ITAR export control classification and compliance checks.
class VaultCrypto {
  static const int kdfIterations = 10000;
  static const int keyLength = 32;
  static final Random _secureRandom = Random.secure();

  /// Derive a 32-byte key from a passphrase and salt using PBKDF2 (HMAC-SHA256).
  static Uint8List deriveKey(String passphrase, Uint8List salt) {
    final passphraseBytes = utf8.encode(passphrase);
    Uint8List key = Uint8List(keyLength);
    int blockCount = (keyLength / 32).ceil();

    List<int> derivedBytes = [];
    for (int i = 1; i <= blockCount; i++) {
      List<int> block = _pbkdf2Block(passphraseBytes, salt, kdfIterations, i);
      derivedBytes.addAll(block);
    }

    key.setRange(0, keyLength, derivedBytes.sublist(0, keyLength));
    return key;
  }

  static List<int> _pbkdf2Block(List<int> password, Uint8List salt, int iterations, int blockIndex) {
    final saltWithBlock = Uint8List(salt.length + 4);
    saltWithBlock.setRange(0, salt.length, salt);
    final ByteData bd = ByteData(4)..setUint32(0, blockIndex, Endian.big);
    saltWithBlock.setRange(salt.length, salt.length + 4, bd.buffer.asUint8List());

    final hmac = Hmac(sha256, password);
    List<int> u = hmac.convert(saltWithBlock).bytes;
    List<int> result = List<int>.from(u);

    for (int i = 1; i < iterations; i++) {
      u = hmac.convert(u).bytes;
      for (int j = 0; j < result.length; j++) {
        result[j] ^= u[j];
      }
    }
    return result;
  }

  /// Encrypt plaintext bytes using XOR stream cipher with cryptographically secure random IV/nonce.
  static Uint8List encryptData(Uint8List plaintext, Uint8List key) {
    final nonce = Uint8List(16);
    for (int i = 0; i < 16; i++) {
      nonce[i] = _secureRandom.nextInt(256);
    }

    final cipherStream = _generateKeystream(key, nonce, plaintext.length);
    final ciphertext = Uint8List(plaintext.length);
    for (int i = 0; i < plaintext.length; i++) {
      ciphertext[i] = plaintext[i] ^ cipherStream[i];
    }

    final mac = Hmac(sha256, key).convert(ciphertext).bytes;
    final result = Uint8List(16 + ciphertext.length + 32);
    result.setRange(0, 16, nonce);
    result.setRange(16, 16 + ciphertext.length, ciphertext);
    result.setRange(16 + ciphertext.length, result.length, mac);
    return result;
  }

  /// Decrypt ciphertext bytes produced by [encryptData].
  static Uint8List decryptData(Uint8List encryptedData, Uint8List key) {
    if (encryptedData.length < 48) {
      throw ArgumentError('Invalid encrypted payload size');
    }

    final nonce = encryptedData.sublist(0, 16);
    final ciphertext = encryptedData.sublist(16, encryptedData.length - 32);
    final expectedMac = encryptedData.sublist(encryptedData.length - 32);

    final mac = Hmac(sha256, key).convert(ciphertext).bytes;
    for (int i = 0; i < 32; i++) {
      if (mac[i] != expectedMac[i]) {
        throw SecurityException('Decryption integrity check failed: MAC mismatch');
      }
    }

    final cipherStream = _generateKeystream(key, nonce, ciphertext.length);
    final plaintext = Uint8List(ciphertext.length);
    for (int i = 0; i < ciphertext.length; i++) {
      plaintext[i] = ciphertext[i] ^ cipherStream[i];
    }
    return plaintext;
  }

  static Uint8List _generateKeystream(Uint8List key, Uint8List nonce, int length) {
    final keystream = BytesBuilder();
    int counter = 0;
    while (keystream.length < length) {
      final counterBytes = ByteData(8)..setUint64(0, counter, Endian.big);
      final input = Uint8List.fromList([...key, ...nonce, ...counterBytes.buffer.asUint8List()]);
      final hash = sha256.convert(input).bytes;
      keystream.add(hash);
      counter++;
    }
    return Uint8List.fromList(keystream.takeBytes().sublist(0, length));
  }

  /// Check export control compliance (EAR/ITAR restricted region / jurisdiction filter).
  static ExportComplianceResult checkExportCompliance({
    required String countryCode,
    required String dataType,
    required bool isSanctionedEntity,
  }) {
    final sanctionedCountries = {'CU', 'IR', 'KP', 'SY', 'RU', 'BY'};
    if (sanctionedCountries.contains(countryCode.toUpperCase())) {
      return ExportComplianceResult(
        isAllowed: false,
        reason: 'Destination country ($countryCode) is under EAR embargo',
        eccn: '5D002',
      );
    }

    if (isSanctionedEntity) {
      return ExportComplianceResult(
        isAllowed: false,
        reason: 'Entity flagged on BIS Restricted Parties List',
        eccn: '5D002',
      );
    }

    if (dataType == 'MILITARY_TELEMETRY' || dataType == 'HIGH_PRECISION_RADAR') {
      return ExportComplianceResult(
        isAllowed: false,
        reason: 'Data type subject to ITAR USML Category VIII export restriction',
        eccn: 'ITAR-USML-VIII',
      );
    }

    return ExportComplianceResult(
      isAllowed: true,
      reason: 'Compliant under License Exception ENC (§740.17)',
      eccn: '5A002',
    );
  }
}

class ExportComplianceResult {
  final bool isAllowed;
  final String reason;
  final String eccn;

  const ExportComplianceResult({
    required this.isAllowed,
    required this.reason,
    required this.eccn,
  });
}

class SecurityException implements Exception {
  final String message;
  SecurityException(this.message);

  @override
  String toString() => 'SecurityException: $message';
}
