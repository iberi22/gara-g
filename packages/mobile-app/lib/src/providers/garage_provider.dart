import 'package:flutter/foundation.dart';
import 'package:gara_g_pilot/src/services/web3_service.dart';
import 'package:gara_g_pilot/src/services/ipfs_service.dart';

class GarageProvider extends ChangeNotifier {
  final Web3Service _web3;
  final IpfsService _ipfs;

  List<OnChainVehicle> _vehicles = [];
  Map<int, VehicleMetadata> _metadata = {};
  bool _isLoading = false;
  String? _error;

  GarageProvider(this._web3, this._ipfs);

  List<OnChainVehicle> get vehicles => _vehicles;
  Map<int, VehicleMetadata> get metadata => _metadata;
  bool get isLoading => _isLoading;
  String? get error => _error;

  Future<void> loadGarage() async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final tokenIds = await _web3.getGarage(_web3.walletAddress);

      _vehicles = [];
      for (final tokenId in tokenIds) {
        final vehicle = await _web3.getVehicle(tokenId);
        _vehicles.add(vehicle);

        // Load metadata from IPFS
        if (vehicle.metadataUri.isNotEmpty) {
          try {
            final meta = await _ipfs.fetchVehicleMetadata(vehicle.metadataUri);
            _metadata[tokenId] = meta;
          } catch (e) {
            debugPrint('Failed to load metadata for $tokenId: $e');
          }
        }
      }
    } catch (e) {
      _error = e.toString();
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<bool> updateVehicleStatus(int tokenId, VehicleStatus status) async {
    try {
      final txHash = await _web3.setStatus(tokenId, status);
      await _web3.waitForTransaction(txHash);
      await loadGarage(); // Refresh
      return true;
    } catch (e) {
      _error = e.toString();
      notifyListeners();
      return false;
    }
  }

  Future<bool> updateMileage(int tokenId, int mileage) async {
    try {
      final txHash = await _web3.updateMileage(tokenId, mileage);
      await _web3.waitForTransaction(txHash);
      await loadGarage();
      return true;
    } catch (e) {
      _error = e.toString();
      notifyListeners();
      return false;
    }
  }

  Future<bool> recordMaintenance(int tokenId, String description) async {
    try {
      // Upload maintenance record to IPFS
      final record = {
        'date': DateTime.now().toIso8601String(),
        'description': description,
        'tokenId': tokenId,
      };

      final ipfsHash = await _ipfs.uploadJson(record, 'maintenance-$tokenId-${DateTime.now().millisecondsSinceEpoch}');

      final txHash = await _web3.recordMaintenance(tokenId, ipfsHash);
      await _web3.waitForTransaction(txHash);
      await loadGarage();
      return true;
    } catch (e) {
      _error = e.toString();
      notifyListeners();
      return false;
    }
  }

  Future<bool> transferVehicle(int tokenId, String toAddress) async {
    try {
      final txHash = await _web3.transferVehicle(tokenId, toAddress);
      await _web3.waitForTransaction(txHash);
      await loadGarage();
      return true;
    } catch (e) {
      _error = e.toString();
      notifyListeners();
      return false;
    }
  }
}
