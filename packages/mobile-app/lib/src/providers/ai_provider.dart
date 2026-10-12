import 'package:flutter/material.dart';
import 'dart:typed_data';
import 'package:gara_g_pilot/src/services/ai_bridge.dart';

class AiProvider with ChangeNotifier {
  final AiBridge _aiBridge;
  String _frameAnalysisResult = '';
  String _audioAnalysisResult = '';
  bool _isProcessing = false;
  bool _isListening = false;

  AiProvider(this._aiBridge);

  String get frameAnalysisResult => _frameAnalysisResult;
  String get audioAnalysisResult => _audioAnalysisResult;
  bool get isProcessing => _isProcessing;
  bool get isListening => _isListening;

  Future<void> analyzeFrame(Uint8List frameData) async {
    _isProcessing = true;
    notifyListeners();

    try {
      final result = await _aiBridge.analyzeVideoFrame(frameData);
      _frameAnalysisResult = result.processingMode;
    } catch (e) {
      _frameAnalysisResult = 'Error: $e';
    } finally {
      _isProcessing = false;
      notifyListeners();
    }
  }

  Future<void> analyzeAudio(Uint8List audioData) async {
    _isProcessing = true;
    notifyListeners();

    try {
      final result = await _aiBridge.analyzeAudioBuffer(audioData);
      _audioAnalysisResult = result.processingMode;
    } catch (e) {
      _audioAnalysisResult = 'Error: $e';
    } finally {
      _isProcessing = false;
      notifyListeners();
    }
  }

  void startListening() {
    _isListening = true;
    notifyListeners();
  }

  void stopListening() {
    _isListening = false;
    notifyListeners();
  }
}
