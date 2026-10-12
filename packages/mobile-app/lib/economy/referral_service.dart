/// Referral system for viral growth

import 'package:flutter/foundation.dart';
import 'package:gara_g_pilot/economy/token_manager.dart';

/// Referral status
enum ReferralStatus {
  pending,    // Link shared but not used
  active,     // Friend signed up
  qualified,  // Friend active for 7 days
  rewarded,   // Reward claimed
  expired,    // Link expired or friend inactive
}

/// Referral record
class Referral {
  final String code;
  final String? referredAddress;
  final DateTime createdAt;
  final DateTime? activatedAt;
  final DateTime? qualifiedAt;
  final ReferralStatus status;
  final BigInt rewardAmount;

  const Referral({
    required this.code,
    this.referredAddress,
    required this.createdAt,
    this.activatedAt,
    this.qualifiedAt,
    required this.status,
    required this.rewardAmount,
  });

  bool get canClaim => status == ReferralStatus.qualified;
}

/// Referral service
class ReferralService extends ChangeNotifier {
  String? _myReferralCode;
  String? _referredBy;
  final List<Referral> _referrals = [];

  String? get myReferralCode => _myReferralCode;
  String? get referredBy => _referredBy;
  List<Referral> get referrals => List.unmodifiable(_referrals);

  /// Total earned from referrals
  BigInt get totalEarned => _referrals
      .where((r) => r.status == ReferralStatus.rewarded)
      .fold(BigInt.zero, (sum, r) => sum + r.rewardAmount);

  /// Pending rewards
  BigInt get pendingRewards => _referrals
      .where((r) => r.status == ReferralStatus.qualified)
      .fold(BigInt.zero, (sum, r) => sum + r.rewardAmount);

  /// Generate referral code
  Future<String> generateCode() async {
    if (_myReferralCode != null) return _myReferralCode!;

    // Generate unique code from address
    _myReferralCode = 'GARA-${DateTime.now().millisecondsSinceEpoch.toRadixString(36).toUpperCase()}';
    notifyListeners();
    return _myReferralCode!;
  }

  /// Get shareable link
  String get shareLink => 'https://garanet.app/join?ref=$_myReferralCode';

  /// Claim referral reward
  Future<bool> claimReward(String code, TokenManager tokenManager) async {
    final index = _referrals.indexWhere((r) => r.code == code);
    if (index == -1) return false;

    final referral = _referrals[index];
    if (!referral.canClaim) return false;

    // Add reward
    tokenManager.addEarnings(referral.rewardAmount, 'Referral bonus');

    // Update status
    _referrals[index] = Referral(
      code: referral.code,
      referredAddress: referral.referredAddress,
      createdAt: referral.createdAt,
      activatedAt: referral.activatedAt,
      qualifiedAt: referral.qualifiedAt,
      status: ReferralStatus.rewarded,
      rewardAmount: referral.rewardAmount,
    );

    notifyListeners();
    return true;
  }

  /// Referral reward amount
  static BigInt get rewardAmount => BigInt.from(500 * 100000); // 500 DC

  /// Bonus tiers
  static BigInt bonusForCount(int count) {
    if (count >= 100) return BigInt.from(1000 * 100000); // 1000 DC
    if (count >= 50) return BigInt.from(750 * 100000);   // 750 DC
    if (count >= 25) return BigInt.from(600 * 100000);   // 600 DC
    if (count >= 10) return BigInt.from(550 * 100000);   // 550 DC
    return rewardAmount;
  }
}
