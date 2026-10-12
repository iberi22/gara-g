import 'package:flutter/foundation.dart';
import '../services/depin_service.dart';

class DepinProvider extends ChangeNotifier {
  final DepinService _depinService = DepinService();

  List<Map<String, dynamic>> _nodes = [];
  Map<String, dynamic>? _selectedNode;
  List<Map<String, dynamic>> _firmwareVersions = [];
  bool _isLoading = false;

  List<Map<String, dynamic>> get nodes => _nodes;
  Map<String, dynamic>? get selectedNode => _selectedNode;
  List<Map<String, dynamic>> get firmwareVersions => _firmwareVersions;
  bool get isLoading => _isLoading;

  Future<void> loadNodes() async {
    _isLoading = true;
    notifyListeners();
    _nodes = await _depinService.getNodes();
    _isLoading = false;
    notifyListeners();
  }

  Future<void> loadNodeDetail(String nodeId) async {
    _isLoading = true;
    notifyListeners();
    _selectedNode = await _depinService.getNodeDetail(nodeId);
    _isLoading = false;
    notifyListeners();
  }

  Future<void> loadFirmware() async {
    _isLoading = true;
    notifyListeners();
    _firmwareVersions = await _depinService.getFirmwareVersions();
    _isLoading = false;
    notifyListeners();
  }
}
