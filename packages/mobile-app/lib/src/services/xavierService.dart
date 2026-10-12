import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;

/// Health status returned when probing Xavier node.
class XavierHealthStatus {
  final bool alive;
  final String endpoint;
  final int latencyMs;
  final DateTime timestamp;
  final String? status;
  final String? version;

  XavierHealthStatus({
    required this.alive,
    required this.endpoint,
    required this.latencyMs,
    required this.timestamp,
    this.status,
    this.version,
  });
}

/// Result returned after applying a 60s heartbeat to Xavier node.
class XavierHeartbeatResult {
  final bool success;
  final String endpoint;
  final DateTime timestamp;
  final DateTime nextHeartbeat;
  final String? error;

  XavierHeartbeatResult({
    required this.success,
    required this.endpoint,
    required this.timestamp,
    required this.nextHeartbeat,
    this.error,
  });
}

/// Key-value memory record stored for xavier-memory-node sync.
class XavierMemoryRecord {
  final String id;
  final String key;
  final dynamic value;
  final DateTime timestamp;
  final String instanceId;
  final String namespace;
  bool synced;
  final int version;

  XavierMemoryRecord({
    required this.id,
    required this.key,
    required this.value,
    required this.timestamp,
    required this.instanceId,
    required this.namespace,
    this.synced = false,
    this.version = 1,
  });

  Map<String, dynamic> toJson() => {
        'id': id,
        'key': key,
        'value': value,
        'timestamp': timestamp.millisecondsSinceEpoch,
        'instanceId': instanceId,
        'namespace': namespace,
        'synced': synced,
        'version': version,
      };
}

/// Sync status returned by XavierService.
class XavierSyncResult {
  final DateTime? lastSyncedAt;
  final int unsyncedCount;
  final int totalEntries;
  final bool isOnline;
  final String endpoint;
  final String? error;

  XavierSyncResult({
    this.lastSyncedAt,
    required this.unsyncedCount,
    required this.totalEntries,
    required this.isOnline,
    required this.endpoint,
    this.error,
  });
}

/// XavierService provides Xavier namespace app/gara-g/instance/$instanceId resolution,
/// health probing, 60s heartbeat loop, and xavier-memory-node sync for mobile app.
class XavierService {
  static final XavierService _instance = XavierService._internal();
  factory XavierService() => _instance;
  XavierService._internal();

  static const String defaultEndpoint = 'http://localhost:8006';
  static const Duration defaultHeartbeatInterval = Duration(seconds: 60);

  String _instanceId = 'gara-g-mobile-instance';
  String _endpoint = defaultEndpoint;
  Timer? _heartbeatTimer;
  DateTime? _lastSyncedAt;

  final List<XavierMemoryRecord> _memoryRecords = [];

  String get instanceId => _instanceId;
  String get endpoint => _endpoint;

  void setInstanceId(String id) {
    if (id.trim().isNotEmpty) {
      _instanceId = id.trim();
    }
  }

  void setEndpoint(String url) {
    if (url.trim().isNotEmpty) {
      _endpoint = url.trim();
    }
  }

  /// Formats the canonical Xavier namespace string: app/gara-g/instance/$instanceId
  String getNamespace([String? customInstanceId]) {
    final id = customInstanceId ?? _instanceId;
    return 'app/gara-g/instance/$id';
  }

  /// Probes Xavier node health status at http://localhost:8006 or custom endpoint.
  Future<XavierHealthStatus> probeXavierHealth({
    String? endpoint,
    http.Client? client,
    Duration timeout = const Duration(seconds: 3),
  }) async {
    final activeEndpoint = endpoint ?? _endpoint;
    final stopwatch = Stopwatch()..start();
    final url = Uri.parse('${activeEndpoint.replaceAll(RegExp(r'/$'), '')}/health');
    final httpClient = client ?? http.Client();

    try {
      final response = await httpClient.get(
        url,
        headers: {'Accept': 'application/json'},
      ).timeout(timeout);

      stopwatch.stop();
      final latency = stopwatch.elapsedMilliseconds;

      if (response.statusCode == 200) {
        Map<String, dynamic> data = {};
        try {
          data = jsonDecode(response.body) as Map<String, dynamic>;
        } catch (_) {}

        return XavierHealthStatus(
          alive: true,
          endpoint: activeEndpoint,
          latencyMs: latency,
          timestamp: DateTime.now(),
          status: data['status']?.toString() ?? 'ok',
          version: data['version']?.toString() ?? '1.0.0',
        );
      }

      return XavierHealthStatus(
        alive: false,
        endpoint: activeEndpoint,
        latencyMs: latency,
        timestamp: DateTime.now(),
        status: 'HTTP ${response.statusCode}',
      );
    } catch (e) {
      stopwatch.stop();
      return XavierHealthStatus(
        alive: false,
        endpoint: activeEndpoint,
        latencyMs: stopwatch.elapsedMilliseconds,
        timestamp: DateTime.now(),
        status: e.toString(),
      );
    } finally {
      if (client == null) {
        httpClient.close();
      }
    }
  }

  /// Applies a single 60s heartbeat ping to the Xavier node.
  Future<XavierHeartbeatResult> applyHeartbeat({
    String? endpoint,
    Map<String, dynamic>? metadata,
    http.Client? client,
    Duration timeout = const Duration(seconds: 3),
  }) async {
    final activeEndpoint = endpoint ?? _endpoint;
    final namespace = getNamespace();
    final url = Uri.parse('${activeEndpoint.replaceAll(RegExp(r'/$'), '')}/heartbeat');
    final httpClient = client ?? http.Client();

    final payloadMap = <String, dynamic>{
      'instanceId': _instanceId,
      'namespace': namespace,
      'timestamp': DateTime.now().millisecondsSinceEpoch,
      'heartbeatIntervalSec': 60,
      'status': 'active',
    };
    if (metadata != null) {
      payloadMap['metadata'] = metadata;
    }
    final bodyPayload = jsonEncode(payloadMap);

    try {
      final response = await httpClient.post(
        url,
        headers: {'Content-Type': 'application/json'},
        body: bodyPayload,
      ).timeout(timeout);

      final now = DateTime.now();
      final nextHeartbeat = now.add(defaultHeartbeatInterval);

      if (response.statusCode == 200 || response.statusCode == 201) {
        return XavierHeartbeatResult(
          success: true,
          endpoint: activeEndpoint,
          timestamp: now,
          nextHeartbeat: nextHeartbeat,
        );
      }

      return XavierHeartbeatResult(
        success: false,
        endpoint: activeEndpoint,
        timestamp: now,
        nextHeartbeat: nextHeartbeat,
        error: 'HTTP ${response.statusCode}',
      );
    } catch (e) {
      final now = DateTime.now();
      return XavierHeartbeatResult(
        success: false,
        endpoint: activeEndpoint,
        timestamp: now,
        nextHeartbeat: now.add(defaultHeartbeatInterval),
        error: e.toString(),
      );
    } finally {
      if (client == null) {
        httpClient.close();
      }
    }
  }

  /// Starts periodic 60-second heartbeat timer.
  void startHeartbeatLoop({
    String? endpoint,
    Duration interval = defaultHeartbeatInterval,
    void Function(XavierHeartbeatResult)? onTick,
  }) {
    stopHeartbeatLoop();
    final activeEndpoint = endpoint ?? _endpoint;

    // Run initial heartbeat immediately
    applyHeartbeat(endpoint: activeEndpoint).then((result) {
      if (onTick != null) onTick(result);
    });

    _heartbeatTimer = Timer.periodic(interval, (_) async {
      final result = await applyHeartbeat(endpoint: activeEndpoint);
      if (onTick != null) onTick(result);
    });
  }

  /// Stops running heartbeat timer.
  void stopHeartbeatLoop() {
    _heartbeatTimer?.cancel();
    _heartbeatTimer = null;
  }

  /// Saves a memory entry locally and marks for sync.
  XavierMemoryRecord saveMemoryEntry(
    String key,
    dynamic value, {
    String? customInstanceId,
  }) {
    final targetInstanceId = customInstanceId ?? _instanceId;
    final namespace = getNamespace(targetInstanceId);

    final existingIndex = _memoryRecords.indexWhere(
      (r) => r.key == key && r.instanceId == targetInstanceId,
    );

    XavierMemoryRecord record;
    if (existingIndex >= 0) {
      final oldRecord = _memoryRecords[existingIndex];
      record = XavierMemoryRecord(
        id: oldRecord.id,
        key: key,
        value: value,
        timestamp: DateTime.now(),
        instanceId: targetInstanceId,
        namespace: namespace,
        synced: false,
        version: oldRecord.version + 1,
      );
      _memoryRecords[existingIndex] = record;
    } else {
      record = XavierMemoryRecord(
        id: 'mem_${DateTime.now().millisecondsSinceEpoch}_${key.hashCode}',
        key: key,
        value: value,
        timestamp: DateTime.now(),
        instanceId: targetInstanceId,
        namespace: namespace,
        synced: false,
        version: 1,
      );
      _memoryRecords.add(record);
    }

    return record;
  }

  /// Returns stored memory entries for an instance ID.
  List<XavierMemoryRecord> getMemoryEntries([String? customInstanceId]) {
    final targetInstanceId = customInstanceId ?? _instanceId;
    return _memoryRecords.where((r) => r.instanceId == targetInstanceId).toList();
  }

  /// Synchronizes memory records with xavier-memory-node.
  Future<XavierSyncResult> syncMemoryNode({
    String? endpoint,
    http.Client? client,
  }) async {
    final activeEndpoint = endpoint ?? _endpoint;
    final health = await probeXavierHealth(endpoint: activeEndpoint, client: client);

    final unsynced = _memoryRecords.where((r) => !r.synced && r.instanceId == _instanceId).toList();
    final totalCount = _memoryRecords.where((r) => r.instanceId == _instanceId).length;

    if (!health.alive) {
      return XavierSyncResult(
        lastSyncedAt: _lastSyncedAt,
        unsyncedCount: unsynced.length,
        totalEntries: totalCount,
        isOnline: false,
        endpoint: activeEndpoint,
        error: 'Node offline: ${health.status}',
      );
    }

    if (unsynced.isEmpty) {
      _lastSyncedAt = DateTime.now();
      return XavierSyncResult(
        lastSyncedAt: _lastSyncedAt,
        unsyncedCount: 0,
        totalEntries: totalCount,
        isOnline: true,
        endpoint: activeEndpoint,
      );
    }

    final url = Uri.parse('${activeEndpoint.replaceAll(RegExp(r'/$'), '')}/memory/sync');
    final httpClient = client ?? http.Client();

    try {
      final response = await httpClient.post(
        url,
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'instanceId': _instanceId,
          'namespace': getNamespace(),
          'records': unsynced.map((r) => r.toJson()).toList(),
        }),
      ).timeout(const Duration(seconds: 3));

      if (response.statusCode == 200 || response.statusCode == 201) {
        for (var record in unsynced) {
          record.synced = true;
        }
        _lastSyncedAt = DateTime.now();

        return XavierSyncResult(
          lastSyncedAt: _lastSyncedAt,
          unsyncedCount: 0,
          totalEntries: totalCount,
          isOnline: true,
          endpoint: activeEndpoint,
        );
      }

      return XavierSyncResult(
        lastSyncedAt: _lastSyncedAt,
        unsyncedCount: unsynced.length,
        totalEntries: totalCount,
        isOnline: true,
        endpoint: activeEndpoint,
        error: 'HTTP ${response.statusCode}',
      );
    } catch (e) {
      return XavierSyncResult(
        lastSyncedAt: _lastSyncedAt,
        unsyncedCount: unsynced.length,
        totalEntries: totalCount,
        isOnline: false,
        endpoint: activeEndpoint,
        error: e.toString(),
      );
    } finally {
      if (client == null) {
        httpClient.close();
      }
    }
  }
}
