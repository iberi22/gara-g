import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:web3dart/web3dart.dart';
import 'package:gara_g_pilot/src/rust/api.dart';

/// Vehicle status enum matching the smart contract
enum VehicleStatus {
  active,      // 0
  forSale,     // 1
  maintenance, // 2
  stolen,      // 3
  retired,     // 4
}

/// Vehicle data from the blockchain
class OnChainVehicle {
  final int tokenId;
  final String owner;
  final String deviceId;
  final VehicleStatus status;
  final DateTime registeredAt;
  final DateTime lastUpdated;
  final int maintenanceCount;
  final int mileage;
  final String metadataUri;

  OnChainVehicle({
    required this.tokenId,
    required this.owner,
    required this.deviceId,
    required this.status,
    required this.registeredAt,
    required this.lastUpdated,
    required this.maintenanceCount,
    required this.mileage,
    required this.metadataUri,
  });

  factory OnChainVehicle.fromContractData(List<dynamic> data, String uri) {
    return OnChainVehicle(
      tokenId: 0, // Set separately
      owner: (data[0] as EthereumAddress).hex,
      deviceId: bytesToHex(data[1] as List<int>),
      status: VehicleStatus.values[data[2] as int],
      registeredAt: DateTime.fromMillisecondsSinceEpoch((data[3] as BigInt).toInt() * 1000),
      lastUpdated: DateTime.fromMillisecondsSinceEpoch((data[4] as BigInt).toInt() * 1000),
      maintenanceCount: (data[5] as BigInt).toInt(),
      mileage: (data[6] as BigInt).toInt(),
      metadataUri: uri,
    );
  }
}

/// Service for interacting with the GaranetVehicle smart contract
class Web3Service {
  static Web3Service? _instance;

  late Web3Client _client;
  late DeployedContract _vehicleContract;
  late EthPrivateKey _credentials;

  // Contract address - update with deployed address
  static const String _contractAddress = '0x0000000000000000000000000000000000000000'; // TODO: Set actual address

  // RPC endpoints
  static const String _mainnetRpc = 'https://rpc.garanet.cloud';
  static const String _testnetRpc = 'https://testnet-rpc.garanet.cloud';

  // Current network
  bool _isTestnet = true;

  Web3Service._internal();

  static Future<Web3Service> getInstance() async {
    if (_instance == null) {
      _instance = Web3Service._internal();
      await _instance!._initialize();
    }
    return _instance!;
  }

  Future<void> _initialize() async {
    final rpcUrl = _isTestnet ? _testnetRpc : _mainnetRpc;
    _client = Web3Client(rpcUrl, http.Client());

    // Load contract ABI
    _vehicleContract = DeployedContract(
      ContractAbi.fromJson(_garanetVehicleAbi, 'GaranetVehicle'),
      EthereumAddress.fromHex(_contractAddress),
    );

    // Load credentials from secure storage
    await _loadCredentials();
  }

  Future<void> _loadCredentials() async {
    try {
      final secretKey = await walletExportSecret();
      _credentials = EthPrivateKey.fromHex(bytesToHex(secretKey));
    } catch (e) {
      debugPrint('Web3: No wallet found, creating new one');
      // Will need to create wallet first
    }
  }

  /// Get the connected wallet address
  String get walletAddress => _credentials.address.hex;

  /// Switch between testnet and mainnet
  Future<void> switchNetwork(bool testnet) async {
    _isTestnet = testnet;
    await _initialize();
  }

  // ============================================================================
  // Read Functions (no gas required)
  // ============================================================================

  /// Get all vehicles owned by an address (the user's "garage")
  Future<List<int>> getGarage(String ownerAddress) async {
    final function = _vehicleContract.function('getGarage');
    final result = await _client.call(
      contract: _vehicleContract,
      function: function,
      params: [EthereumAddress.fromHex(ownerAddress)],
    );

    final tokenIds = result[0] as List<dynamic>;
    return tokenIds.map((id) => (id as BigInt).toInt()).toList();
  }

  /// Get complete vehicle info by token ID
  Future<OnChainVehicle> getVehicle(int tokenId) async {
    final function = _vehicleContract.function('getVehicle');
    final result = await _client.call(
      contract: _vehicleContract,
      function: function,
      params: [BigInt.from(tokenId)],
    );

    final vehicle = OnChainVehicle.fromContractData(result, result[7] as String);
    return OnChainVehicle(
      tokenId: tokenId,
      owner: vehicle.owner,
      deviceId: vehicle.deviceId,
      status: vehicle.status,
      registeredAt: vehicle.registeredAt,
      lastUpdated: vehicle.lastUpdated,
      maintenanceCount: vehicle.maintenanceCount,
      mileage: vehicle.mileage,
      metadataUri: vehicle.metadataUri,
    );
  }

  /// Get vehicle by Sentinel device ID
  Future<int?> getVehicleByDevice(String deviceId) async {
    final function = _vehicleContract.function('getVehicleByDevice');
    final result = await _client.call(
      contract: _vehicleContract,
      function: function,
      params: [hexToBytes(deviceId)],
    );

    final tokenId = (result[0] as BigInt).toInt();
    return tokenId > 0 ? tokenId : null;
  }

  /// Get maintenance history for a vehicle
  Future<List<String>> getMaintenanceHistory(int tokenId) async {
    final function = _vehicleContract.function('getMaintenanceHistory');
    final result = await _client.call(
      contract: _vehicleContract,
      function: function,
      params: [BigInt.from(tokenId)],
    );

    return (result[0] as List<dynamic>).map((e) => e as String).toList();
  }

  /// Check if vehicle is transferable
  Future<bool> isTransferable(int tokenId) async {
    final function = _vehicleContract.function('isTransferable');
    final result = await _client.call(
      contract: _vehicleContract,
      function: function,
      params: [BigInt.from(tokenId)],
    );

    return result[0] as bool;
  }

  // ============================================================================
  // Write Functions (require gas)
  // ============================================================================

  /// Update vehicle metadata (IPFS URI)
  Future<String> updateMetadata(int tokenId, String newUri) async {
    final function = _vehicleContract.function('updateMetadata');

    final txHash = await _client.sendTransaction(
      _credentials,
      Transaction.callContract(
        contract: _vehicleContract,
        function: function,
        parameters: [BigInt.from(tokenId), newUri],
      ),
      chainId: _isTestnet ? 2 : 1,
    );

    return txHash;
  }

  /// Register a Sentinel device to a vehicle
  Future<String> registerDevice(int tokenId, String deviceSignature) async {
    final function = _vehicleContract.function('registerDevice');

    final txHash = await _client.sendTransaction(
      _credentials,
      Transaction.callContract(
        contract: _vehicleContract,
        function: function,
        parameters: [BigInt.from(tokenId), hexToBytes(deviceSignature)],
      ),
      chainId: _isTestnet ? 2 : 1,
    );

    return txHash;
  }

  /// Unregister a Sentinel device from a vehicle
  Future<String> unregisterDevice(int tokenId) async {
    final function = _vehicleContract.function('unregisterDevice');

    final txHash = await _client.sendTransaction(
      _credentials,
      Transaction.callContract(
        contract: _vehicleContract,
        function: function,
        parameters: [BigInt.from(tokenId)],
      ),
      chainId: _isTestnet ? 2 : 1,
    );

    return txHash;
  }

  /// Change vehicle status
  Future<String> setStatus(int tokenId, VehicleStatus newStatus) async {
    final function = _vehicleContract.function('setStatus');

    final txHash = await _client.sendTransaction(
      _credentials,
      Transaction.callContract(
        contract: _vehicleContract,
        function: function,
        parameters: [BigInt.from(tokenId), BigInt.from(newStatus.index)],
      ),
      chainId: _isTestnet ? 2 : 1,
    );

    return txHash;
  }

  /// Record a maintenance event
  Future<String> recordMaintenance(int tokenId, String ipfsHash) async {
    final function = _vehicleContract.function('recordMaintenance');

    final txHash = await _client.sendTransaction(
      _credentials,
      Transaction.callContract(
        contract: _vehicleContract,
        function: function,
        parameters: [BigInt.from(tokenId), ipfsHash],
      ),
      chainId: _isTestnet ? 2 : 1,
    );

    return txHash;
  }

  /// Update vehicle mileage (only increases allowed)
  Future<String> updateMileage(int tokenId, int newMileage) async {
    final function = _vehicleContract.function('updateMileage');

    final txHash = await _client.sendTransaction(
      _credentials,
      Transaction.callContract(
        contract: _vehicleContract,
        function: function,
        parameters: [BigInt.from(tokenId), BigInt.from(newMileage)],
      ),
      chainId: _isTestnet ? 2 : 1,
    );

    return txHash;
  }

  /// Transfer vehicle to another address (P2P sale)
  Future<String> transferVehicle(int tokenId, String toAddress) async {
    final function = _vehicleContract.function('transferVehicle');

    final txHash = await _client.sendTransaction(
      _credentials,
      Transaction.callContract(
        contract: _vehicleContract,
        function: function,
        parameters: [BigInt.from(tokenId), EthereumAddress.fromHex(toAddress)],
      ),
      chainId: _isTestnet ? 2 : 1,
    );

    return txHash;
  }

  // ============================================================================
  // Utility Functions
  // ============================================================================

  /// Wait for transaction confirmation
  Future<TransactionReceipt?> waitForTransaction(String txHash) async {
    TransactionReceipt? receipt;
    int attempts = 0;

    while (receipt == null && attempts < 60) {
      await Future.delayed(const Duration(seconds: 2));
      receipt = await _client.getTransactionReceipt(txHash);
      attempts++;
    }

    return receipt;
  }

  /// Estimate gas for a transaction
  Future<BigInt> estimateGas(String functionName, List<dynamic> params) async {
    final function = _vehicleContract.function(functionName);

    final gas = await _client.estimateGas(
      sender: _credentials.address,
      to: _vehicleContract.address,
      data: function.encodeCall(params),
    );

    return gas;
  }

  void dispose() {
    _client.dispose();
  }
}

// ============================================================================
// Contract ABI (simplified - include full ABI in production)
// ============================================================================

const String _garanetVehicleAbi = '''
[
  {
    "inputs": [{"internalType": "address", "name": "owner", "type": "address"}],
    "name": "getGarage",
    "outputs": [{"internalType": "uint256[]", "name": "", "type": "uint256[]"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{"internalType": "uint256", "name": "tokenId", "type": "uint256"}],
    "name": "getVehicle",
    "outputs": [
      {"internalType": "address", "name": "vehicleOwner", "type": "address"},
      {"internalType": "bytes32", "name": "deviceId", "type": "bytes32"},
      {"internalType": "uint8", "name": "status", "type": "uint8"},
      {"internalType": "uint64", "name": "registeredAt", "type": "uint64"},
      {"internalType": "uint64", "name": "lastUpdated", "type": "uint64"},
      {"internalType": "uint32", "name": "maintenanceCount", "type": "uint32"},
      {"internalType": "uint256", "name": "mileage", "type": "uint256"},
      {"internalType": "string", "name": "uri", "type": "string"}
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{"internalType": "bytes32", "name": "deviceId", "type": "bytes32"}],
    "name": "getVehicleByDevice",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{"internalType": "uint256", "name": "tokenId", "type": "uint256"}],
    "name": "getMaintenanceHistory",
    "outputs": [{"internalType": "string[]", "name": "", "type": "string[]"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{"internalType": "uint256", "name": "tokenId", "type": "uint256"}],
    "name": "isTransferable",
    "outputs": [{"internalType": "bool", "name": "", "type": "bool"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {"internalType": "uint256", "name": "tokenId", "type": "uint256"},
      {"internalType": "string", "name": "newUri", "type": "string"}
    ],
    "name": "updateMetadata",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {"internalType": "uint256", "name": "tokenId", "type": "uint256"},
      {"internalType": "bytes32", "name": "deviceSignature", "type": "bytes32"}
    ],
    "name": "registerDevice",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{"internalType": "uint256", "name": "tokenId", "type": "uint256"}],
    "name": "unregisterDevice",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {"internalType": "uint256", "name": "tokenId", "type": "uint256"},
      {"internalType": "uint8", "name": "newStatus", "type": "uint8"}
    ],
    "name": "setStatus",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {"internalType": "uint256", "name": "tokenId", "type": "uint256"},
      {"internalType": "string", "name": "ipfsHash", "type": "string"}
    ],
    "name": "recordMaintenance",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {"internalType": "uint256", "name": "tokenId", "type": "uint256"},
      {"internalType": "uint256", "name": "newMileage", "type": "uint256"}
    ],
    "name": "updateMileage",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {"internalType": "uint256", "name": "tokenId", "type": "uint256"},
      {"internalType": "address", "name": "to", "type": "address"}
    ],
    "name": "transferVehicle",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
]
''';

// Helper functions
String bytesToHex(List<int> bytes) {
  return '0x${bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join()}';
}

List<int> hexToBytes(String hex) {
  final h = hex.startsWith('0x') ? hex.substring(2) : hex;
  return List.generate(h.length ~/ 2, (i) => int.parse(h.substring(i * 2, i * 2 + 2), radix: 16));
}
