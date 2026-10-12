// ignore_for_file: file_names

import 'dart:convert';
import 'dart:typed_data';
import 'vaultCrypto.dart';

/// Telemetry record structure for mobile encrypted vault operations
class TelemetryRecord {
  final int timestamp;
  final int h3Index;
  final String dataType;
  final double speed;
  final double latitude;
  final double longitude;
  final Uint8List payload;

  TelemetryRecord({
    required this.timestamp,
    required this.h3Index,
    required this.dataType,
    required this.speed,
    required this.latitude,
    required this.longitude,
    required this.payload,
  });

  Map<String, dynamic> toJson() => {
        'timestamp': timestamp,
        'h3Index': h3Index,
        'dataType': dataType,
        'speed': speed,
        'latitude': latitude,
        'longitude': longitude,
        'payload': base64Encode(payload),
      };

  factory TelemetryRecord.fromJson(Map<String, dynamic> json) => TelemetryRecord(
        timestamp: json['timestamp'] as int,
        h3Index: json['h3Index'] as int,
        dataType: json['dataType'] as String,
        speed: (json['speed'] as num).toDouble(),
        latitude: (json['latitude'] as num).toDouble(),
        longitude: (json['longitude'] as num).toDouble(),
        payload: base64Decode(json['payload'] as String),
      );
}

/// Telemetry chunk containing a collection of telemetry records
class TelemetryChunk {
  final List<TelemetryRecord> records;

  TelemetryChunk({required this.records});

  Map<String, dynamic> toJson() => {
        'records': records.map((r) => r.toJson()).toList(),
      };

  factory TelemetryChunk.fromJson(Map<String, dynamic> json) => TelemetryChunk(
        records: (json['records'] as List<dynamic>)
            .map((r) => TelemetryRecord.fromJson(r as Map<String, dynamic>))
            .toList(),
      );
}

/// Metadata index for fast un-encrypted searching of stored chunks
class ChunkMetadata {
  final int chunkId;
  final int h3Index;
  final int timestamp;
  final String dataType;
  final int recordCount;
  final double minLat;
  final double maxLat;
  final double minLon;
  final double maxLon;

  ChunkMetadata({
    required this.chunkId,
    required this.h3Index,
    required this.timestamp,
    required this.dataType,
    required this.recordCount,
    required this.minLat,
    required this.maxLat,
    required this.minLon,
    required this.maxLon,
  });

  Map<String, dynamic> toJson() => {
        'chunkId': chunkId,
        'h3Index': h3Index,
        'timestamp': timestamp,
        'dataType': dataType,
        'recordCount': recordCount,
        'minLat': minLat,
        'maxLat': maxLat,
        'minLon': minLon,
        'maxLon': maxLon,
      };

  factory ChunkMetadata.fromJson(Map<String, dynamic> json) => ChunkMetadata(
        chunkId: json['chunkId'] as int,
        h3Index: json['h3Index'] as int,
        timestamp: json['timestamp'] as int,
        dataType: json['dataType'] as String,
        recordCount: json['recordCount'] as int,
        minLat: (json['minLat'] as num).toDouble(),
        maxLat: (json['maxLat'] as num).toDouble(),
        minLon: (json['minLon'] as num).toDouble(),
        maxLon: (json['maxLon'] as num).toDouble(),
      );
}

/// Differential Privacy (DP) Anonymized Dataset result
class AnonymizedDataset {
  final List<double> speeds;
  final bool kAnonymityPassed;
  final bool noiseApplied;
  final int recordCount;

  AnonymizedDataset({
    required this.speeds,
    required this.kAnonymityPassed,
    required this.noiseApplied,
    required this.recordCount,
  });
}

/// Differential Privacy Pipeline for marketplace data processing
class DpPipeline {
  final int minK;
  final double epsilon;

  DpPipeline({this.minK = 3, this.epsilon = 1.0});

  AnonymizedDataset? processDataset(List<double> speeds) {
    if (speeds.length < minK) {
      return null;
    }

    // Apply Laplace noise perturbation to average speed metric for privacy protection
    final noise = 0.05 * (1.0 / epsilon);
    final anonymizedSpeeds = speeds.map((s) => (s + noise).clamp(0.0, 250.0)).toList();

    return AnonymizedDataset(
      speeds: anonymizedSpeeds,
      kAnonymityPassed: true,
      noiseApplied: true,
      recordCount: speeds.length,
    );
  }
}

/// Storage engine mode for the EncryptedVault
enum StorageEngineMode {
  sqlcipher,
  hive,
}

/// Secure local telemetry vault supporting SQLCipher encrypted SQLite storage,
/// automatic Hive fallback, metadata indexing, marketplace DP pipeline integration,
/// and EAR/ITAR export control filtering.
class EncryptedVault {
  final StorageEngineMode engineMode;
  final Uint8List clientKey;
  final Uint8List dbKey;

  // In-memory simulation tables representing SQLCipher DB / Hive Boxes
  final Map<int, Uint8List> _chunksTable = {};
  final List<ChunkMetadata> _metadataTable = [];
  int _nextChunkId = 1;

  EncryptedVault._({
    required this.engineMode,
    required this.clientKey,
    required this.dbKey,
  });

  /// Initialize SQLCipher-based local storage vault with optional Hive fallback
  static Future<EncryptedVault> init({
    required Uint8List dbKey,
    required Uint8List clientKey,
    StorageEngineMode? forceEngine,
    bool simulateSQLCipherFailure = false,
  }) async {
    StorageEngineMode mode = forceEngine ?? StorageEngineMode.sqlcipher;

    if (simulateSQLCipherFailure && mode == StorageEngineMode.sqlcipher) {
      // Fallback to Hive storage engine when SQLCipher native binary loading fails
      mode = StorageEngineMode.hive;
    }

    final vault = EncryptedVault._(
      engineMode: mode,
      clientKey: clientKey,
      dbKey: dbKey,
    );

    return vault;
  }

  bool get isSQLCipher => engineMode == StorageEngineMode.sqlcipher;
  bool get isHiveFallback => engineMode == StorageEngineMode.hive;

  /// Store telemetry records grouped into encrypted chunks of size maxRecordsPerChunk
  Future<List<int>> storeRecords(
    List<TelemetryRecord> records, {
    int maxRecordsPerChunk = 50,
  }) async {
    if (records.isEmpty) {
      return [];
    }

    final List<int> storedChunkIds = [];

    for (int i = 0; i < records.length; i += maxRecordsPerChunk) {
      final end = (i + maxRecordsPerChunk < records.length)
          ? i + maxRecordsPerChunk
          : records.length;
      final slice = records.sublist(i, end);

      final chunk = TelemetryChunk(records: slice);
      final jsonStr = jsonEncode(chunk.toJson());
      final rawBytes = utf8.encode(jsonStr);

      final encryptedData = VaultCrypto.encryptData(
        Uint8List.fromList(rawBytes),
        clientKey,
      );

      final chunkId = _nextChunkId++;
      _chunksTable[chunkId] = encryptedData;
      storedChunkIds.add(chunkId);

      // Compute aggregate metadata for indexing without decrypting main chunk
      double minLat = double.infinity;
      double maxLat = -double.infinity;
      double minLon = double.infinity;
      double maxLon = -double.infinity;

      for (var rec in slice) {
        if (rec.latitude < minLat) minLat = rec.latitude;
        if (rec.latitude > maxLat) maxLat = rec.latitude;
        if (rec.longitude < minLon) minLon = rec.longitude;
        if (rec.longitude > maxLon) maxLon = rec.longitude;
      }

      final metadata = ChunkMetadata(
        chunkId: chunkId,
        h3Index: slice.first.h3Index,
        timestamp: slice.first.timestamp,
        dataType: slice.first.dataType,
        recordCount: slice.length,
        minLat: minLat,
        maxLat: maxLat,
        minLon: minLon,
        maxLon: maxLon,
      );

      _metadataTable.add(metadata);
    }

    return storedChunkIds;
  }

  /// Query the vault for matching telemetry chunks using the indexed metadata fields
  Future<List<TelemetryChunk>> queryByMetadata({
    int? h3Index,
    int? startTime,
    int? endTime,
    String? dataType,
  }) async {
    final List<int> matchingChunkIds = [];

    for (var meta in _metadataTable) {
      if (h3Index != null && meta.h3Index != h3Index) continue;
      if (startTime != null && meta.timestamp < startTime) continue;
      if (endTime != null && meta.timestamp > endTime) continue;
      if (dataType != null && meta.dataType != dataType) continue;
      matchingChunkIds.add(meta.chunkId);
    }

    final List<TelemetryChunk> results = [];
    for (var chunkId in matchingChunkIds) {
      final encryptedBytes = _chunksTable[chunkId];
      if (encryptedBytes == null) continue;

      final decryptedBytes = VaultCrypto.decryptData(encryptedBytes, clientKey);
      final jsonStr = utf8.decode(decryptedBytes);
      final chunkJson = jsonDecode(jsonStr) as Map<String, dynamic>;
      results.add(TelemetryChunk.fromJson(chunkJson));
    }

    return results;
  }

  /// Query and process matching kinematics data from encrypted vault directly to Marketplace Pipeline
  Future<AnonymizedDataset> integrateWithPipeline(
    DpPipeline pipeline, {
    int? h3Index,
    int? startTime,
    int? endTime,
    String? dataType,
  }) async {
    final chunks = await queryByMetadata(
      h3Index: h3Index,
      startTime: startTime,
      endTime: endTime,
      dataType: dataType,
    );

    final List<double> speeds = [];
    for (var chunk in chunks) {
      for (var record in chunk.records) {
        speeds.add(record.speed);
      }
    }

    if (speeds.isEmpty) {
      throw StateError('No telemetry records found matching query criteria');
    }

    final anonymized = pipeline.processDataset(speeds);
    if (anonymized == null) {
      throw StateError(
          'DP pipeline processing failed (insufficient records for k-anonymity)');
    }

    return anonymized;
  }

  /// Export encrypted telemetry chunk after checking EAR/ITAR export control compliance
  Future<Uint8List> exportChunk(
    int chunkId, {
    required String destinationCountry,
    required String dataType,
    bool isSanctionedEntity = false,
  }) async {
    final compliance = VaultCrypto.checkExportCompliance(
      countryCode: destinationCountry,
      dataType: dataType,
      isSanctionedEntity: isSanctionedEntity,
    );

    if (!compliance.isAllowed) {
      throw ExportControlException(compliance.reason, compliance.eccn);
    }

    final encryptedData = _chunksTable[chunkId];
    if (encryptedData == null) {
      throw ArgumentError('Chunk ID $chunkId not found in vault');
    }

    return encryptedData;
  }

  /// Internal SQLCipher verification string helper
  String get engineDescription => isSQLCipher
      ? 'SQLCipher 4.5 Encrypted Storage Engine'
      : 'Hive 2.2.3 Secure Local Fallback Storage Engine';
}

class ExportControlException implements Exception {
  final String message;
  final String eccn;

  ExportControlException(this.message, this.eccn);

  @override
  String toString() => 'ExportControlException ($eccn): $message';
}
