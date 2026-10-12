import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:nearby_connections/nearby_connections.dart';
import 'package:permission_handler/permission_handler.dart';

class NearbyService with ChangeNotifier {
  final Strategy strategy = Strategy.P2P_CLUSTER;
  String? userName;
  final String _serviceId = "com.gara.pilot";

  // State
  bool isAdvertising = false;
  bool isDiscovering = false;
  Map<String, String> connectedEndpoints = {}; // endpointId -> endpointName

  Future<void> init(String user) async {
    userName = user;
    await _requestPermissions();
  }

  Future<void> _requestPermissions() async {
    await [
      Permission.location,
      Permission.bluetooth,
      Permission.bluetoothAdvertise,
      Permission.bluetoothConnect,
      Permission.bluetoothScan,
      Permission.nearbyWifiDevices,
    ].request();
  }

  Future<void> startAdvertising() async {
    try {
      bool a = await Nearby().startAdvertising(
        userName ?? "Unknown Gara Node",
        strategy,
        onConnectionInitiated: _onConnectionInitiated,
        onConnectionResult: _onConnectionResult,
        onDisconnected: _onDisconnected,
        serviceId: _serviceId,
      );
      isAdvertising = a;
      notifyListeners();
      debugPrint("Advertising started: $a");
    } catch (e) {
      debugPrint("Advertise Error: $e");
    }
  }

  Future<void> startDiscovery() async {
    try {
      bool a = await Nearby().startDiscovery(
        userName ?? "Unknown Gara Node",
        strategy,
        onEndpointFound: _onEndpointFound,
        onEndpointLost: _onEndpointLost,
        serviceId: _serviceId,
      );
      isDiscovering = a;
      notifyListeners();
      debugPrint("Discovery started: $a");
    } catch (e) {
      debugPrint("Discovery Error: $e");
    }
  }

  // Callbacks
  void _onConnectionInitiated(String id, ConnectionInfo info) {
    debugPrint("Connection Initiated: $id, Info: ${info.endpointName}");
    // Auto-accept for mesh demo
    Nearby().acceptConnection(id, onPayLoadRecieved: (id, payload) {
        if (payload.type == PayloadType.BYTES) {
           String str = utf8.decode(payload.bytes!);
           debugPrint("Received from $id: $str");
           // TODO: Send to Rust layer via FRB
        }
    });
  }

  void _onConnectionResult(String id, Status status) {
    debugPrint("Connection Result: $id, Status: $status");
    if (status == Status.CONNECTED) {
      connectedEndpoints[id] = "Connected";
      notifyListeners();
    } else {
      connectedEndpoints.remove(id);
      notifyListeners();
    }
  }

  void _onDisconnected(String id) {
    debugPrint("Disconnected: $id");
    connectedEndpoints.remove(id);
    notifyListeners();
  }

  void _onEndpointFound(String id, String name, String serviceId) {
     debugPrint("Endpoint Found: $id, Name: $name");
     // Auto-connect
     Nearby().requestConnection(
        userName ?? "Unknown",
        id,
        onConnectionInitiated: _onConnectionInitiated,
        onConnectionResult: _onConnectionResult,
        onDisconnected: _onDisconnected,
     );
  }

  void _onEndpointLost(String? id) {
     debugPrint("Endpoint Lost: $id");
  }

  Future<void> stopAll() async {
    await Nearby().stopAdvertising();
    await Nearby().stopDiscovery();
    isAdvertising = false;
    isDiscovering = false;
    notifyListeners();
  }
}
