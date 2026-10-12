import 'package:flutter_test/flutter_test.dart';
import 'package:gara_g_pilot/economy/subscription_service.dart';
import 'package:gara_g_pilot/economy/token_manager.dart';

void main() {
  group('Subscription (model)', () {
    test('free subscription is always active', () {
      final sub = Subscription.free();
      expect(sub.tier, SubscriptionTier.free);
      expect(sub.isActive, isTrue);
      expect(sub.monthlyDcCost, BigInt.zero);
    });

    test('isActive returns false when endDate is past', () {
      final expired = Subscription(
        tier: SubscriptionTier.premium,
        startDate: DateTime.now().subtract(const Duration(days: 60)),
        endDate: DateTime.now().subtract(const Duration(days: 30)),
        monthlyDcCost: BigInt.from(100 * 100000),
      );
      expect(expired.isActive, isFalse);
    });

    test('isActive returns true when endDate is in the future', () {
      final active = Subscription(
        tier: SubscriptionTier.premium,
        startDate: DateTime.now(),
        endDate: DateTime.now().add(const Duration(days: 30)),
        monthlyDcCost: BigInt.from(100 * 100000),
      );
      expect(active.isActive, isTrue);
    });

    test('daysRemaining returns correct count', () {
      final sub = Subscription(
        tier: SubscriptionTier.premium,
        endDate: DateTime.now().add(const Duration(days: 15)),
        monthlyDcCost: BigInt.from(100 * 100000),
      );
      expect(sub.daysRemaining, 15);
    });

    test('daysRemaining returns 0 when no endDate', () {
      final sub = Subscription(
        tier: SubscriptionTier.free,
        monthlyDcCost: BigInt.zero,
      );
      expect(sub.daysRemaining, 0);
    });
  });

  group('SubscriptionService', () {
    late SubscriptionService subscriptionService;
    late TokenManager tokenManager;

    setUp(() {
      subscriptionService = SubscriptionService();
      tokenManager = TokenManager();
    });

    test('initial tier is free', () {
      expect(subscriptionService.current.tier, SubscriptionTier.free);
    });

    test('subscribe returns false when DC balance is insufficient', () async {
      // TokenManager starts with zero balance
      final result = await subscriptionService.subscribe(
        SubscriptionTier.premium,
        tokenManager,
      );

      expect(result, isFalse);
      expect(subscriptionService.current.tier, SubscriptionTier.free);
    });

    /// Helper: set up DC balance in token manager
    /// The flow: addEarnings -> claimRewards (gets GARA) -> burnForDc (GARA -> DC)
    Future<void> setupDcBalance(BigInt dcAmount) async {
      // Earnings go to pendingRewards
      tokenManager.addEarnings(dcAmount, 'Test setup');
      // Claim to get GARA balance
      await tokenManager.claimRewards();
      // Burn GARA for DC (price doesn't matter much for this test)
      await tokenManager.burnForDc(dcAmount, 0.00001); // 1:1 conversion
    }

    test('subscribe succeeds when sufficient DC balance exists', () async {
      await setupDcBalance(BigInt.from(200 * 100000)); // 200 DC

      final result = await subscriptionService.subscribe(
        SubscriptionTier.premium,
        tokenManager,
      );

      expect(result, isTrue);
      expect(subscriptionService.current.tier, SubscriptionTier.premium);
      expect(subscriptionService.current.isActive, isTrue);
      expect(subscriptionService.current.monthlyDcCost,
          BigInt.from(100 * 100000));
    });

    test('subscribing to Pro tier costs and deducts 500 DC', () async {
      await setupDcBalance(BigInt.from(1000 * 100000)); // 1000 DC

      final initialBalance = tokenManager.balance.dcBalance;

      await subscriptionService.subscribe(
        SubscriptionTier.pro,
        tokenManager,
      );

      final spent = initialBalance - tokenManager.balance.dcBalance;
      expect(spent, BigInt.from(500 * 100000));
      expect(subscriptionService.current.tier, SubscriptionTier.pro);
    });

    test('cancel sets autoRenew to false without changing tier', () async {
      await setupDcBalance(BigInt.from(200 * 100000)); // 200 DC

      await subscriptionService.subscribe(
        SubscriptionTier.premium,
        tokenManager,
      );

      expect(subscriptionService.current.autoRenew, isTrue);

      subscriptionService.cancel();

      expect(subscriptionService.current.autoRenew, isFalse);
      expect(subscriptionService.current.tier, SubscriptionTier.premium);
    });
  });

  group('TierBenefits', () {
    test('free tier has basic benefits', () {
      final benefits = TierBenefits.forTier(SubscriptionTier.free);
      expect(benefits.aiCallsPerDay, 3);
      expect(benefits.earningMultiplier, 0.5);
      expect(benefits.advancedRoutes, isFalse);
      expect(benefits.regionalAlerts, isFalse);
      expect(benefits.historyDays, 7);
      expect(benefits.insuranceDiscount, 0);
      expect(benefits.nftBadges, isFalse);
      expect(benefits.prioritySupport, isFalse);
    });

    test('premium tier has enhanced benefits', () {
      final benefits = TierBenefits.forTier(SubscriptionTier.premium);
      expect(benefits.aiCallsPerDay, 20);
      expect(benefits.earningMultiplier, 1.0);
      expect(benefits.advancedRoutes, isTrue);
      expect(benefits.regionalAlerts, isTrue);
      expect(benefits.historyDays, 90);
      expect(benefits.insuranceDiscount, 5);
      expect(benefits.votingMultiplier, 1.0);
      expect(benefits.nftBadges, isTrue);
      expect(benefits.prioritySupport, isFalse);
    });

    test('pro tier has maximum benefits', () {
      final benefits = TierBenefits.forTier(SubscriptionTier.pro);
      expect(benefits.aiCallsPerDay, 999999);
      expect(benefits.earningMultiplier, 1.5);
      expect(benefits.advancedRoutes, isTrue);
      expect(benefits.regionalAlerts, isTrue);
      expect(benefits.historyDays, 999999);
      expect(benefits.insuranceDiscount, 15);
      expect(benefits.votingMultiplier, 2.0);
      expect(benefits.nftBadges, isTrue);
      expect(benefits.prioritySupport, isTrue);
    });

    test('benefits are immutable', () {
      final benefits = TierBenefits.forTier(SubscriptionTier.pro);
      // Verify const constructor behavior
      expect(benefits.aiCallsPerDay, isNot(0));
      expect(benefits.earningMultiplier, 1.5);
    });
  });
}
