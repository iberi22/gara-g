import 'dart:convert';
import 'package:hive_flutter/hive_flutter.dart';
import '../rust/api.dart' as rust;
import '../models/marketplace_models.dart';

/// Service for managing marketplace data selling operations
class MarketplaceService {
  static final MarketplaceService _instance = MarketplaceService._();
  factory MarketplaceService() => _instance;
  MarketplaceService._();

  static const String _settingsBoxName = 'marketplace_settings';
  static const String _historyBoxName = 'marketplace_history';
  static const String _packagesBoxName = 'marketplace_packages';

  Box<dynamic>? _settingsBox;
  Box<dynamic>? _historyBox;
  Box<dynamic>? _packagesBox;

  /// Initialize Hive boxes for persistent storage
  Future<void> initialize() async {
    _settingsBox = await Hive.openBox(_settingsBoxName);
    _historyBox = await Hive.openBox(_historyBoxName);
    _packagesBox = await Hive.openBox(_packagesBoxName);
  }

  /// Get current marketplace settings
  Future<MarketplaceSettings> getSettings() async {
    await _ensureInitialized();
    final data = _settingsBox!.get('settings');
    if (data == null) {
      return const MarketplaceSettings();
    }
    return MarketplaceSettings.fromJson(Map<String, dynamic>.from(data));
  }

  /// Update marketplace settings
  Future<void> saveSettings(MarketplaceSettings settings) async {
    await _ensureInitialized();
    await _settingsBox!.put('settings', settings.toJson());
  }

  /// Opt into the marketplace with specified settings
  Future<void> optIn(MarketplaceSettings settings) async {
    await saveSettings(settings);
    await _settingsBox!.put('opted_in', true);
    // TODO: Register with blockchain contract when available
  }

  /// Opt out of the marketplace
  Future<void> optOut() async {
    await _ensureInitialized();
    await _settingsBox!.put('opted_in', false);
    // TODO: Unregister from marketplace contract
  }

  /// Check if user is currently opted in
  Future<bool> isOptedIn() async {
    await _ensureInitialized();
    return _settingsBox!.get('opted_in', defaultValue: false) as bool;
  }

  /// Get list of pending data packages ready for sale
  Future<List<DataPackage>> getPendingPackages() async {
    await _ensureInitialized();
    final List<DataPackage> packages = [];
    
    // Get all stored packages
    for (var key in _packagesBox!.keys) {
      final data = _packagesBox!.get(key);
      if (data != null) {
        final package = DataPackage.fromJson(Map<String, dynamic>.from(data));
        if (package.status == 'pending') {
          packages.add(package);
        }
      }
    }
    
    return packages;
  }

  /// Get earnings from Rust backend (pending claimable rewards)
  Future<double> getEarnings() async {
    try {
      final reward = await rust.getMyPendingReward();
      return reward.toDouble() / 1000000.0;
    } catch (e) {
      return 0.0;
    }
  }

  /// Get total on-chain earnings (wallet balance in GARA)
  Future<double> getTotalEarnings() async {
    const double garaDecimals = 1000000.0;
    try {
      final pubkey = await rust.walletGetPublicKey();
      final balanceBigInt = await rust.getWalletBalance(pubkey: pubkey);
      return balanceBigInt.toDouble() / garaDecimals;
    } catch (e) {
      return 0.0;
    }
  }

  /// Claim earnings from blockchain
  Future<String> claimEarnings() async {
    try {
      // Get wallet public key
      final pubkey = await rust.walletGetPublicKey();
      
      // For now, return a success message
      // TODO: Implement actual blockchain claim transaction
      return 'Claim transaction submitted for $pubkey';
    } catch (e) {
      throw Exception('Failed to claim earnings: $e');
    }
  }

  /// Submit anonymized data batch to marketplace
  Future<void> submitDataBatch({
    required int telemetryCount,
    required List<String> h3Cells,
  }) async {
    try {
      // For now, return a placeholder until the Rust side is fully implemented
      // TODO: Implement actual proof of coverage in Rust
      final txHash = "0x${DateTime.now().millisecondsSinceEpoch}";

      // Create package record
      final package = DataPackage(
        id: txHash,
        type: 'telemetry',
        timestamp: DateTime.now(),
        earnedGara: 0.0, // Will be updated when sold
        status: 'pending',
        dataPoints: telemetryCount,
      );

      // Store package
      await _ensureInitialized();
      await _packagesBox!.put(txHash, package.toJson());
    } catch (e) {
      throw Exception('Failed to submit data batch: $e');
    }
  }

  /// Get earnings history
  Future<EarningsHistory> getEarningsHistory() async {
    await _ensureInitialized();
    final data = _historyBox!.get('history');
    if (data == null) {
      return const EarningsHistory();
    }
    return EarningsHistory.fromJson(Map<String, dynamic>.from(data));
  }

  /// Add an earning entry to history
  Future<void> addEarningEntry(EarningEntry entry) async {
    await _ensureInitialized();
    final history = await getEarningsHistory();
    final updatedEntries = [...history.entries, entry];
    final updatedHistory = EarningsHistory(
      entries: updatedEntries,
      totalEarned: history.totalEarned + entry.amount,
      totalClaimed: entry.status == 'claimed' 
          ? history.totalClaimed + entry.amount 
          : history.totalClaimed,
    );
    await _historyBox!.put('history', updatedHistory.toJson());
  }

  /// Get recent sales (last N packages)
  Future<List<DataPackage>> getRecentSales({int limit = 10}) async {
    await _ensureInitialized();
    final List<DataPackage> packages = [];
    
    for (var key in _packagesBox!.keys) {
      final data = _packagesBox!.get(key);
      if (data != null) {
        final package = DataPackage.fromJson(Map<String, dynamic>.from(data));
        if (package.status == 'sold' || package.status == 'claimed') {
          packages.add(package);
        }
      }
    }
    
    // Sort by timestamp descending
    packages.sort((a, b) => b.timestamp.compareTo(a.timestamp));
    
    // Return limited results
    return packages.take(limit).toList();
  }

  /// Mark a package as claimed
  Future<void> markPackageClaimed(String packageId) async {
    await _ensureInitialized();
    final data = _packagesBox!.get(packageId);
    if (data != null) {
      final package = DataPackage.fromJson(Map<String, dynamic>.from(data));
      final updatedPackage = DataPackage(
        id: package.id,
        type: package.type,
        timestamp: package.timestamp,
        earnedGara: package.earnedGara,
        status: 'claimed',
        dataPoints: package.dataPoints,
      );
      await _packagesBox!.put(packageId, updatedPackage.toJson());
    }
  }

  Future<void> _ensureInitialized() async {
    if (_settingsBox == null || _historyBox == null || _packagesBox == null) {
      await initialize();
    }
  }
}
