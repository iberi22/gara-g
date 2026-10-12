/// V2V Provider - State Management
/// Manages V2V communication state with Provider pattern
/// Now powered by Rust backend for cryptographic operations and VaultService for delegated wallet signing

import 'dart:async';
import 'package:flutter/foundation.dart';
import '../services/ble_service.dart';
import '../services/v2v_service.dart';
import '../services/vaultService.dart';
import '../services/blockchain_service.dart';
import '../services/mesh_service.dart';
import '../rust/api.dart' as rust;

import 'dart:io';
import 'package:record/record.dart';
import 'package:path_provider/path_provider.dart';

class V2VProvider extends ChangeNotifier {
  final V2VService _v2vService = V2VService();
  final BleService _bleService = BleService();
  final VaultService _vaultService = VaultService();
  final AudioRecorder _audioRecorder = AudioRecorder();
  final BlockchainService _blockchainService = BlockchainService();
  final MeshService _meshService = MeshService();

  // State
  Timer? _syncTimer;
  String? _recordingPath;
  bool _isWalletLoading = true;
  bool _isInitialized = false;
  bool _isActive = false;
  List<NearbyVehicle> _nearbyVehicles = [];
  final Map<String, List<V2VMessage>> _messages = {};
  final Map<String, int> _unreadCounts = {};
  bool _isRecording = false;

  // Rewards state (from Rust backend)
  BigInt _pendingReward = BigInt.zero;
  BigInt _totalEarned = BigInt.zero;
  int _messageCount = 0;

  // Subscriptions
  StreamSubscription? _vehiclesSub;
  StreamSubscription? _messagesSub;
  StreamSubscription? _rewardsSub;
  StreamSubscription? _blePacketSub;

  // Getters
  bool get isWalletLoading => _isWalletLoading;
  bool get isInitialized => _isInitialized;
  bool get isActive => _isActive;
  List<NearbyVehicle> get nearbyVehicles => _nearbyVehicles;
  bool get isRecording => _isRecording;
  BigInt get pendingReward => _pendingReward;
  BigInt get totalEarned => _totalEarned;
  int get messageCount => _messageCount;
  String? get myVehicleId => _v2vService.myVehicleId;

  /// Initialize provider: Connect swal-vault -> Initialize identity
  V2VProvider() {
    _loadWalletAndInitialize();
  }

  Future<void> _loadWalletAndInitialize() async {
    try {
      _isWalletLoading = true;
      notifyListeners();

      await _vaultService.connectVault();
      await initialize(deviceName: 'Gara-G User');
    } catch (e) {
      debugPrint('❌ Error initializing V2V Provider: $e');
    } finally {
      _isWalletLoading = false;
      notifyListeners();
    }
  }

  /// Initialize the provider with Rust backend
  Future<void> initialize({
    required String deviceName,
    List<int>? savedSecretKey,
  }) async {
    _isInitialized = true;
    _setupListeners();
    notifyListeners();
  }

  void _setupListeners() {
    // Start reward sync timer
    _syncTimer?.cancel();
    _syncTimer = Timer.periodic(const Duration(minutes: 5), (_) => syncRewardsNow());

    // Listen to nearby vehicles changes
    _vehiclesSub = _v2vService.nearbyVehicles.listen((vehicles) {
      _nearbyVehicles = vehicles;
      notifyListeners();
    });

    // Listen to incoming messages
    _messagesSub = _v2vService.incomingMessages.listen((message) {
      final senderId = message.senderId;
      _messages.putIfAbsent(senderId, () => []);
      _messages[senderId]!.add(message);

      // Increment unread count
      _unreadCounts[senderId] = (_unreadCounts[senderId] ?? 0) + 1;

      notifyListeners();
    });

    // Listen to reward updates
    _rewardsSub = _v2vService.rewardUpdates.listen((reward) {
      _pendingReward = reward;
      notifyListeners();
    });

    // Listen to incoming BLE packets
    _blePacketSub = _bleService.blePacketStream.listen((packet) {
      debugPrint('Provider received BLE packet: $packet');
      final sentinelVehicle = NearbyVehicle(
        endpointId: 'sentinel',
        deviceName: 'Gara Sentinel',
        discoveredAt: DateTime.now(),
        isConnected: true,
        isSentinel: true,
      );

      _nearbyVehicles.removeWhere((v) => v.isSentinel);
      _nearbyVehicles.add(sentinelVehicle);

      notifyListeners();
    });
  }

  /// Get messages for a specific vehicle
  List<V2VMessage> getMessages(String endpointId) {
    final serviceHistory = _v2vService.getMessageHistory(endpointId);
    return serviceHistory;
  }

  /// Get unread count for a specific vehicle
  int getUnreadCount(String endpointId) {
    return _unreadCounts[endpointId] ?? 0;
  }

  /// Mark messages as read
  void markAsRead(String endpointId) {
    _unreadCounts[endpointId] = 0;
    notifyListeners();
  }

  /// Start V2V communication
  Future<void> startV2V() async {
    try {
      await _bleService.startScan();
      await _meshService.startAdvertising();
      await _meshService.startDiscovery();
      final success = await _v2vService.startV2V();
      _isActive = success;
      notifyListeners();
    } catch (e) {
      debugPrint('Error starting V2V: $e');
      rethrow;
    }
  }

  /// Stop V2V communication
  Future<void> stopV2V() async {
    await _v2vService.stopV2V();
    _isActive = false;
    _nearbyVehicles = [];
    notifyListeners();
  }

  /// Send text message
  ///
  /// El texto sale solo por la ruta firmada a `endpointId`. Antes se emitia
  /// ademas con `_meshService.sendPayload(...)`, que hace broadcast a TODOS los
  /// dispositivos conectados: el chat "privado" salia en claro a la malla entera.
  Future<void> sendTextMessage(String endpointId, String text) async {
    await _v2vService.sendTextMessage(endpointId, text);
    notifyListeners();
  }

  /// Send quick message to specific vehicle
  Future<void> sendQuickMessage(String endpointId, QuickMessage type) async {
    await _v2vService.sendQuickMessage(endpointId, type);
    notifyListeners();
  }

  /// Broadcast quick message to ALL nearby vehicles
  Future<void> broadcastQuickMessage(QuickMessage type) async {
    for (final vehicle in _nearbyVehicles) {
      if (vehicle.isConnected) {
        await sendQuickMessage(vehicle.endpointId, type);
      }
    }
  }

  /// Send location to specific vehicle
  Future<void> sendLocation(String endpointId) async {
    try {
      await _v2vService.sendLocation(endpointId);
      notifyListeners();
    } catch (e) {
      debugPrint('Error sending location: $e');
    }
  }

  /// Broadcast emergency to ALL nearby vehicles
  Future<void> broadcastEmergency(String message) async {
    await _v2vService.broadcastEmergency(message);
    notifyListeners();
  }

  // ===== Reward Methods =====

  /// Refresh reward stats from Rust backend
  Future<void> refreshRewardStats() async {
    try {
      final (msgCount, total) = await _v2vService.getRewardStats();
      _messageCount = msgCount.toInt();
      _totalEarned = total;
      _pendingReward = await _v2vService.getMyPendingRewards();
      notifyListeners();
    } catch (e) {
      debugPrint('Error refreshing reward stats: $e');
    }
  }

  /// Get formatted pending reward string (e.g., "0.005 GARA")
  Future<String> getFormattedPendingReward() async {
    return _v2vService.getFormattedRewards();
  }

  /// Get base reward for a message type
  Future<BigInt> getBaseRewardForType(V2VMessageType type) async {
    return rust.getBaseReward(messageType: type.index);
  }

  /// Get DC cost for a message type
  Future<BigInt> getDcCostForType(V2VMessageType type) async {
    return rust.getDcCost(messageType: type.index);
  }

  /// Flush rewards for blockchain submission
  Future<String> prepareRewardsForBlockchain() async {
    final rewardsJson = await _v2vService.flushRewardsForSubmission();
    _pendingReward = BigInt.zero;
    notifyListeners();
    return rewardsJson;
  }

  /// Start voice recording
  Future<void> startVoiceRecording() async {
    try {
      if (await _audioRecorder.hasPermission()) {
        final dir = await getTemporaryDirectory();
        _recordingPath = '${dir.path}/temp_voice_msg.m4a';

        await _audioRecorder.start(
          const RecordConfig(encoder: AudioEncoder.aacLc),
          path: _recordingPath!,
        );

        _isRecording = true;
        notifyListeners();
        debugPrint('🎙️ Recording started at $_recordingPath');
      } else {
        debugPrint('❌ Microphone permission denied');
      }
    } catch (e) {
      debugPrint('❌ Error starting recording: $e');
    }
  }

  /// Stop recording and send voice message
  Future<void> stopAndSendVoiceMessage(String endpointId) async {
    if (!_isRecording) return;

    try {
      final path = await _audioRecorder.stop();
      _isRecording = false;
      notifyListeners();

      if (path != null) {
        final file = File(path);
        if (await file.exists()) {
          final bytes = await file.readAsBytes();

          debugPrint('📨 Sending voice message (${bytes.length} bytes)');
          await _v2vService.sendVoiceMessage(endpointId, bytes);

          try {
            await file.delete();
          } catch (_) {}
        }
      }
    } catch (e) {
      debugPrint('❌ Error stopping recording: $e');
    }
  }

  /// Export delegated wallet secret or public key bytes
  Future<List<int>> exportWalletSecret() async {
    return List<int>.filled(32, 0);
  }

  /// Update device name
  Future<void> updateDeviceName(String newName) async {
    await initialize(deviceName: newName);
    notifyListeners();
  }

  /// Reset delegated wallet connection
  Future<void> resetWallet() async {
    await _vaultService.disconnectVault();
    await _loadWalletAndInitialize();
  }

  /// Sync rewards to blockchain manually
  Future<void> syncRewardsNow() async {
    if (!_isInitialized) return;
    try {
      debugPrint("⏳ Checking for pending rewards...");
      final proofJson = await rust.getAllPendingRewards();
      if (proofJson == "[]" || proofJson.isEmpty) return;

      final success = await _blockchainService.submitRewardProof(proofJson);

      if (success) {
        await rust.flushPendingRewards();
        final stats = await rust.getRewardStats();
        _messageCount = stats.$1.toInt();
        _totalEarned = stats.$2;
        _pendingReward = BigInt.zero;
        notifyListeners();
        debugPrint("💰 Rewards synced and flushed.");
      }
    } catch (e) {
      debugPrint("❌ Sync error: $e");
    }
  }

  @override
  void dispose() {
    _syncTimer?.cancel();
    _vehiclesSub?.cancel();
    _messagesSub?.cancel();
    _rewardsSub?.cancel();
    _blePacketSub?.cancel();
    _v2vService.stopV2V();
    _bleService.dispose();
    super.dispose();
  }
}
