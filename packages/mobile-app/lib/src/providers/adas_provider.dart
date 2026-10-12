import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:gara_g_pilot/src/services/adas_service.dart';

class AdasProvider with ChangeNotifier {
  final AdasService _adasService;
  AdasState _state = AdasState.initial();
  bool _isProcessing = false;
  DateTime _lastUpdateTime = DateTime.now();

  // Throttle: Max 5 updates per second (200ms interval)
  static const int _throttleMs = 200;

  AdasProvider(this._adasService);

  AdasState get state => _state;
  bool get isProcessing => _isProcessing;

  Future<void> updateFromFrame(Uint8List frameData) async {
    final now = DateTime.now();
    if (now.difference(_lastUpdateTime).inMilliseconds < _throttleMs) {
      return;
    }

    if (_isProcessing) return;

    _isProcessing = true;
    // notifyListeners(); // Don't notify just for processing start to avoid UI stutter

    try {
      final newState = await _adasService.processFrame(frameData);
      _state = newState;
      _lastUpdateTime = now;
      notifyListeners();
    } catch (e) {
      debugPrint('AdasProvider Error: $e');
    } finally {
      _isProcessing = false;
    }
  }

  void reset() {
    _state = AdasState.initial();
    notifyListeners();
  }
}
