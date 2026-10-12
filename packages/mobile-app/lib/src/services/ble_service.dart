import 'dart:async';
import 'dart:typed_data';
import 'package:flutter_blue_plus/flutter_blue_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';
import 'package:gara_g_pilot/src/services/mesh_service.dart';
import 'package:gara_g_pilot/src/services/v2v_service.dart';
// Note: Imports for Rust API will be available after codegen runs.
// Assuming standard FRB structure:
import 'package:gara_g_pilot/src/rust/api.dart';
import 'package:gara_g_pilot/src/rust/protocol.dart';

class BleService {
  static final BleService _instance = BleService._internal();

  factory BleService() {
    return _instance;
  }

  BleService._internal();

  final MeshService _meshService = MeshService();
  final V2VService _v2vService = V2VService();

  BluetoothDevice? connectedDevice;
  BluetoothCharacteristic? targetCharacteristic;
  StreamSubscription? _scanSubscription;
  StreamSubscription? _dataSubscription;

  // Stream for parsed BLE packets
  final _blePacketController = StreamController<SafetyPacket>.broadcast();
  Stream<SafetyPacket> get blePacketStream => _blePacketController.stream;

  // UUIDs from Firmware (lowercase for FBP compatibility)
  final String targetDeviceName = "Gara Sentinel";
  final String serviceUuidStr = "00000001-0000-1000-8000-00805F9B34FB".toLowerCase();
  final String charUuidStr = "00000002-0000-1000-8000-00805F9B34FB".toLowerCase();

  Future<void> startScan() async {
    if (await FlutterBluePlus.isSupported == false) {
      debugPrint("BLE: Bluetooth not supported by this device");
      return;
    }

    // Check permissions if needed (handled by permission_handler usually)

    debugPrint("BLE: Starting scan for $targetDeviceName...");

    // Start scanning
    try {
      await FlutterBluePlus.startScan(
        timeout: const Duration(seconds: 15),
        withNames: [targetDeviceName], // Optimization if advertising name correctly
      );
    } catch (e) {
      debugPrint("BLE: Error starting scan: $e");
    }

    _scanSubscription = FlutterBluePlus.scanResults.listen((results) {
        for (ScanResult r in results) {
            if (r.device.platformName == targetDeviceName || r.advertisementData.localName == targetDeviceName) {
                debugPrint("BLE: Found Gara Sentinel: ${r.device.remoteId}");
                connectToDevice(r.device);
                FlutterBluePlus.stopScan();
                break;
            }
        }
    });
  }

  Future<void> connectToDevice(BluetoothDevice device) async {
    try {
      // FlutterBluePlus 2.3.5+ requires a license parameter.
      // Using License.nonprofit as this is a non-commercial research project.
      await device.connect(autoConnect: false, license: License.nonprofit);
      connectedDevice = device;
      debugPrint("BLE: Connected to ${device.platformName}");

      // Discover services
      List<BluetoothService> services = await device.discoverServices();
      for (var service in services) {
        if (service.uuid.toString() == serviceUuidStr) {
            debugPrint("BLE: Found Service ${service.uuid}");

            for (var characteristic in service.characteristics) {
                if (characteristic.uuid.toString() == charUuidStr) {
                    targetCharacteristic = characteristic;
                    debugPrint("BLE: Found Characteristic ${characteristic.uuid}");
                    await subscribeToCharacteristic(characteristic);
                }
            }
        }
      }
    } catch (e) {
      debugPrint("BLE: Error connecting: $e");
    }
  }

  Future<void> subscribeToCharacteristic(BluetoothCharacteristic char) async {
    await char.setNotifyValue(true);
    _dataSubscription = char.onValueReceived.listen((value) async {
        // value is List<int>
        if (value.isEmpty) return;

        try {
            final relayedPacket = await processAndRelayPacket(data: Uint8List.fromList(value));

            if (relayedPacket != null) {
              debugPrint("BLE: Relaying new packet");
              _meshService.sendPayload(relayedPacket);

              // Persist to vault with fused location
              try {
                // Parse the packet first
                var packet = await parseBlePacketRaw(data: relayedPacket);

                // Get current location and fuse with packet
                try {
                  final position = await Geolocator.getCurrentPosition(desiredAccuracy: LocationAccuracy.medium);
                  // Update packet with phone's GPS (in microdegrees)
                  packet = SafetyPacket(
                    magic: packet.magic,
                    version: packet.version,
                    msgType: packet.msgType,
                    networkId: packet.networkId,
                    hopCount: packet.hopCount,
                    maxHops: packet.maxHops,
                    tempId: packet.tempId,
                    timestamp: packet.timestamp,
                    lat: (position.latitude * 1000000).round(),
                    lon: (position.longitude * 1000000).round(),
                    speedCms: packet.speedCms,
                    heading: packet.heading,
                    events: packet.events,
                  );
                } catch (e) {
                  debugPrint("BLE: Could not get GPS location, using packet's coords: $e");
                }

                // Persist to local encrypted vault
                await saveTelemetryPacket(packet: packet);
                debugPrint("BLE: Packet saved to vault");

                // Dispatch to state/UI via stream
                _blePacketController.add(packet);
                debugPrint("BLE: Fused packet saved to vault and stream");

                // Check for crash event (bitmask 0x0001)
                if ((packet.events & 0x0001) != 0) {
                  debugPrint("BLE: ⚠️ CRASH EVENT detected! Triggering emergency broadcast.");
                  await _v2vService.broadcastEmergency("Crash detected by Sentinel");
                }

              } catch (e) {
                debugPrint("BLE: Error saving or processing fused packet: $e");
              }
            } else {
              debugPrint("BLE: Dropped duplicate packet");
            }

        } catch (e) {
            debugPrint("BLE: Error processing packet: $e");
        }
    });
  }

  void dispose() {
    _scanSubscription?.cancel();
    _dataSubscription?.cancel();
    _blePacketController.close();
    connectedDevice?.disconnect();
  }
}
