/// Vehicle-to-Vehicle (V2V) Communication Service
///
/// Uses Google Nearby Connections API to enable:
/// - Automatic discovery of nearby Gara-G users
/// - Real-time messaging between vehicles
/// - Voice message transmission
/// - Emergency alerts broadcast
///
/// Backend: Rust (cryptographic signing + rewards via flutter_rust_bridge)

import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'package:nearby_connections/nearby_connections.dart';
import 'package:geolocator/geolocator.dart';
import 'package:sensors_plus/sensors_plus.dart';
import 'package:uuid/uuid.dart';

// Rust backend APIs
import '../rust/api.dart' as rust;
import '../rust/frb_generated.dart';
import '../models/user_activity_model.dart';
import 'trip_service.dart';

/// Message types for V2V communication (mirrors Rust V2VMessageType)
enum V2VMessageType {
  /// Text chat message
  text,        // 0
  /// Voice message (audio bytes)
  voice,       // 1
  /// Quick preset message (hazard, thanks, etc)
  quickMessage, // 2
  /// Location share
  location,    // 3
  /// Emergency alert
  emergency,   // 4
  /// Telemetry data
  telemetry,   // 5
}

/// Quick preset messages for one-tap communication (mirrors Rust QuickMessage)
enum QuickMessage {
  thanks,         // 0 - 👍 ¡Gracias!
  sorry,          // 1 - 🙏 Disculpa
  hazardAhead,    // 2 - ⚠️ Peligro adelante
  policeAhead,    // 3 - 🚔 Policía adelante
  trafficJam,     // 4 - 🚗 Tráfico
  accidentAhead,  // 5 - 🚨 Accidente
  roadWork,       // 6 - 🚧 Obra en vía
  fuelStation,    // 7 - ⛽ Gasolinera cerca
  turnSignal,     // 8 - 🔄 Tu direccional
  lightsOn;       // 9 - 💡 Tus luces

  /// Get display text from Rust backend
  Future<String> getDisplayText() async {
    return rust.getQuickMessageText(quickType: index);
  }

  /// Sync getter (cached)
  String get displayText {
    const texts = [
      '👍 ¡Gracias!',
      '🙏 Disculpa',
      '⚠️ Peligro adelante',
      '🚔 Policía adelante',
      '🚗 Tráfico',
      '🚨 Accidente',
      '🚧 Obra en vía',
      '⛽ Gasolinera cerca',
      '🔄 Tu direccional',
      '💡 Tus luces',
    ];
    return texts[index];
  }
}

/// Represents a nearby vehicle/user
class NearbyVehicle {
  final String endpointId;
  final String deviceName;
  final String? vehicleId;
  final DateTime discoveredAt;
  DateTime lastSeen;
  Position? lastKnownPosition;
  int signalStrength; // Approximate based on discovery order
  bool isConnected;
  final bool isSentinel;

  NearbyVehicle({
    required this.endpointId,
    required this.deviceName,
    this.vehicleId,
    required this.discoveredAt,
    this.lastKnownPosition,
    this.signalStrength = 0,
    this.isConnected = false,
    this.isSentinel = false,
  }) : lastSeen = discoveredAt;

  void updateLastSeen() {
    lastSeen = DateTime.now();
  }
}

/// A message sent/received via V2V
/// Now with cryptographic signing via Rust backend
class V2VMessage {
  final String id;
  final String senderId;
  final String? senderName;
  final V2VMessageType type;
  final dynamic payload; // String for text, Uint8List for voice, etc.
  final DateTime timestamp;
  final Position? senderPosition;
  final bool isOutgoing;
  final String? signature; // Ed25519 signature from Rust
  final bool isVerified;   // Signature verification status

  V2VMessage({
    String? id,
    required this.senderId,
    this.senderName,
    required this.type,
    required this.payload,
    DateTime? timestamp,
    this.senderPosition,
    this.isOutgoing = false,
    this.signature,
    this.isVerified = false,
  })  : id = id ?? const Uuid().v4(),
        timestamp = timestamp ?? DateTime.now();

  Map<String, dynamic> toJson() => {
        'id': id,
        'senderId': senderId,
        'senderName': senderName,
        'type': type.index,
        'payload': type == V2VMessageType.voice
            ? base64Encode(payload as Uint8List)
            : payload,
        'timestamp': timestamp.millisecondsSinceEpoch,
        'lat': senderPosition?.latitude,
        'lon': senderPosition?.longitude,
        if (signature != null) 'signature': signature,
      };

  factory V2VMessage.fromJson(Map<String, dynamic> json, {bool isOutgoing = false}) {
    final type = V2VMessageType.values[json['type'] as int];
    dynamic payload = json['payload'];
    if (type == V2VMessageType.voice && payload is String) {
      payload = base64Decode(payload);
    }

    Position? position;
    if (json['lat'] != null && json['lon'] != null) {
      position = Position(
        latitude: json['lat'] as double,
        longitude: json['lon'] as double,
        timestamp: DateTime.now(),
        accuracy: 0,
        altitude: 0,
        altitudeAccuracy: 0,
        heading: 0,
        headingAccuracy: 0,
        speed: 0,
        speedAccuracy: 0,
      );
    }

    return V2VMessage(
      id: json['id'] as String,
      senderId: json['senderId'] as String,
      senderName: json['senderName'] as String?,
      type: type,
      payload: payload,
      timestamp: DateTime.fromMillisecondsSinceEpoch(json['timestamp'] as int),
      senderPosition: position,
      isOutgoing: isOutgoing,
      signature: json['signature'] as String?,
      isVerified: json['is_verified'] as bool? ?? false,
    );
  }

  /// Create from Rust-signed JSON
  static Future<V2VMessage?> fromSignedJson(String signedJson, {bool isOutgoing = false}) async {
    try {
      final json = jsonDecode(signedJson) as Map<String, dynamic>;
      final isVerified = await rust.verifyMessage(messageJson: signedJson);

      final type = V2VMessageType.values[json['msg_type'] as int];
      dynamic payload = json['payload'];

      // Handle voice messages
      if (type == V2VMessageType.voice && payload is String) {
        payload = base64Decode(payload);
      }

      Position? position;
      final pos = json['position'] as Map<String, dynamic>?;
      if (pos != null) {
        position = Position(
          latitude: pos['lat'] as double,
          longitude: pos['lon'] as double,
          timestamp: DateTime.now(),
          accuracy: 0,
          altitude: 0,
          altitudeAccuracy: 0,
          heading: 0,
          headingAccuracy: 0,
          speed: 0,
          speedAccuracy: 0,
        );
      }

      return V2VMessage(
        id: json['id'] as String,
        senderId: json['sender_id'] as String,
        type: type,
        payload: payload,
        timestamp: DateTime.fromMillisecondsSinceEpoch(json['timestamp_ms'] as int),
        senderPosition: position,
        isOutgoing: isOutgoing,
        signature: json['signature'] as String?,
        isVerified: isVerified,
      );
    } catch (e) {
      print('Error parsing signed message: $e');
      return null;
    }
  }
}

/// Main V2V Communication Service
/// Now powered by Rust backend for cryptographic operations
class V2VService {
  static final V2VService _instance = V2VService._internal();
  factory V2VService() => _instance;
  V2VService._internal();

  late final TripService _tripService;
  StreamSubscription<TripState>? _tripStateSubscription;
  StreamSubscription<GyroscopeEvent>? _gyroscopeSubscription;
  TripState _currentTripState = TripState.Idle;
  bool _isPhoneMoving = false;

  final Nearby _nearby = Nearby();
  final String _serviceId = 'com.garag.v2v';

  String? _myEndpointId;
  String _myDeviceName = 'Gara-G User';
  String? _myVehicleId; // Now comes from Rust wallet (public key)
  Position? _currentPosition;

  bool _isRustInitialized = false;

  bool _isAdvertising = false;
  bool _isDiscovering = false;

  // Nearby vehicles discovered
  final Map<String, NearbyVehicle> _nearbyVehicles = {};

  // Connected endpoints
  final Set<String> _connectedEndpoints = {};

  // Message history per endpoint
  final Map<String, List<V2VMessage>> _messageHistory = {};

  // Stream controllers for reactive updates
  final _nearbyVehiclesController = StreamController<List<NearbyVehicle>>.broadcast();
  final _messagesController = StreamController<V2VMessage>.broadcast();
  final _connectionStateController = StreamController<Map<String, bool>>.broadcast();

  // Public streams
  Stream<List<NearbyVehicle>> get nearbyVehicles => _nearbyVehiclesController.stream;
  Stream<V2VMessage> get incomingMessages => _messagesController.stream;
  Stream<Map<String, bool>> get connectionStates => _connectionStateController.stream;

  // Reward stream for UI updates
  final _rewardController = StreamController<BigInt>.broadcast();
  Stream<BigInt> get rewardUpdates => _rewardController.stream;

  // Getters
  List<NearbyVehicle> get currentNearbyVehicles => _nearbyVehicles.values.toList();
  bool get isActive => _isAdvertising || _isDiscovering;
  String get myDeviceName => _myDeviceName;
  String? get myVehicleId => _myVehicleId;
  bool get isRustInitialized => _isRustInitialized;

  Future<void> init(TripService tripService) async {
    _tripService = tripService;
    _tripStateSubscription = _tripService.tripStateStream.listen((state) {
      _currentTripState = state;
      if (_currentTripState != TripState.Driving) {
        stopV2V();
      }
    });

    _gyroscopeSubscription = gyroscopeEvents.listen((GyroscopeEvent event) {
      _handleGyroscopeEvent(event);
    });
  }

  void _handleGyroscopeEvent(GyroscopeEvent event) {
    // Simple check for phone movement. A more sophisticated check could be used.
    if (event.x.abs() > 1.0 || event.y.abs() > 1.0 || event.z.abs() > 1.0) {
      _isPhoneMoving = true;
    } else {
      _isPhoneMoving = false;
    }
  }

  /// Export wallet secret for secure storage
  Future<Uint8List> exportWalletSecret() async {
    return rust.walletExportSecret();
  }

  void _startLocationUpdates() {
    Geolocator.getPositionStream(
      locationSettings: const LocationSettings(
        accuracy: LocationAccuracy.high,
        distanceFilter: 10, // Update every 10 meters
      ),
    ).listen((position) {
      _currentPosition = position;
    });
  }

  /// Start advertising and discovering nearby vehicles
  Future<bool> startV2V() async {
    if (_currentTripState != TripState.Driving || _isPhoneMoving) {
      return false;
    }
    try {
      // Start advertising (so others can find us)
      _isAdvertising = await _nearby.startAdvertising(
        _myDeviceName,
        Strategy.P2P_CLUSTER,
        onConnectionInitiated: _onConnectionInitiated,
        onConnectionResult: _onConnectionResult,
        onDisconnected: _onDisconnected,
        serviceId: _serviceId,
      );

      // Start discovering (to find others)
      _isDiscovering = await _nearby.startDiscovery(
        _myDeviceName,
        Strategy.P2P_CLUSTER,
        onEndpointFound: _onEndpointFound,
        onEndpointLost: _onEndpointLost,
        serviceId: _serviceId,
      );

      return _isAdvertising && _isDiscovering;
    } catch (e) {
      print('Error starting V2V: $e');
      return false;
    }
  }

  /// Stop all V2V activities
  Future<void> stopV2V() async {
    await _nearby.stopAdvertising();
    await _nearby.stopDiscovery();
    await _nearby.stopAllEndpoints();

    _isAdvertising = false;
    _isDiscovering = false;
    _nearbyVehicles.clear();
    _connectedEndpoints.clear();

    _nearbyVehiclesController.add([]);
  }

  // ===== Connection Callbacks =====

  void _onEndpointFound(String endpointId, String endpointName, String serviceId) {
    print('Found endpoint: $endpointName ($endpointId)');

    final vehicle = NearbyVehicle(
      endpointId: endpointId,
      deviceName: endpointName,
      discoveredAt: DateTime.now(),
      signalStrength: _nearbyVehicles.length, // Rough proximity estimate
    );

    _nearbyVehicles[endpointId] = vehicle;
    _nearbyVehiclesController.add(_nearbyVehicles.values.toList());

    // Auto-connect to discovered endpoints
    _requestConnection(endpointId);
  }

  void _onEndpointLost(String? endpointId) {
    if (endpointId != null) {
      print('Lost endpoint: $endpointId');
      _nearbyVehicles.remove(endpointId);
      _connectedEndpoints.remove(endpointId);
      _nearbyVehiclesController.add(_nearbyVehicles.values.toList());
    }
  }

  void _onConnectionInitiated(String endpointId, ConnectionInfo info) {
    print('Connection initiated with: ${info.endpointName}');

    // Auto-accept connections
    _nearby.acceptConnection(
      endpointId,
      onPayLoadRecieved: (endpointId, payload) => _onPayloadReceived(endpointId, payload),
      onPayloadTransferUpdate: _onPayloadTransferUpdate,
    );
  }

  void _onConnectionResult(String endpointId, Status status) {
    print('Connection result for $endpointId: ${status.name}');

    if (status == Status.CONNECTED) {
      _connectedEndpoints.add(endpointId);
      if (_nearbyVehicles.containsKey(endpointId)) {
        _nearbyVehicles[endpointId]!.isConnected = true;
      }
    } else {
      _connectedEndpoints.remove(endpointId);
      if (_nearbyVehicles.containsKey(endpointId)) {
        _nearbyVehicles[endpointId]!.isConnected = false;
      }
    }

    _connectionStateController.add({
      for (var id in _nearbyVehicles.keys)
        id: _connectedEndpoints.contains(id)
    });
    _nearbyVehiclesController.add(_nearbyVehicles.values.toList());
  }

  void _onDisconnected(String endpointId) {
    print('Disconnected from: $endpointId');
    _connectedEndpoints.remove(endpointId);
    if (_nearbyVehicles.containsKey(endpointId)) {
      _nearbyVehicles[endpointId]!.isConnected = false;
    }
    _nearbyVehiclesController.add(_nearbyVehicles.values.toList());
  }

  Future<void> _requestConnection(String endpointId) async {
    try {
      await _nearby.requestConnection(
        _myDeviceName,
        endpointId,
        onConnectionInitiated: _onConnectionInitiated,
        onConnectionResult: _onConnectionResult,
        onDisconnected: _onDisconnected,
      );
    } catch (e) {
      print('Error requesting connection: $e');
    }
  }

  // ===== Payload Handling (with Rust verification) =====

  void _onPayloadReceived(String endpointId, Payload payload) async {
    if (payload.type == PayloadType.BYTES && payload.bytes != null) {
      try {
        final jsonString = utf8.decode(payload.bytes!);

        // Parse and verify with Rust
        final message = await V2VMessage.fromSignedJson(jsonString);
        if (message == null) {
          print('Failed to parse signed message');
          return;
        }

        // Store in history
        _messageHistory.putIfAbsent(endpointId, () => []);
        _messageHistory[endpointId]!.add(message);

        // Emit to stream
        _messagesController.add(message);

        // Track reward for the sender (if verified)
        if (message.isVerified) {
          final reward = await rust.trackReward(
            messageJson: jsonString,
            receiverCount: _connectedEndpoints.length,
          );
          _rewardController.add(reward);
        }

        // Update last seen
        if (_nearbyVehicles.containsKey(endpointId)) {
          _nearbyVehicles[endpointId]!.updateLastSeen();
          if (message.senderPosition != null) {
            _nearbyVehicles[endpointId]!.lastKnownPosition = message.senderPosition;
          }
        }
      } catch (e) {
        print('Error parsing payload: $e');
      }
    }
  }

  void _onPayloadTransferUpdate(String endpointId, PayloadTransferUpdate update) {
    // Can be used to show transfer progress for large files
  }

  // ===== Sending Messages (with Rust signing) =====

  /// Send a text message to a specific endpoint (signed by Rust)
  Future<bool> sendTextMessage(String endpointId, String text) async {
    if (!_isRustInitialized || !_connectedEndpoints.contains(endpointId)) {
      return false;
    }

    try {
      final signedJson = await rust.signTextMessage(
        text: text,
        lat: _currentPosition?.latitude,
        lon: _currentPosition?.longitude,
      );
      return _sendSignedMessage(endpointId, signedJson);
    } catch (e) {
      print('Error signing text message: $e');
      return false;
    }
  }

  /// Send a quick preset message (signed by Rust)
  Future<bool> sendQuickMessage(String endpointId, QuickMessage quick) async {
    if (!_isRustInitialized || !_connectedEndpoints.contains(endpointId)) {
      return false;
    }

    try {
      final signedJson = await rust.signQuickMessage(
        quickType: quick.index,
        lat: _currentPosition?.latitude,
        lon: _currentPosition?.longitude,
      );
      return _sendSignedMessage(endpointId, signedJson);
    } catch (e) {
      print('Error signing quick message: $e');
      return false;
    }
  }

  /// Send a voice message (signed by Rust)
  Future<bool> sendVoiceMessage(String endpointId, Uint8List audioBytes) async {
    if (!_isRustInitialized || !_connectedEndpoints.contains(endpointId)) {
      return false;
    }

    try {
      final audioBase64 = base64Encode(audioBytes);
      final signedJson = await rust.signVoiceMessage(
        audioBase64: audioBase64,
        lat: _currentPosition?.latitude,
        lon: _currentPosition?.longitude,
      );
      return _sendSignedMessage(endpointId, signedJson);
    } catch (e) {
      print('Error signing voice message: $e');
      return false;
    }
  }

  /// Send an emergency alert to ALL connected vehicles (signed by Rust)
  Future<void> broadcastEmergency(String description) async {
    if (!_isRustInitialized) return;

    try {
      final signedJson = await rust.signEmergencyMessage(
        description: description,
        lat: _currentPosition?.latitude,
        lon: _currentPosition?.longitude,
      );

      for (final endpointId in _connectedEndpoints) {
        await _sendSignedMessage(endpointId, signedJson);
      }
    } catch (e) {
      print('Error broadcasting emergency: $e');
    }
  }

  /// Send location to a specific endpoint (signed by Rust)
  Future<bool> sendLocation(String endpointId) async {
    if (!_isRustInitialized ||
        !_connectedEndpoints.contains(endpointId) ||
        _currentPosition == null) {
      return false;
    }

    try {
      final signedJson = await rust.signLocationMessage(
        lat: _currentPosition!.latitude,
        lon: _currentPosition!.longitude,
        speed: _currentPosition!.speed,
        heading: _currentPosition!.heading,
      );
      return _sendSignedMessage(endpointId, signedJson);
    } catch (e) {
      print('Error signing location: $e');
      return false;
    }
  }

  /// Broadcast a message to all connected vehicles
  Future<void> broadcastMessage(V2VMessageType type, dynamic payload) async {
    if (_currentTripState != TripState.Driving || _isPhoneMoving) {
      return;
    }
    for (final endpointId in _connectedEndpoints) {
      switch (type) {
        case V2VMessageType.text:
          await sendTextMessage(endpointId, payload as String);
        case V2VMessageType.quickMessage:
          await sendQuickMessage(endpointId, payload as QuickMessage);
        case V2VMessageType.voice:
          await sendVoiceMessage(endpointId, payload as Uint8List);
        case V2VMessageType.emergency:
          await broadcastEmergency(payload as String);
        case V2VMessageType.location:
          await sendLocation(endpointId);
        case V2VMessageType.telemetry:
          // TODO: Implement telemetry broadcast
          break;
      }
    }
  }

  /// Internal: Send pre-signed JSON message
  Future<bool> _sendSignedMessage(String endpointId, String signedJson) async {
    if (!_connectedEndpoints.contains(endpointId)) {
      print('Cannot send message: not connected to $endpointId');
      return false;
    }

    try {
      final bytes = Uint8List.fromList(utf8.encode(signedJson));
      await _nearby.sendBytesPayload(endpointId, bytes);

      // Parse for history storage
      final message = await V2VMessage.fromSignedJson(signedJson, isOutgoing: true);
      if (message != null) {
        _messageHistory.putIfAbsent(endpointId, () => []);
        _messageHistory[endpointId]!.add(message);
      }

      return true;
    } catch (e) {
      print('Error sending signed message: $e');
      return false;
    }
  }

  /// Get message history for an endpoint
  List<V2VMessage> getMessageHistory(String endpointId) {
    return _messageHistory[endpointId] ?? [];
  }

  // ===== Reward Management =====

  /// Get pending rewards for current user
  Future<BigInt> getMyPendingRewards() async {
    return rust.getMyPendingReward();
  }

  /// Get formatted reward amount
  Future<String> getFormattedRewards() async {
    final pending = await getMyPendingRewards();
    return rust.formatGaraAmount(microGara: pending);
  }

  /// Get reward statistics (message_count, total_earned)
  Future<(BigInt, BigInt)> getRewardStats() async {
    return rust.getRewardStats();
  }

  /// Flush pending rewards for blockchain submission
  Future<String> flushRewardsForSubmission() async {
    return rust.flushPendingRewards();
  }

  /// Dispose resources
  void dispose() {
    stopV2V();
    _tripStateSubscription?.cancel();
    _gyroscopeSubscription?.cancel();
    _nearbyVehiclesController.close();
    _messagesController.close();
    _connectionStateController.close();
    _rewardController.close();
  }
}
