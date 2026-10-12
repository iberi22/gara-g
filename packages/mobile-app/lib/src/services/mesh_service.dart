import 'dart:async';
import 'dart:math';
import 'dart:typed_data';
import 'package:flutter/foundation.dart';
import 'package:nearby_connections/nearby_connections.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:gara_g_pilot/src/rust/api.dart';
import 'package:gara_g_pilot/src/services/voice_safety_agent.dart';

/// Emergency V2V message types
enum V2VEmergencyType {
  emergencyBraking,   // Hard braking detected
  hazardAhead,        // Road hazard warning
  accidentReport,     // Collision/accident
  trafficSlowdown,    // Traffic backing up
  emergencyVehicle,   // Ambulance/Fire/Police nearby
  weatherAlert,       // Severe weather condition
}

/// V2V Emergency broadcast message
class V2VEmergencyMessage {
  final V2VEmergencyType type;
  final String senderId;
  final double? latitude;
  final double? longitude;
  final int? distanceMeters;
  final String? details;
  final DateTime timestamp;
  final int hopCount;

  V2VEmergencyMessage({
    required this.type,
    required this.senderId,
    this.latitude,
    this.longitude,
    this.distanceMeters,
    this.details,
    DateTime? timestamp,
    this.hopCount = 0,
  }) : timestamp = timestamp ?? DateTime.now();

  /// Convert to binary payload for mesh transmission
  Uint8List toPayload() {
    final buffer = BytesBuilder();
    buffer.addByte(type.index);
    buffer.addByte(hopCount);
    
    final timestampMs = timestamp.millisecondsSinceEpoch;
    buffer.add(_int64ToBytes(timestampMs));
    buffer.add(_int32ToBytes(((latitude ?? 0) * 1e7).toInt()));
    buffer.add(_int32ToBytes(((longitude ?? 0) * 1e7).toInt()));
    buffer.add(_int32ToBytes(distanceMeters ?? 0));
    
    final detailsBytes = (details ?? '').codeUnits;
    buffer.add(_int16ToBytes(detailsBytes.length));
    buffer.add(detailsBytes);
    
    return buffer.toBytes();
  }

  static V2VEmergencyMessage? fromPayload(Uint8List data) {
    if (data.length < 24) return null;
    try {
      int offset = 0;
      final typeIndex = data[offset++];
      if (typeIndex >= V2VEmergencyType.values.length) return null;
      final type = V2VEmergencyType.values[typeIndex];
      final hopCount = data[offset++];
      final timestampMs = _bytesToInt64(data.sublist(offset, offset + 8));
      offset += 8;
      final latInt = _bytesToInt32(data.sublist(offset, offset + 4));
      offset += 4;
      final lonInt = _bytesToInt32(data.sublist(offset, offset + 4));
      offset += 4;
      final distance = _bytesToInt32(data.sublist(offset, offset + 4));
      offset += 4;
      final detailsLen = _bytesToInt16(data.sublist(offset, offset + 2));
      offset += 2;
      String? details;
      if (detailsLen > 0 && offset + detailsLen <= data.length) {
        details = String.fromCharCodes(data.sublist(offset, offset + detailsLen));
      }
      return V2VEmergencyMessage(
        type: type,
        senderId: '',
        latitude: latInt / 1e7,
        longitude: lonInt / 1e7,
        distanceMeters: distance > 0 ? distance : null,
        details: details,
        timestamp: DateTime.fromMillisecondsSinceEpoch(timestampMs),
        hopCount: hopCount,
      );
    } catch (e) {
      if (kDebugMode) print('V2V parse error: $e');
      return null;
    }
  }

  static Uint8List _int64ToBytes(int value) =>
    Uint8List(8)..buffer.asByteData().setInt64(0, value, Endian.little);
  static Uint8List _int32ToBytes(int value) =>
    Uint8List(4)..buffer.asByteData().setInt32(0, value, Endian.little);
  static Uint8List _int16ToBytes(int value) =>
    Uint8List(2)..buffer.asByteData().setInt16(0, value, Endian.little);
  static int _bytesToInt64(Uint8List bytes) =>
    bytes.buffer.asByteData().getInt64(0, Endian.little);
  static int _bytesToInt32(Uint8List bytes) =>
    bytes.buffer.asByteData().getInt32(0, Endian.little);
  static int _bytesToInt16(Uint8List bytes) =>
    bytes.buffer.asByteData().getInt16(0, Endian.little);
}

class MeshService {
  final Strategy _strategy = Strategy.P2P_CLUSTER;
  final Nearby _nearby = Nearby();
  final String _userName = Random().nextInt(10000).toString();
  final List<String> _connectedDevices = [];
  
  VoiceSafetyAgent? _voiceAgent;
  final _emergencyStreamController = StreamController<V2VEmergencyMessage>.broadcast();
  Stream<V2VEmergencyMessage> get emergencyStream => _emergencyStreamController.stream;
  final Set<int> _recentMessageHashes = {};
  static const int _maxRecentMessages = 100;

  MeshService() {
    // Permissions are handled via permission_handler in _requestPermissions()
  }

  void setVoiceAgent(VoiceSafetyAgent agent) {
    _voiceAgent = agent;
  }

  int get connectedDeviceCount => _connectedDevices.length;

  Future<void> _requestPermissions() async {
    if (!await Permission.bluetooth.isGranted) {
      await Permission.bluetooth.request();
    }
    if (!await Permission.bluetoothAdvertise.isGranted) {
      await Permission.bluetoothAdvertise.request();
    }
    if (!await Permission.bluetoothConnect.isGranted) {
      await Permission.bluetoothConnect.request();
    }
    if (!await Permission.location.isGranted) {
      await Permission.location.request();
    }
    if (!await Permission.nearbyWifiDevices.isGranted) {
      await Permission.nearbyWifiDevices.request();
    }
  }

  void _onConnectionInitiated(String endpointId, ConnectionInfo info) {
    if (kDebugMode) {
      print('Connection initiated with: ${info.endpointName}');
    }
    _nearby.acceptConnection(
      endpointId,
      onPayLoadRecieved: (endpointId, payload) {
        if (payload.type == PayloadType.BYTES && payload.bytes != null) {
          _handlePayload(payload.bytes!, endpointId);
        }
      },
    );
  }

  void _onConnectionResult(String endpointId, Status status) {
    if (status == Status.CONNECTED) {
      if (kDebugMode) {
        print('Connected to $endpointId');
      }
      _connectedDevices.add(endpointId);
    } else {
      if (kDebugMode) {
        print('Connection to $endpointId failed');
      }
      _connectedDevices.remove(endpointId);
    }
  }

  void _onDisconnected(String endpointId) {
    if (kDebugMode) {
      print('Disconnected from $endpointId');
    }
    _connectedDevices.remove(endpointId);
  }

  Future<void> startAdvertising() async {
    await _requestPermissions();
    try {
      await _nearby.startAdvertising(
        _userName,
        _strategy,
        onConnectionInitiated: _onConnectionInitiated,
        onConnectionResult: _onConnectionResult,
        onDisconnected: _onDisconnected,
        serviceId: "com.example.gara_g_pilot",
      );
      if (kDebugMode) {
        print('Advertising...');
      }
    } catch (e) {
      if (kDebugMode) {
        print('Error starting advertising: $e');
      }
    }
  }

  Future<void> startDiscovery() async {
    await _requestPermissions();
    try {
      await _nearby.startDiscovery(
        _userName,
        _strategy,
        onEndpointFound: (endpointId, endpointName, serviceId) {
          if (kDebugMode) {
            print('Discovered endpoint: $endpointName');
          }
          _nearby.requestConnection(
            _userName,
            endpointId,
            onConnectionInitiated: _onConnectionInitiated,
            onConnectionResult: _onConnectionResult,
            onDisconnected: _onDisconnected,
          );
        },
        onEndpointLost: (endpointId) {
          if (kDebugMode) {
            print('Lost endpoint: $endpointId');
          }
        },
        serviceId: "com.example.gara_g_pilot",
      );
      if (kDebugMode) {
        print('Discovering...');
      }
    } catch (e) {
      if (kDebugMode) {
        print('Error starting discovery: $e');
      }
    }
  }

  Future<void> sendPayload(Uint8List payload) async {
    for (final deviceId in _connectedDevices) {
      await _nearby.sendBytesPayload(deviceId, payload);
    }
  }

  void _handlePayload(Uint8List payload, String senderId) {
    if (payload.isEmpty) return;
    
    // Check for emergency message (first byte indicates type)
    if (payload[0] < V2VEmergencyType.values.length) {
      final emergency = V2VEmergencyMessage.fromPayload(payload);
      if (emergency != null) {
        _handleEmergencyMessage(emergency, senderId);
        return;
      }
    }
    
    // Otherwise treat as telemetry packet
    try {
      if (kDebugMode) print('Payload received from $senderId');
      parseBlePacketRaw(data: payload)
          .then((packet) => saveTelemetryPacket(packet: packet))
          .then((_) {
            if (kDebugMode) print("Mesh: Packet saved to vault");
          })
          .catchError((e) {
            if (kDebugMode) print("Mesh: Error saving packet: $e");
          });
    } catch (e) {
      if (kDebugMode) print("Mesh: Error parsing payload: $e");
    }
  }

  void _handleEmergencyMessage(V2VEmergencyMessage message, String senderId) {
    final hash = message.timestamp.millisecondsSinceEpoch ^ message.type.index;
    if (_recentMessageHashes.contains(hash)) return;
    
    _recentMessageHashes.add(hash);
    if (_recentMessageHashes.length > _maxRecentMessages) {
      _recentMessageHashes.remove(_recentMessageHashes.first);
    }
    
    if (kDebugMode) print('V2V Emergency: ${message.type.name} from $senderId');
    
    _emergencyStreamController.add(message);
    _announceEmergency(message);
    
    if (message.hopCount < 3) {
      _rebroadcast(message);
    }
  }

  void _announceEmergency(V2VEmergencyMessage message) {
    if (_voiceAgent == null) return;
    
    switch (message.type) {
      case V2VEmergencyType.emergencyBraking:
        _voiceAgent!.announceEmergencyBraking(
          vehicleInfo: message.distanceMeters != null 
            ? "Vehicle ${message.distanceMeters} meters ahead" 
            : null,
        );
        break;
      case V2VEmergencyType.hazardAhead:
        _voiceAgent!.announceHazard(
          message.details ?? "Road hazard",
          location: message.distanceMeters != null 
            ? "${message.distanceMeters} meters ahead" 
            : null,
        );
        break;
      case V2VEmergencyType.accidentReport:
        _voiceAgent!.announce(SafetyAlert(
          message: message.details ?? "Accident reported ahead. Slow down.",
          priority: AlertPriority.critical,
          source: "v2v",
        ));
        break;
      case V2VEmergencyType.trafficSlowdown:
        _voiceAgent!.announceTrafficSlowdown(distanceMeters: message.distanceMeters);
        break;
      case V2VEmergencyType.emergencyVehicle:
        _voiceAgent!.announce(SafetyAlert(
          message: "Emergency vehicle nearby. Yield the right of way.",
          priority: AlertPriority.high,
          source: "v2v",
        ));
        break;
      case V2VEmergencyType.weatherAlert:
        _voiceAgent!.announce(SafetyAlert(
          message: message.details ?? "Severe weather alert. Drive carefully.",
          priority: AlertPriority.medium,
          source: "v2v",
        ));
        break;
    }
  }

  void _rebroadcast(V2VEmergencyMessage original) {
    final rebroadcast = V2VEmergencyMessage(
      type: original.type,
      senderId: _userName,
      latitude: original.latitude,
      longitude: original.longitude,
      distanceMeters: original.distanceMeters,
      details: original.details,
      timestamp: original.timestamp,
      hopCount: original.hopCount + 1,
    );
    sendPayload(rebroadcast.toPayload());
  }

  Future<void> broadcastEmergency(V2VEmergencyType type, {
    double? latitude,
    double? longitude,
    int? distanceMeters,
    String? details,
  }) async {
    final message = V2VEmergencyMessage(
      type: type,
      senderId: _userName,
      latitude: latitude,
      longitude: longitude,
      distanceMeters: distanceMeters,
      details: details,
    );
    await sendPayload(message.toPayload());
    if (kDebugMode) {
      print('V2V: Broadcast ${type.name} to ${_connectedDevices.length} peers');
    }
  }

  void dispose() {
    _emergencyStreamController.close();
  }
}
