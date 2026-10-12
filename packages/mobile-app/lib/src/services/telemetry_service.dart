import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';
import 'package:sensors_plus/sensors_plus.dart';
import 'package:mic_stream/mic_stream.dart';
import 'package:camera/camera.dart';
import 'package:uuid/uuid.dart';
import 'package:gara_g_pilot/src/services/obdService.dart';
import 'package:gara_g_pilot/src/services/encryptedVault.dart';

/// EconEvent definition for Dart protocol compatibility.
class EconEvent {
  final String eventId;
  final String eventType;
  final String account;
  final int amount;
  final int timestamp;
  final int chainId;
  final Map<String, String> metadata;

  EconEvent({
    required this.eventId,
    required this.eventType,
    required this.account,
    required this.amount,
    required this.timestamp,
    required this.chainId,
    required this.metadata,
  });

  Map<String, dynamic> toMap() => {
        'eventId': eventId,
        'eventType': eventType,
        'account': account,
        'amount': amount,
        'timestamp': timestamp,
        'chainId': chainId,
        'metadata': metadata,
      };
}

/// Unified Telemetry Payload aggregating Geolocator, sensors_plus, mic, camera, and OBD2 metrics.
class TelemetryRecordPayload {
  final String recordId;
  final int timestamp;
  final double latitude;
  final double longitude;
  final double speed;
  final double accelX;
  final double accelY;
  final double accelZ;
  final double gyroX;
  final double gyroY;
  final double gyroZ;
  final double micAudioRms;
  final bool isCameraActive;
  final double obdRpm;
  final double obdSpeed;
  final double obdCoolantTemp;

  TelemetryRecordPayload({
    required this.recordId,
    required this.timestamp,
    required this.latitude,
    required this.longitude,
    required this.speed,
    required this.accelX,
    required this.accelY,
    required this.accelZ,
    required this.gyroX,
    required this.gyroY,
    required this.gyroZ,
    required this.micAudioRms,
    required this.isCameraActive,
    required this.obdRpm,
    required this.obdSpeed,
    required this.obdCoolantTemp,
  });

  Map<String, dynamic> toMap() => {
        'recordId': recordId,
        'timestamp': timestamp,
        'latitude': latitude,
        'longitude': longitude,
        'speed': speed,
        'accelX': accelX,
        'accelY': accelY,
        'accelZ': accelZ,
        'gyroX': gyroX,
        'gyroY': gyroY,
        'gyroZ': gyroZ,
        'micAudioRms': micAudioRms,
        'isCameraActive': isCameraActive,
        'obdRpm': obdRpm,
        'obdSpeed': obdSpeed,
        'obdCoolantTemp': obdCoolantTemp,
      };
}

/// TelemetryService orchestrating geolocator, sensors_plus, mic_stream, camera, and OBD2 telemetry streams.
class TelemetryService {
  static final TelemetryService _instance = TelemetryService._internal();

  factory TelemetryService() => _instance;

  TelemetryService._internal();

  final ObdService _obdService = ObdService();
  final Uuid _uuid = const Uuid();

  EncryptedVault? _vault;
  StreamSubscription<Position>? _positionSubscription;
  StreamSubscription<AccelerometerEvent>? _accelSubscription;
  StreamSubscription<GyroscopeEvent>? _gyroSubscription;
  StreamSubscription<Uint8List>? _micSubscription;
  StreamSubscription<ObdReading>? _obdSubscription;
  CameraController? _cameraController;

  bool _isMonitoring = false;
  bool get isMonitoring => _isMonitoring;

  Position? _currentPosition;
  AccelerometerEvent? _latestAccel;
  GyroscopeEvent? _latestGyro;
  double _latestMicRms = 0.0;
  bool _isCameraActive = false;
  ObdReading? _latestObd;

  final _telemetryController = StreamController<TelemetryRecordPayload>.broadcast();
  Stream<TelemetryRecordPayload> get telemetryStream => _telemetryController.stream;

  final _econEventController = StreamController<EconEvent>.broadcast();
  Stream<EconEvent> get econEventStream => _econEventController.stream;

  final List<TelemetryRecordPayload> _yjsPipelineBuffer = [];
  List<TelemetryRecordPayload> get yjsPipelineBuffer => List.unmodifiable(_yjsPipelineBuffer);

  String? _activeTripId;
  String? get activeTripId => _activeTripId;

  /// Start background telemetry streams (Geolocator + sensors_plus + mic_stream + camera + OBD2)
  Future<void> startMonitoring({String? walletAddress}) async {
    if (_isMonitoring) return;

    _activeTripId = _uuid.v4();
    _isMonitoring = true;

    // Init vault with 32-byte keys for trip session storage
    try {
      _vault = await EncryptedVault.init(
        dbKey: Uint8List(32),
        clientKey: Uint8List(32),
      );
    } catch (e) {
      debugPrint("Telemetry: Vault init note: $e");
    }

    // 1. Geolocator stream
    bool serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (serviceEnabled) {
      LocationPermission permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
    }

    _positionSubscription = Geolocator.getPositionStream(
      locationSettings: const LocationSettings(
        accuracy: LocationAccuracy.high,
        distanceFilter: 5,
      ),
    ).listen((position) {
      _currentPosition = position;
      _processAndFlushRecord();
    });

    // 2. sensors_plus stream
    _accelSubscription = accelerometerEventStream().listen((event) {
      _latestAccel = event;
    });

    _gyroSubscription = gyroscopeEventStream().listen((event) {
      _latestGyro = event;
    });

    // 3. mic_stream (optional background ambient audio RMS monitoring)
    try {
      Stream<Uint8List>? micStream = MicStream.microphone(
        sampleRate: 16000,
        channelConfig: ChannelConfig.CHANNEL_IN_MONO,
        audioFormat: AudioFormat.ENCODING_PCM_16BIT,
      );
      if (micStream != null) {
        _micSubscription = micStream.listen((samples) {
          if (samples.isNotEmpty) {
            double sum = 0;
            for (int i = 0; i < samples.length; i += 2) {
              if (i + 1 < samples.length) {
                int sample = (samples[i] | (samples[i + 1] << 8));
                sum += sample * sample;
              }
            }
            _latestMicRms = (sum / (samples.length / 2));
          }
        }, onError: (e) {
          debugPrint("Telemetry: Mic stream runtime note: $e");
        });
      }
    } catch (e) {
      debugPrint("Telemetry: Mic stream non-available or permission denied: $e");
    }

    // 4. Camera background state tracking
    try {
      final cameras = await availableCameras();
      if (cameras.isNotEmpty) {
        _cameraController = CameraController(
          cameras.first,
          ResolutionPreset.low,
          enableAudio: false,
        );
        await _cameraController?.initialize();
        _isCameraActive = _cameraController?.value.isInitialized ?? false;
      }
    } catch (e) {
      debugPrint("Telemetry: Camera initialization skipped: $e");
    }

    // 5. OBD2 CAN service stream
    if (!_obdService.isConnected) {
      _obdService.startSimulation();
    }
    _obdSubscription = _obdService.obdDataStream.listen((reading) {
      _latestObd = reading;
      _processAndFlushRecord();
    });

    // Emit trip start EconEvent
    final startEvent = EconEvent(
      eventId: _uuid.v4(),
      eventType: 'TripStarted',
      account: walletAddress ?? '0x0000000000000000000000000000000000000000',
      amount: 0,
      timestamp: DateTime.now().millisecondsSinceEpoch,
      chainId: 137, // Polygon mainnet
      metadata: {
        'tripId': _activeTripId!,
        'source': 'mobile_telemetry_v2',
      },
    );
    _econEventController.add(startEvent);

    debugPrint("TelemetryService: Background monitoring active for trip $_activeTripId");
  }

  void _processAndFlushRecord() {
    if (!_isMonitoring) return;

    final record = TelemetryRecordPayload(
      recordId: _uuid.v4(),
      timestamp: DateTime.now().millisecondsSinceEpoch,
      latitude: _currentPosition?.latitude ?? 0.0,
      longitude: _currentPosition?.longitude ?? 0.0,
      speed: _currentPosition?.speed ?? _latestObd?.speed ?? 0.0,
      accelX: _latestAccel?.x ?? 0.0,
      accelY: _latestAccel?.y ?? 0.0,
      accelZ: _latestAccel?.z ?? 0.0,
      gyroX: _latestGyro?.x ?? 0.0,
      gyroY: _latestGyro?.y ?? 0.0,
      gyroZ: _latestGyro?.z ?? 0.0,
      micAudioRms: _latestMicRms,
      isCameraActive: _isCameraActive,
      obdRpm: _latestObd?.rpm ?? 0.0,
      obdSpeed: _latestObd?.speed ?? 0.0,
      obdCoolantTemp: _latestObd?.coolantTemp ?? 90.0,
    );

    _yjsPipelineBuffer.add(record);
    if (_yjsPipelineBuffer.length > 500) {
      _yjsPipelineBuffer.removeAt(0);
    }

    _telemetryController.add(record);
  }

  /// Stop monitoring and emit trip completion EconEvent
  Future<void> stopMonitoring({String? walletAddress}) async {
    if (!_isMonitoring) return;

    await _positionSubscription?.cancel();
    await _accelSubscription?.cancel();
    await _gyroSubscription?.cancel();
    await _micSubscription?.cancel();
    await _obdSubscription?.cancel();
    await _cameraController?.dispose();
    _cameraController = null;
    _isCameraActive = false;

    _isMonitoring = false;

    // Save Yjs pipeline buffer chunk to local encrypted vault
    if (_yjsPipelineBuffer.isNotEmpty && _vault != null) {
      try {
        final recordsToStore = _yjsPipelineBuffer.map((r) => TelemetryRecord(
          timestamp: r.timestamp,
          h3Index: 0,
          dataType: 'mobile_telemetry',
          speed: r.speed,
          latitude: r.latitude,
          longitude: r.longitude,
          payload: Uint8List(0),
        )).toList();
        await _vault!.storeRecords(recordsToStore);
      } catch (e) {
        debugPrint("Telemetry: Vault persistence note: $e");
      }
    }

    // Emit trip completion EconEvent with reward calculation
    final tripEvent = EconEvent(
      eventId: _uuid.v4(),
      eventType: 'TelemetryPurchased',
      account: walletAddress ?? '0x0000000000000000000000000000000000000000',
      amount: _yjsPipelineBuffer.length * 10, // 10 SWAL tokens per record
      timestamp: DateTime.now().millisecondsSinceEpoch,
      chainId: 137,
      metadata: {
        'tripId': _activeTripId ?? '',
        'recordCount': _yjsPipelineBuffer.length.toString(),
      },
    );
    _econEventController.add(tripEvent);

    debugPrint("TelemetryService: Monitoring stopped. Emitted EconEvent ${tripEvent.eventId}");
  }

  void dispose() {
    stopMonitoring();
    _telemetryController.close();
    _econEventController.close();
  }
}
