import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter_blue_plus/flutter_blue_plus.dart';

/// Data structure for OBD-II CAN MCP2515 telemetry metrics.
class ObdReading {
  final double speed; // km/h
  final double rpm; // RPM
  final double coolantTemp; // Celsius
  final double engineLoad; // Percentage 0-100%
  final double fuelLevel; // Percentage 0-100%
  final double throttlePosition; // Percentage 0-100%
  final int timestamp; // Milliseconds since epoch

  const ObdReading({
    required this.speed,
    required this.rpm,
    required this.coolantTemp,
    required this.engineLoad,
    required this.fuelLevel,
    required this.throttlePosition,
    required this.timestamp,
  });

  Map<String, dynamic> toMap() => {
        'speed': speed,
        'rpm': rpm,
        'coolantTemp': coolantTemp,
        'engineLoad': engineLoad,
        'fuelLevel': fuelLevel,
        'throttlePosition': throttlePosition,
        'timestamp': timestamp,
      };

  factory ObdReading.fromMap(Map<String, dynamic> map) => ObdReading(
        speed: (map['speed'] as num?)?.toDouble() ?? 0.0,
        rpm: (map['rpm'] as num?)?.toDouble() ?? 0.0,
        coolantTemp: (map['coolantTemp'] as num?)?.toDouble() ?? 0.0,
        engineLoad: (map['engineLoad'] as num?)?.toDouble() ?? 0.0,
        fuelLevel: (map['fuelLevel'] as num?)?.toDouble() ?? 0.0,
        throttlePosition: (map['throttlePosition'] as num?)?.toDouble() ?? 0.0,
        timestamp: (map['timestamp'] as num?)?.toInt() ?? DateTime.now().millisecondsSinceEpoch,
      );
}

/// OBD-II service over BLE GATT (MCP2515 CAN bus adapter integration).
class ObdService {
  static final ObdService _instance = ObdService._internal();

  factory ObdService() => _instance;

  ObdService._internal();

  BluetoothDevice? connectedDevice;
  BluetoothCharacteristic? obdCharacteristic;
  StreamSubscription? _scanSubscription;
  StreamSubscription? _notifySubscription;
  Timer? _simulationTimer;

  bool _isConnected = false;
  bool get isConnected => _isConnected;

  final _obdDataController = StreamController<ObdReading>.broadcast();
  Stream<ObdReading> get obdDataStream => _obdDataController.stream;

  ObdReading _latestReading = ObdReading(
    speed: 0.0,
    rpm: 0.0,
    coolantTemp: 90.0,
    engineLoad: 0.0,
    fuelLevel: 100.0,
    throttlePosition: 0.0,
    timestamp: DateTime.now().millisecondsSinceEpoch,
  );

  ObdReading get latestReading => _latestReading;

  // Target OBD GATT UUIDs (standard CAN / ELM327 BLE or MCP2515)
  final String targetDeviceName = "OBDII-CAN";
  final String obdServiceUuid = "0000fff0-0000-1000-8000-00805f9b34fb";
  final String obdCharUuid = "0000fff1-0000-1000-8000-00805f9b34fb";

  /// Start scanning for BLE OBD-II GATT devices
  Future<void> startScan() async {
    if (await FlutterBluePlus.isSupported == false) {
      debugPrint("OBD: Bluetooth non-supported on this platform");
      return;
    }

    try {
      await FlutterBluePlus.startScan(
        timeout: const Duration(seconds: 10),
      );
    } catch (e) {
      debugPrint("OBD: Error initiating BLE scan: $e");
    }

    _scanSubscription = FlutterBluePlus.scanResults.listen((results) {
      for (ScanResult r in results) {
        if (r.device.platformName.contains("OBD") ||
            r.advertisementData.advName.contains("OBD") ||
            r.device.platformName.contains("CAN")) {
          debugPrint("OBD: Found OBD BLE Device: ${r.device.remoteId}");
          connectToDevice(r.device);
          FlutterBluePlus.stopScan();
          break;
        }
      }
    });
  }

  /// Connect to a specific BLE device and initialize notifications
  Future<void> connectToDevice(BluetoothDevice device) async {
    try {
      await device.connect(autoConnect: false, license: License.nonprofit);
      connectedDevice = device;
      _isConnected = true;
      debugPrint("OBD: Connected to ${device.platformName}");

      List<BluetoothService> services = await device.discoverServices();
      for (var service in services) {
        for (var characteristic in service.characteristics) {
          if (characteristic.properties.notify || characteristic.properties.read) {
            obdCharacteristic = characteristic;
            await _subscribeToCharacteristic(characteristic);
            break;
          }
        }
      }
    } catch (e) {
      debugPrint("OBD: Error connecting to BLE OBD device: $e");
      _isConnected = false;
    }
  }

  /// Subscribe to GATT characteristic notification stream
  Future<void> _subscribeToCharacteristic(BluetoothCharacteristic char) async {
    if (char.properties.notify) {
      await char.setNotifyValue(true);
      _notifySubscription = char.onValueReceived.listen((value) {
        if (value.isNotEmpty) {
          _parseObdFrame(Uint8List.fromList(value));
        }
      });
    }
  }

  /// Parse raw OBD-II CAN frame bytes into `ObdReading`
  void _parseObdFrame(Uint8List rawBytes) {
    // Mode 01 PID parser logic for standard OBD-II PID responses
    // Byte 0: length / mode echo (41)
    // Byte 1: PID (0C = RPM, 0D = Speed, 05 = Coolant, 04 = Load, 2F = Fuel)
    if (rawBytes.length < 3) return;

    double currentSpeed = _latestReading.speed;
    double currentRpm = _latestReading.rpm;
    double currentCoolant = _latestReading.coolantTemp;
    double currentLoad = _latestReading.engineLoad;
    double currentFuel = _latestReading.fuelLevel;
    double currentThrottle = _latestReading.throttlePosition;

    if (rawBytes[0] == 0x41 || rawBytes[0] == 0x01) {
      int pid = rawBytes[1];
      switch (pid) {
        case 0x0C: // Engine RPM
          if (rawBytes.length >= 4) {
            currentRpm = ((rawBytes[2] * 256) + rawBytes[3]) / 4.0;
          }
          break;
        case 0x0D: // Vehicle Speed (km/h)
          currentSpeed = rawBytes[2].toDouble();
          break;
        case 0x05: // Engine Coolant Temperature (°C)
          currentCoolant = (rawBytes[2] - 40).toDouble();
          break;
        case 0x04: // Calculated Engine Load (%)
          currentLoad = (rawBytes[2] * 100 / 255);
          break;
        case 0x2F: // Fuel Tank Level Input (%)
          currentFuel = (rawBytes[2] * 100 / 255);
          break;
        case 0x11: // Throttle Position (%)
          currentThrottle = (rawBytes[2] * 100 / 255);
          break;
      }
    }

    final reading = ObdReading(
      speed: currentSpeed,
      rpm: currentRpm,
      coolantTemp: currentCoolant,
      engineLoad: currentLoad,
      fuelLevel: currentFuel,
      throttlePosition: currentThrottle,
      timestamp: DateTime.now().millisecondsSinceEpoch,
    );

    _latestReading = reading;
    _obdDataController.add(reading);
  }

  /// Start simulated OBD telemetry ingestion for background/testing environments
  void startSimulation() {
    _simulationTimer?.cancel();
    _isConnected = true;
    _simulationTimer = Timer.periodic(const Duration(milliseconds: 1000), (timer) {
      final now = DateTime.now().millisecondsSinceEpoch;
      final speed = 45.0 + ((now / 1000) % 30);
      final rpm = 1800.0 + ((now / 100) % 1200);
      final reading = ObdReading(
        speed: speed,
        rpm: rpm,
        coolantTemp: 88.0,
        engineLoad: 35.0,
        fuelLevel: 75.0,
        throttlePosition: 25.0,
        timestamp: now,
      );
      _latestReading = reading;
      _obdDataController.add(reading);
    });
  }

  /// Stop simulation and disconnect BLE
  Future<void> stop() async {
    _simulationTimer?.cancel();
    _scanSubscription?.cancel();
    _notifySubscription?.cancel();
    if (connectedDevice != null) {
      try {
        await connectedDevice!.disconnect();
      } catch (e) {
        debugPrint("OBD: Disconnect error: $e");
      }
    }
    _isConnected = false;
  }

  void dispose() {
    stop();
    _obdDataController.close();
  }
}
