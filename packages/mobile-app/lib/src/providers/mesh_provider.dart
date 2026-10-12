import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter/foundation.dart';
import '../services/mesh_service.dart';

class MeshProvider extends ChangeNotifier {
  final MeshService _meshService = MeshService();

  bool _isAdvertising = false;
  bool _isDiscovering = false;

  bool get isAdvertising => _isAdvertising;
  bool get isDiscovering => _isDiscovering;

  Future<void> start() async {
    await _meshService.startAdvertising();
    _isAdvertising = true;
    await _meshService.startDiscovery();
    _isDiscovering = true;
    notifyListeners();
  }

  Future<void> send(String message) async {
    await _meshService.sendPayload(Uint8List.fromList(utf8.encode(message)));
  }
}
