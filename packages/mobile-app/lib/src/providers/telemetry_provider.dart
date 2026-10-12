import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:gara_g_pilot/src/services/telemetry_service.dart';
import 'package:gara_g_pilot/src/services/obdService.dart';

/// Flutter ChangeNotifier Provider exposing mobile background telemetry & OBD2 data to UI widgets.
class TelemetryProvider with ChangeNotifier {
  final TelemetryService _telemetryService = TelemetryService();
  final ObdService _obdService = ObdService();

  StreamSubscription<TelemetryRecordPayload>? _telemetrySubscription;
  StreamSubscription<ObdReading>? _obdSubscription;
  StreamSubscription<EconEvent>? _econSubscription;

  bool _isMonitoring = false;
  bool get isMonitoring => _isMonitoring;

  TelemetryRecordPayload? _latestRecord;
  TelemetryRecordPayload? get latestRecord => _latestRecord;

  ObdReading? _latestObdReading;
  ObdReading? get latestObdReading => _latestObdReading;

  EconEvent? _latestEconEvent;
  EconEvent? get latestEconEvent => _latestEconEvent;

  double get currentSpeed => _latestRecord?.speed ?? _latestObdReading?.speed ?? 0.0;
  double get currentRpm => _latestObdReading?.rpm ?? _latestRecord?.obdRpm ?? 0.0;
  double get currentLatitude => _latestRecord?.latitude ?? 0.0;
  double get currentLongitude => _latestRecord?.longitude ?? 0.0;

  List<TelemetryRecordPayload> get yjsPipelineBuffer => _telemetryService.yjsPipelineBuffer;

  TelemetryProvider() {
    _initSubscriptions();
  }

  void _initSubscriptions() {
    _telemetrySubscription = _telemetryService.telemetryStream.listen((record) {
      _latestRecord = record;
      notifyListeners();
    });

    _obdSubscription = _obdService.obdDataStream.listen((reading) {
      _latestObdReading = reading;
      notifyListeners();
    });

    _econSubscription = _telemetryService.econEventStream.listen((event) {
      _latestEconEvent = event;
      notifyListeners();
    });
  }

  /// Start background telemetry streams (GPS, accelerometer, gyroscope, mic, OBD2)
  Future<void> startTelemetryMonitoring({String? walletAddress}) async {
    await _telemetryService.startMonitoring(walletAddress: walletAddress);
    _isMonitoring = _telemetryService.isMonitoring;
    notifyListeners();
  }

  /// Stop telemetry monitoring and persist trip session
  Future<void> stopTelemetryMonitoring({String? walletAddress}) async {
    await _telemetryService.stopMonitoring(walletAddress: walletAddress);
    _isMonitoring = _telemetryService.isMonitoring;
    notifyListeners();
  }

  @override
  void dispose() {
    _telemetrySubscription?.cancel();
    _obdSubscription?.cancel();
    _econSubscription?.cancel();
    super.dispose();
  }
}
