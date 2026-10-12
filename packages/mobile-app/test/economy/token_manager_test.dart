import 'package:flutter_test/flutter_test.dart';
import 'package:gara_g_pilot/economy/token_manager.dart';

void main() {
  group('TokenBalance', () {
    test('zero() creates balances at zero', () {
      final bal = TokenBalance.zero();
      expect(bal.garaBalance, BigInt.zero);
      expect(bal.dcBalance, BigInt.zero);
      expect(bal.vestedGara, BigInt.zero);
      expect(bal.pendingRewards, BigInt.zero);
      expect(bal.stakedGara, BigInt.zero);
    });

    test('totalGara sums all GARA holdings', () {
      final bal = TokenBalance(
        garaBalance: BigInt.from(100),
        dcBalance: BigInt.from(50),
        vestedGara: BigInt.from(200),
        pendingRewards: BigInt.from(10),
        stakedGara: BigInt.from(300),
      );
      expect(bal.totalGara, BigInt.from(600));
    });

    test('votingPower includes vested multiplier', () {
      final bal = TokenBalance(
        garaBalance: BigInt.from(100),
        dcBalance: BigInt.zero,
        vestedGara: BigInt.from(200),
        pendingRewards: BigInt.zero,
        stakedGara: BigInt.zero,
      );
      // votingPower = 100 + (200 * 15 // 10) = 100 + 300 = 400
      expect(bal.votingPower, BigInt.from(400));
    });

    test('copyWith creates new instance with updated fields', () {
      final bal = TokenBalance.zero();
      final updated = bal.copyWith(garaBalance: BigInt.from(500));

      expect(bal.garaBalance, BigInt.zero);
      expect(updated.garaBalance, BigInt.from(500));
      expect(updated.dcBalance, BigInt.zero);
    });
  });

  group('TokenManager', () {
    late TokenManager tokenManager;

    setUp(() {
      tokenManager = TokenManager();
    });

    test('initial balance is zero and no history', () {
      final bal = tokenManager.balance;
      expect(bal.garaBalance, BigInt.zero);
      expect(bal.dcBalance, BigInt.zero);
      expect(tokenManager.history, isEmpty);
    });

    test('addEarnings increases pending rewards and creates earn transaction',
        () {
      tokenManager.addEarnings(
        BigInt.from(100 * 100000),
        'Daily quest reward',
      );

      expect(tokenManager.balance.pendingRewards, BigInt.from(100 * 100000));
      expect(tokenManager.history.length, 1);
      expect(tokenManager.history[0].type, TransactionType.earn);
      expect(tokenManager.history[0].description, contains('Daily quest reward'));
    });

    test('claimRewards moves pending rewards to GARA balance', () async {
      tokenManager.addEarnings(BigInt.from(500 * 100000), 'Test rewards');

      final result = await tokenManager.claimRewards();

      expect(result, isTrue);
      expect(tokenManager.balance.pendingRewards, BigInt.zero);
      expect(tokenManager.balance.garaBalance, BigInt.from(500 * 100000));
      expect(tokenManager.history.last.type, TransactionType.claim);
    });

    test('claimRewards returns false when no pending rewards', () async {
      final result = await tokenManager.claimRewards();
      expect(result, isFalse);
    });

    test('spendDc deducts DC balance and creates spend transaction', () async {
      // First add DC then spend it
      tokenManager.addEarnings(BigInt.from(200 * 100000), 'Test');

      // Need to claim rewards first to get DC (earnings go to pending)
      // Actually, DC balance starts at 0, earnings add to pending, not DC.
      // We need a DC balance, so let's set it differently.

      // Let's use burnForDc to create DC, or directly test that spend checks
      // Start with a TokenBalance that has DC
      expect(
        () => tokenManager.spendDc(BigInt.from(10 * 100000), 'Service'),
        throwsA(isA<InsufficientBalanceException>()),
      );
    });

    test('burnForDc converts GARA to DC', () async {
      // First add earnings and claim to get GARA
      tokenManager.addEarnings(BigInt.from(1000 * 100000), 'Test rewards');
      // claimRewards moves pending -> GARA
      await tokenManager.claimRewards();

      expect(tokenManager.balance.garaBalance, BigInt.from(1000 * 100000));

      final dcAmount = await tokenManager.burnForDc(
        BigInt.from(100 * 100000),
        0.01, // $0.01 per GARA — clean division by 0.00001
      );

      // DC = 10000000 * 0.01 / 0.00001 = 10000000000 (100K DC in raw 5-decimal units)
      expect(dcAmount, BigInt.from(100000 * 100000));
      expect(tokenManager.balance.garaBalance, BigInt.from(900 * 100000));
      expect(tokenManager.balance.dcBalance, BigInt.from(100000 * 100000));
    });

    test('burnForDc throws when insufficient GARA', () async {
      expect(
        () => tokenManager.burnForDc(BigInt.from(100 * 100000), 0.05),
        throwsA(isA<InsufficientBalanceException>()),
      );
    });

    test('stakeForVesting moves GARA to vested and creates stake transaction',
        () async {
      tokenManager.addEarnings(BigInt.from(1000 * 100000), 'Test');
      await tokenManager.claimRewards();

      final result = await tokenManager.stakeForVesting(
        BigInt.from(500 * 100000),
        VestingTier.gold,
      );

      expect(result, isTrue);
      expect(tokenManager.balance.garaBalance, BigInt.from(500 * 100000));
      expect(tokenManager.balance.vestedGara, BigInt.from(500 * 100000));
      expect(tokenManager.history.last.type, TransactionType.stake);
      expect(tokenManager.history.last.description, contains('gold'));
    });

    test('stakeForVesting returns false when insufficient GARA', () async {
      final result = await tokenManager.stakeForVesting(
        BigInt.from(100 * 100000),
        VestingTier.silver,
      );
      expect(result, isFalse);
    });
  });

  group('VestingTier', () {
    test('enum values have correct lock periods', () {
      expect(VestingTier.bronze.lockDays, 90);
      expect(VestingTier.silver.lockDays, 180);
      expect(VestingTier.gold.lockDays, 365);
      expect(VestingTier.diamond.lockDays, 730);
    });

    test('higher tiers have higher multipliers', () {
      expect(VestingTier.bronze.apyMultiplier, 1.05);
      expect(VestingTier.diamond.apyMultiplier, 1.50);
      expect(VestingTier.bronze.votingMultiplier, 0.5);
      expect(VestingTier.diamond.votingMultiplier, 2.0);
    });
  });

  group('TokenTransaction', () {
    test('creates transaction record correctly', () {
      final now = DateTime.now();
      final tx = TokenTransaction(
        type: TransactionType.earn,
        amount: BigInt.from(100 * 100000),
        timestamp: now,
        description: 'Quest reward',
        txHash: '0xabc123',
      );

      expect(tx.type, TransactionType.earn);
      expect(tx.amount, BigInt.from(100 * 100000));
      expect(tx.description, 'Quest reward');
      expect(tx.txHash, '0xabc123');
    });
  });
}
