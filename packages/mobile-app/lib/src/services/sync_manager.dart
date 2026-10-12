import 'dart:async';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:gara_g_pilot/src/rust/api.dart';

class SyncManager {
  static final SyncManager _instance = SyncManager._internal();
  factory SyncManager() => _instance;
  SyncManager._internal();

  final Connectivity _connectivity = Connectivity();
  StreamSubscription<List<ConnectivityResult>>? _subscription;
  bool _isSyncing = false;

  void start() {
    _subscription = _connectivity.onConnectivityChanged.listen(_handleConnectivityChange);
    // Initial check
    _connectivity.checkConnectivity().then(_handleConnectivityChange);
  }

  void stop() {
    _subscription?.cancel();
  }

  Future<void> _handleConnectivityChange(List<ConnectivityResult> results) async {
    // If any of the results is wifi, we can sync
    final hasWifi = results.contains(ConnectivityResult.wifi);

    if (hasWifi && !_isSyncing) {
      await _performSync();
    }
  }

  Future<void> _performSync() async {
    _isSyncing = true;
    print("WiFi detected. Starting background sync...");

    try {
      final syncedCount = await syncTelemetryToCloud();
      print("Sync complete. $syncedCount records uploaded.");
    } catch (e) {
      print("Sync error: $e");
    } finally {
      _isSyncing = false;
    }
  }

  /// Manual trigger for sync (e.g. from UI)
  Future<void> forceSync() async {
    final connectivity = await _connectivity.checkConnectivity();
    if (connectivity.contains(ConnectivityResult.wifi)) {
      await _performSync();
    } else {
      print("Sync skipped: No WiFi connection.");
    }
  }
}
