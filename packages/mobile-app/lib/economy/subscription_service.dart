/// Subscription management for premium tiers

import 'package:flutter/foundation.dart';
import 'package:gara_g_pilot/economy/token_manager.dart';

/// Subscription tiers
enum SubscriptionTier {
  free,
  premium,
  pro,
}

/// Subscription details
class Subscription {
  final SubscriptionTier tier;
  final DateTime? startDate;
  final DateTime? endDate;
  final BigInt monthlyDcCost;
  final bool autoRenew;

  const Subscription({
    required this.tier,
    this.startDate,
    this.endDate,
    required this.monthlyDcCost,
    this.autoRenew = true,
  });

  bool get isActive {
    if (tier == SubscriptionTier.free) return true;
    if (endDate == null) return false;
    return DateTime.now().isBefore(endDate!);
  }

  int get daysRemaining {
    if (endDate == null) return 0;
    return endDate!.difference(DateTime.now()).inDays;
  }

  factory Subscription.free() => Subscription(
    tier: SubscriptionTier.free,
    monthlyDcCost: BigInt.zero,
  );
}

/// Subscription service
class SubscriptionService extends ChangeNotifier {
  Subscription _current = Subscription.free();

  Subscription get current => _current;

  /// Get tier benefits
  TierBenefits get benefits => TierBenefits.forTier(_current.tier);

  /// Subscribe to a tier
  Future<bool> subscribe(
    SubscriptionTier tier,
    TokenManager tokenManager,
  ) async {
    final cost = _costForTier(tier);

    // Check DC balance
    if (tokenManager.balance.dcBalance < cost) {
      return false;
    }

    // Spend DC
    await tokenManager.spendDc(cost, '${tier.name} Subscription');

    _current = Subscription(
      tier: tier,
      startDate: DateTime.now(),
      endDate: DateTime.now().add(const Duration(days: 30)),
      monthlyDcCost: cost,
      autoRenew: true,
    );

    notifyListeners();
    return true;
  }

  BigInt _costForTier(SubscriptionTier tier) {
    switch (tier) {
      case SubscriptionTier.free:
        return BigInt.zero;
      case SubscriptionTier.premium:
        return BigInt.from(100 * 100000); // 100 DC (DC has 5 decimals)
      case SubscriptionTier.pro:
        return BigInt.from(500 * 100000); // 500 DC
    }
  }

  /// Cancel subscription
  void cancel() {
    _current = Subscription(
      tier: _current.tier,
      startDate: _current.startDate,
      endDate: _current.endDate,
      monthlyDcCost: _current.monthlyDcCost,
      autoRenew: false,
    );
    notifyListeners();
  }
}

/// Benefits per tier
class TierBenefits {
  final int aiCallsPerDay;
  final double earningMultiplier;
  final bool advancedRoutes;
  final bool regionalAlerts;
  final int historyDays;
  final int insuranceDiscount;
  final double votingMultiplier;
  final bool nftBadges;
  final bool prioritySupport;

  const TierBenefits({
    required this.aiCallsPerDay,
    required this.earningMultiplier,
    required this.advancedRoutes,
    required this.regionalAlerts,
    required this.historyDays,
    required this.insuranceDiscount,
    required this.votingMultiplier,
    required this.nftBadges,
    required this.prioritySupport,
  });

  factory TierBenefits.forTier(SubscriptionTier tier) {
    switch (tier) {
      case SubscriptionTier.free:
        return const TierBenefits(
          aiCallsPerDay: 3,
          earningMultiplier: 0.5,
          advancedRoutes: false,
          regionalAlerts: false,
          historyDays: 7,
          insuranceDiscount: 0,
          votingMultiplier: 0.0,
          nftBadges: false,
          prioritySupport: false,
        );
      case SubscriptionTier.premium:
        return const TierBenefits(
          aiCallsPerDay: 20,
          earningMultiplier: 1.0,
          advancedRoutes: true,
          regionalAlerts: true,
          historyDays: 90,
          insuranceDiscount: 5,
          votingMultiplier: 1.0,
          nftBadges: true,
          prioritySupport: false,
        );
      case SubscriptionTier.pro:
        return const TierBenefits(
          aiCallsPerDay: 999999, // Unlimited
          earningMultiplier: 1.5,
          advancedRoutes: true,
          regionalAlerts: true,
          historyDays: 999999, // Unlimited
          insuranceDiscount: 15,
          votingMultiplier: 2.0,
          nftBadges: true,
          prioritySupport: true,
        );
    }
  }
}
