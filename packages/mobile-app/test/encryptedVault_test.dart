// ignore_for_file: file_names

import 'dart:typed_data';
import 'package:flutter_test/flutter_test.dart';
import 'package:gara_g_pilot/src/services/vaultCrypto.dart';
import 'package:gara_g_pilot/src/services/encryptedVault.dart';

void main() {
  group('Mobile Encrypted Vault & VaultCrypto Tests', () {
    late Uint8List salt;
    late Uint8List dbKey;
    late Uint8List clientKey;

    setUp(() {
      salt = Uint8List.fromList(List.generate(16, (i) => i + 1));
      dbKey = VaultCrypto.deriveKey('db-master-passphrase-2026', salt);
      clientKey = VaultCrypto.deriveKey('client-user-secret-passphrase', salt);
    });

    test('1. Key derivation & vault initialization (SQLCipher and Hive fallback setup)', () async {
      expect(dbKey.length, equals(32));
      expect(clientKey.length, equals(32));
      expect(dbKey, isNot(equals(clientKey)));

      // Initialize primary SQLCipher engine
      final sqlCipherVault = await EncryptedVault.init(
        dbKey: dbKey,
        clientKey: clientKey,
        forceEngine: StorageEngineMode.sqlcipher,
      );

      expect(sqlCipherVault.isSQLCipher, isTrue);
      expect(sqlCipherVault.isHiveFallback, isFalse);
      expect(sqlCipherVault.engineDescription, contains('SQLCipher'));

      // Test automatic Hive fallback initialization
      final hiveVault = await EncryptedVault.init(
        dbKey: dbKey,
        clientKey: clientKey,
        simulateSQLCipherFailure: true,
      );

      expect(hiveVault.isSQLCipher, isFalse);
      expect(hiveVault.isHiveFallback, isTrue);
      expect(hiveVault.engineDescription, contains('Hive'));
    });

    test('2. Storing telemetry records with auto-chunking & metadata indexing', () async {
      final vault = await EncryptedVault.init(
        dbKey: dbKey,
        clientKey: clientKey,
      );

      final records = List.generate(
        120,
        (i) => TelemetryRecord(
          timestamp: 1700000000 + i * 10,
          h3Index: 8928308280,
          dataType: i < 60 ? 'KINEMATICS' : 'RADAR',
          speed: 45.0 + (i % 15),
          latitude: 37.7749 + (i * 0.0001),
          longitude: -122.4194 + (i * 0.0001),
          payload: Uint8List.fromList([i, i + 1, i + 2]),
        ),
      );

      // Store with max 50 records per chunk -> expect 3 chunks
      final chunkIds = await vault.storeRecords(records, maxRecordsPerChunk: 50);

      expect(chunkIds.length, equals(3));
      expect(chunkIds, equals([1, 2, 3]));
    });

    test('3. Querying indexed metadata by H3 index, timestamp, and data type', () async {
      final vault = await EncryptedVault.init(
        dbKey: dbKey,
        clientKey: clientKey,
      );

      final recsH3A = List.generate(
        30,
        (i) => TelemetryRecord(
          timestamp: 1700000000 + i * 10,
          h3Index: 8928308280,
          dataType: 'KINEMATICS',
          speed: 50.0 + i,
          latitude: 34.0522,
          longitude: -118.2437,
          payload: Uint8List.fromList([1, 2, 3]),
        ),
      );

      final recsH3B = List.generate(
        30,
        (i) => TelemetryRecord(
          timestamp: 1700010000 + i * 10,
          h3Index: 8928308291,
          dataType: 'ENVIRONMENTAL',
          speed: 25.0,
          latitude: 40.7128,
          longitude: -74.0060,
          payload: Uint8List.fromList([4, 5, 6]),
        ),
      );

      await vault.storeRecords(recsH3A, maxRecordsPerChunk: 50);
      await vault.storeRecords(recsH3B, maxRecordsPerChunk: 50);

      // Query by H3 index
      final queryH3A = await vault.queryByMetadata(h3Index: 8928308280);
      expect(queryH3A.length, equals(1));
      expect(queryH3A.first.records.length, equals(30));

      // Query by data type
      final queryEnv = await vault.queryByMetadata(dataType: 'ENVIRONMENTAL');
      expect(queryEnv.length, equals(1));
      expect(queryEnv.first.records.first.h3Index, equals(8928308291));

      // Query by timestamp range
      final queryTime = await vault.queryByMetadata(
        startTime: 1700005000,
        endTime: 1700020000,
      );
      expect(queryTime.length, equals(1));
    });

    test('4. Marketplace DP pipeline integration and export control compliance checks', () async {
      final vault = await EncryptedVault.init(
        dbKey: dbKey,
        clientKey: clientKey,
      );

      final records = List.generate(
        10,
        (i) => TelemetryRecord(
          timestamp: 1700000000 + i,
          h3Index: 8928308280,
          dataType: 'KINEMATICS',
          speed: 60.0 + i,
          latitude: 37.7749,
          longitude: -122.4194,
          payload: Uint8List.fromList([7, 8, 9]),
        ),
      );

      final chunkIds = await vault.storeRecords(records, maxRecordsPerChunk: 50);
      final chunkId = chunkIds.first;

      // Integrate with marketplace DP pipeline
      final dpPipeline = DpPipeline(minK: 3, epsilon: 1.0);
      final anonymized = await vault.integrateWithPipeline(
        dpPipeline,
        dataType: 'KINEMATICS',
      );

      expect(anonymized.kAnonymityPassed, isTrue);
      expect(anonymized.noiseApplied, isTrue);
      expect(anonymized.recordCount, equals(10));
      expect(anonymized.speeds.length, equals(10));

      // Test compliant export check (USA / KINEMATICS)
      final exportedBytes = await vault.exportChunk(
        chunkId,
        destinationCountry: 'US',
        dataType: 'KINEMATICS',
      );
      expect(exportedBytes.length, greaterThan(0));

      // Test EAR embargo sanction export failure
      expect(
        () => vault.exportChunk(
          chunkId,
          destinationCountry: 'IR',
          dataType: 'KINEMATICS',
        ),
        throwsA(isA<ExportControlException>()),
      );

      // Test ITAR restricted military data type export failure
      expect(
        () => vault.exportChunk(
          chunkId,
          destinationCountry: 'DE',
          dataType: 'MILITARY_TELEMETRY',
        ),
        throwsA(isA<ExportControlException>()),
      );
    });
  });
}
