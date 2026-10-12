import 'package:flutter/foundation.dart';

/// AppProvider manages global mobile application state including
/// Pro tier gating (nodeGate & billing), EdgeMesh status, Xavier NS status,
/// and Encrypted Vault initialization status.
class AppProvider extends ChangeNotifier {
  // Pro status gating state
  bool _isProUser = false;
  String _nodeStatus = 'inactive';
  DateTime? _lastNodeHeartbeat;
  bool _stripeBillingActive = false;

  // EdgeMesh state
  bool _isEdgeMeshConnected = false;
  String _edgeMeshNodeId = '';

  // Xavier NS state (:8006 service)
  bool _isXavierConnected = false;
  String _xavierEndpoint = 'http://localhost:8006';

  // Encrypted Vault state
  bool _isVaultInitialized = false;
  int _vaultRecordCount = 0;

  // Getters
  bool get isProUser => _isProUser;
  String get nodeStatus => _nodeStatus;
  DateTime? get lastNodeHeartbeat => _lastNodeHeartbeat;
  bool get stripeBillingActive => _stripeBillingActive;

  bool get isEdgeMeshConnected => _isEdgeMeshConnected;
  String get edgeMeshNodeId => _edgeMeshNodeId;

  bool get isXavierConnected => _isXavierConnected;
  String get xavierEndpoint => _xavierEndpoint;

  bool get isVaultInitialized => _isVaultInitialized;
  int get vaultRecordCount => _vaultRecordCount;

  /// Update node active status and heartbeat for Pro gate check (heartbeat <= 60s)
  void updateNodeStatus({required String status, DateTime? lastHeartbeat}) {
    _nodeStatus = status;
    _lastNodeHeartbeat = lastHeartbeat ?? DateTime.now();
    _reevaluateProStatus();
    notifyListeners();
  }

  /// Update Stripe billing status for cloud backup/Socio status
  void updateStripeBilling({required bool active}) {
    _stripeBillingActive = active;
    _reevaluateProStatus();
    notifyListeners();
  }

  /// Explicitly set Pro user status
  void setProUser(bool value) {
    _isProUser = value;
    notifyListeners();
  }

  /// Re-evaluate Pro status: node active + heartbeat within 60 seconds OR active Stripe billing
  void _reevaluateProStatus() {
    final now = DateTime.now();
    final isNodeActive = _nodeStatus == 'active' &&
        _lastNodeHeartbeat != null &&
        now.difference(_lastNodeHeartbeat!).inSeconds <= 60;
    _isProUser = isNodeActive || _stripeBillingActive;
  }

  /// Check if a Pro-gated feature is accessible
  bool isFeatureUnlocked(String featureKey) {
    // Basic features are unlocked for all users
    const basicFeatures = {'dashcam', 'telemetry', 'obd', 'wallet', 'v2v'};
    if (basicFeatures.contains(featureKey.toLowerCase())) {
      return true;
    }
    // Advanced fleet, marketplace analytics, and cloud backup require Pro status
    return _isProUser;
  }

  /// Set EdgeMesh connection state
  void setEdgeMeshStatus({required bool connected, String nodeId = ''}) {
    _isEdgeMeshConnected = connected;
    _edgeMeshNodeId = nodeId;
    notifyListeners();
  }

  /// Set Xavier NS connection state
  void setXavierStatus({required bool connected, String? endpoint}) {
    _isXavierConnected = connected;
    if (endpoint != null) _xavierEndpoint = endpoint;
    notifyListeners();
  }

  /// Set Encrypted Vault status
  void setVaultStatus({required bool initialized, int recordCount = 0}) {
    _isVaultInitialized = initialized;
    _vaultRecordCount = recordCount;
    notifyListeners();
  }
}
