// ignore_for_file: file_names, unnecessary_import

import 'dart:async';
import 'dart:math';
import 'dart:typed_data';
import 'dart:ui';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_background_service/flutter_background_service.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:nearby_connections/nearby_connections.dart';
import 'package:permission_handler/permission_handler.dart';

import 'package:gara_g_pilot/src/rust/api.dart';
import 'safetyPacket.dart';

/// Duty Cycling states for low-power mobile mesh operation
enum DutyCycleState {
  inactive,
  scanning,
  advertising,
  sleeping,
}

/// V2VMeshService: Edge-mesh Dart bridge with Ed25519 SafetyPacket relaying,
/// low-power duty cycling state machine, and foreground service background execution.
class V2VMeshService {
  static final V2VMeshService _instance = V2VMeshService._internal();
  factory V2VMeshService() => _instance;
  V2VMeshService._internal();

  final Nearby _nearby = Nearby();
  final Strategy _strategy = Strategy.P2P_CLUSTER;
  final String _nodeName = "SWAL-Node-${Random().nextInt(9000) + 1000}";
  static const String _serviceId = "com.swal.gara.edge_mesh";

  FlutterBackgroundService? _foregroundService;
  FlutterBackgroundService get foregroundService =>
      _foregroundService ??= FlutterBackgroundService();

  final List<String> _connectedEndpoints = [];
  List<String> get connectedEndpoints => List.unmodifiable(_connectedEndpoints);

  DutyCycleState _dutyCycleState = DutyCycleState.inactive;
  DutyCycleState get dutyCycleState => _dutyCycleState;

  Timer? _dutyCycleTimer;
  Duration _scanDuration = const Duration(seconds: 5);
  Duration _advertiseDuration = const Duration(seconds: 5);
  Duration _sleepDuration = const Duration(seconds: 10);

  final _packetController = StreamController<SafetyPacket>.broadcast();
  Stream<SafetyPacket> get packetStream => _packetController.stream;

  final Set<int> _processedPacketHashes = {};
  static const int _maxHashCacheSize = 200;

  final bool _isInitialized = false;
  bool get isInitialized => _isInitialized;

  /// Initialize background service configuration for Android/iOS
  Future<void> initializeForegroundService() async {
    const AndroidNotificationChannel channel = AndroidNotificationChannel(
      'gara_v2v_mesh_channel',
      'SWAL Edge-Mesh V2V Service',
      description: 'Running active V2V duty cycling & SafetyPacket relay',
      importance: Importance.low,
    );

    final FlutterLocalNotificationsPlugin localNotifications =
        FlutterLocalNotificationsPlugin();

    await localNotifications
        .resolvePlatformSpecificImplementation<
            AndroidFlutterLocalNotificationsPlugin>()
        ?.createNotificationChannel(channel);

    await foregroundService.configure(
      androidConfiguration: AndroidConfiguration(
        onStart: _onServiceStart,
        autoStart: false,
        isForegroundMode: true,
        notificationChannelId: 'gara_v2v_mesh_channel',
        initialNotificationTitle: 'SWAL Edge-Mesh Active',
        initialNotificationContent: 'Monitoring V2V SafetyPackets...',
        foregroundServiceNotificationId: 999,
      ),
      iosConfiguration: IosConfiguration(
        autoStart: false,
        onForeground: _onServiceStart,
        onBackground: _onIosBackground,
      ),
    );
  }

  /// Request required Bluetooth, Location, and Nearby Wifi permissions
  Future<bool> requestMeshPermissions() async {
    final permissions = [
      Permission.bluetooth,
      Permission.bluetoothAdvertise,
      Permission.bluetoothConnect,
      Permission.bluetoothScan,
      Permission.location,
      Permission.nearbyWifiDevices,
    ];

    bool allGranted = true;
    for (final p in permissions) {
      if (!await p.isGranted) {
        final status = await p.request();
        if (!status.isGranted) {
          allGranted = false;
        }
      }
    }
    return allGranted;
  }

  /// Start active duty cycling loop
  Future<void> startDutyCycling({
    Duration? scanDuration,
    Duration? advertiseDuration,
    Duration? sleepDuration,
  }) async {
    if (scanDuration != null) _scanDuration = scanDuration;
    if (advertiseDuration != null) _advertiseDuration = advertiseDuration;
    if (sleepDuration != null) _sleepDuration = sleepDuration;

    await requestMeshPermissions();

    if (await foregroundService.isRunning() == false) {
      await foregroundService.startService();
    }

    _dutyCycleTimer?.cancel();
    _dutyCycleState = DutyCycleState.scanning;
    _runDutyCycleStep();
  }

  /// Stop duty cycling and background service
  Future<void> stopDutyCycling() async {
    _dutyCycleTimer?.cancel();
    _dutyCycleTimer = null;
    _dutyCycleState = DutyCycleState.inactive;

    try {
      await _nearby.stopDiscovery();
      await _nearby.stopAdvertising();
      await _nearby.stopAllEndpoints();
    } catch (e) {
      if (kDebugMode) print('V2VMeshService stop error: $e');
    }

    _connectedEndpoints.clear();

    if (await foregroundService.isRunning()) {
      foregroundService.invoke('stopService');
    }
  }

  void _runDutyCycleStep() async {
    if (_dutyCycleState == DutyCycleState.inactive) return;

    switch (_dutyCycleState) {
      case DutyCycleState.scanning:
        await _startDiscoveryPhase();
        _dutyCycleTimer = Timer(_scanDuration, () {
          _dutyCycleState = DutyCycleState.advertising;
          _runDutyCycleStep();
        });
        break;

      case DutyCycleState.advertising:
        await _startAdvertisingPhase();
        _dutyCycleTimer = Timer(_advertiseDuration, () {
          _dutyCycleState = DutyCycleState.sleeping;
          _runDutyCycleStep();
        });
        break;

      case DutyCycleState.sleeping:
        await _enterLowPowerSleepPhase();
        _dutyCycleTimer = Timer(_sleepDuration, () {
          _dutyCycleState = DutyCycleState.scanning;
          _runDutyCycleStep();
        });
        break;

      case DutyCycleState.inactive:
        break;
    }
  }

  Future<void> _startDiscoveryPhase() async {
    try {
      await _nearby.stopAdvertising();
      await _nearby.startDiscovery(
        _nodeName,
        _strategy,
        serviceId: _serviceId,
        onEndpointFound: _onEndpointFound,
        onEndpointLost: _onEndpointLost,
      );
    } catch (e) {
      if (kDebugMode) print('V2VMeshService discovery error: $e');
    }
  }

  Future<void> _startAdvertisingPhase() async {
    try {
      await _nearby.stopDiscovery();
      await _nearby.startAdvertising(
        _nodeName,
        _strategy,
        serviceId: _serviceId,
        onConnectionInitiated: _onConnectionInitiated,
        onConnectionResult: _onConnectionResult,
        onDisconnected: _onDisconnected,
      );
    } catch (e) {
      if (kDebugMode) print('V2VMeshService advertising error: $e');
    }
  }

  Future<void> _enterLowPowerSleepPhase() async {
    try {
      await _nearby.stopDiscovery();
      await _nearby.stopAdvertising();
    } catch (e) {
      if (kDebugMode) print('V2VMeshService sleep error: $e');
    }
  }

  void _onEndpointFound(String endpointId, String name, String serviceId) {
    if (kDebugMode) print('Endpoint found: $name ($endpointId)');
    _nearby.requestConnection(
      _nodeName,
      endpointId,
      onConnectionInitiated: _onConnectionInitiated,
      onConnectionResult: _onConnectionResult,
      onDisconnected: _onDisconnected,
    );
  }

  void _onEndpointLost(String? endpointId) {
    if (endpointId != null) {
      _connectedEndpoints.remove(endpointId);
      if (kDebugMode) print('Endpoint lost: $endpointId');
    }
  }

  void _onConnectionInitiated(String endpointId, ConnectionInfo info) {
    _nearby.acceptConnection(
      endpointId,
      onPayLoadRecieved: (endpointId, payload) {
        if (payload.type == PayloadType.BYTES && payload.bytes != null) {
          handleIncomingPayload(payload.bytes!, endpointId);
        }
      },
    );
  }

  void _onConnectionResult(String endpointId, Status status) {
    if (status == Status.CONNECTED) {
      if (!_connectedEndpoints.contains(endpointId)) {
        _connectedEndpoints.add(endpointId);
      }
      if (kDebugMode) print('Connected to peer: $endpointId');
    } else {
      _connectedEndpoints.remove(endpointId);
    }
  }

  void _onDisconnected(String endpointId) {
    _connectedEndpoints.remove(endpointId);
    if (kDebugMode) print('Disconnected from peer: $endpointId');
  }

  /// Process received raw bytes, parse SafetyPacket, verify Ed25519 signature & bitmask
  void handleIncomingPayload(Uint8List payloadBytes, String senderId) {
    if (payloadBytes.isEmpty) return;

    final packet = SafetyPacket.fromPayload(payloadBytes);
    if (packet == null) return;

    // Deduplicate packets by timestamp ^ tempId ^ events
    final packetHash =
        packet.timestamp.millisecondsSinceEpoch ^ packet.tempId ^ packet.events;
    if (_processedPacketHashes.contains(packetHash)) return;

    _processedPacketHashes.add(packetHash);
    if (_processedPacketHashes.length > _maxHashCacheSize) {
      _processedPacketHashes.remove(_processedPacketHashes.first);
    }

    _packetController.add(packet);

    // Bridge payload to Rust native layer for storage and relay
    try {
      parseBlePacketRaw(data: payloadBytes)
          .then((rustPkt) => saveTelemetryPacket(packet: rustPkt))
          .catchError((e) {
            if (kDebugMode) print('Native packet save error: $e');
          });
    } catch (e) {
      if (kDebugMode) print('Native bridge error: $e');
    }

    // Relay high priority packets if hops permit
    if (packet.isHighPriority && packet.canForward) {
      final forwarded = packet.forwarded();
      broadcastSafetyPacket(forwarded);
    }
  }

  /// Broadcast a SafetyPacket to all connected mesh peers
  Future<void> broadcastSafetyPacket(SafetyPacket packet) async {
    final payload = packet.toPayload();
    for (final peerId in _connectedEndpoints) {
      try {
        await _nearby.sendBytesPayload(peerId, payload);
      } catch (e) {
        if (kDebugMode) print('Error sending to $peerId: $e');
      }
    }
  }

  void dispose() {
    _dutyCycleTimer?.cancel();
    _packetController.close();
  }
}

@pragma('vm:entry-point')
Future<bool> _onIosBackground(ServiceInstance service) async {
  WidgetsFlutterBinding.ensureInitialized();
  return true;
}

@pragma('vm:entry-point')
void _onServiceStart(ServiceInstance service) async {
  DartPluginRegistrant.ensureInitialized();

  if (service is AndroidServiceInstance) {
    service.on('setAsForeground').listen((event) {
      service.setAsForegroundService();
    });

    service.on('setAsBackground').listen((event) {
      service.setAsBackgroundService();
    });
  }

  service.on('stopService').listen((event) {
    service.stopSelf();
  });

  Timer.periodic(const Duration(seconds: 15), (timer) async {
    if (service is AndroidServiceInstance) {
      if (await service.isForegroundService()) {
        service.invoke('update', {
          'timestamp': DateTime.now().toIso8601String(),
          'status': 'SWAL Edge-Mesh Duty Cycling Active',
        });
      }
    }
  });
}
