/// Token Manager for in-app economy
/// Handles earning, spending, and balance tracking

import 'package:flutter/foundation.dart';

/// User's token balances
class TokenBalance {
  /// Liquid GARA tokens (can spend or stake)
  final BigInt garaBalance;

  /// Data Credits (USD-pegged, non-transferable)
  final BigInt dcBalance;

  /// Vested GARA (locked, earns voting power)
  final BigInt vestedGara;

  /// Pending rewards (claimable)
  final BigInt pendingRewards;

  /// Staked GARA (in validator/governance)
  final BigInt stakedGara;

  const TokenBalance({
    required this.garaBalance,
    required this.dcBalance,
    required this.vestedGara,
    required this.pendingRewards,
    required this.stakedGara,
  });

  /// Total GARA holdings
  BigInt get totalGara => garaBalance + vestedGara + stakedGara;

  /// Voting power (vested gives multiplier)
  BigInt get votingPower {
    // Vested tokens get 1.5x-2x voting power based on tier
    return garaBalance + (vestedGara * BigInt.from(15) ~/ BigInt.from(10));
  }

  factory TokenBalance.zero() => TokenBalance(
    garaBalance: BigInt.zero,
    dcBalance: BigInt.zero,
    vestedGara: BigInt.zero,
    pendingRewards: BigInt.zero,
    stakedGara: BigInt.zero,
  );

  TokenBalance copyWith({
    BigInt? garaBalance,
    BigInt? dcBalance,
    BigInt? vestedGara,
    BigInt? pendingRewards,
    BigInt? stakedGara,
  }) => TokenBalance(
    garaBalance: garaBalance ?? this.garaBalance,
    dcBalance: dcBalance ?? this.dcBalance,
    vestedGara: vestedGara ?? this.vestedGara,
    pendingRewards: pendingRewards ?? this.pendingRewards,
    stakedGara: stakedGara ?? this.stakedGara,
  );
}

/// Token manager service
class TokenManager extends ChangeNotifier {
  TokenBalance _balance = TokenBalance.zero();
  final List<TokenTransaction> _history = [];

  TokenBalance get balance => _balance;
  List<TokenTransaction> get history => List.unmodifiable(_history);

  /// Claim pending rewards
  Future<bool> claimRewards() async {
    if (_balance.pendingRewards <= BigInt.zero) return false;

    // Call chain to claim
    final claimed = _balance.pendingRewards;
    _balance = _balance.copyWith(
      garaBalance: _balance.garaBalance + claimed,
      pendingRewards: BigInt.zero,
    );

    _history.add(TokenTransaction(
      type: TransactionType.claim,
      amount: claimed,
      timestamp: DateTime.now(),
      description: 'Claimed pending rewards',
    ));

    notifyListeners();
    return true;
  }

  /// Burn GARA to create DC
  Future<BigInt> burnForDc(BigInt garaAmount, double garaPrice) async {
    if (_balance.garaBalance < garaAmount) {
      throw InsufficientBalanceException('Not enough GARA');
    }

    // DC = GARA * price / 0.00001 (DC is $0.00001)
    final dcAmount = BigInt.from(
      (garaAmount.toDouble() * garaPrice / 0.00001).floor()
    );

    _balance = _balance.copyWith(
      garaBalance: _balance.garaBalance - garaAmount,
      dcBalance: _balance.dcBalance + dcAmount,
    );

    _history.add(TokenTransaction(
      type: TransactionType.burn,
      amount: garaAmount,
      timestamp: DateTime.now(),
      description: 'Burned GARA for $dcAmount DC',
    ));

    notifyListeners();
    return dcAmount;
  }

  /// Spend DC on a service
  Future<bool> spendDc(BigInt amount, String service) async {
    if (_balance.dcBalance < amount) {
      throw InsufficientBalanceException('Not enough DC');
    }

    _balance = _balance.copyWith(
      dcBalance: _balance.dcBalance - amount,
    );

    _history.add(TokenTransaction(
      type: TransactionType.spend,
      amount: amount,
      timestamp: DateTime.now(),
      description: 'Used $service',
    ));

    notifyListeners();
    return true;
  }

  /// Stake GARA for vesting
  Future<bool> stakeForVesting(BigInt amount, VestingTier tier) async {
    if (_balance.garaBalance < amount) return false;

    _balance = _balance.copyWith(
      garaBalance: _balance.garaBalance - amount,
      vestedGara: _balance.vestedGara + amount,
    );

    _history.add(TokenTransaction(
      type: TransactionType.stake,
      amount: amount,
      timestamp: DateTime.now(),
      description: 'Staked in ${tier.name} tier',
    ));

    notifyListeners();
    return true;
  }

  /// Add earned tokens
  void addEarnings(BigInt amount, String source) {
    _balance = _balance.copyWith(
      pendingRewards: _balance.pendingRewards + amount,
    );

    _history.add(TokenTransaction(
      type: TransactionType.earn,
      amount: amount,
      timestamp: DateTime.now(),
      description: 'Earned from $source',
    ));

    notifyListeners();
  }
}

/// Transaction types
enum TransactionType {
  earn,
  spend,
  burn,
  stake,
  unstake,
  claim,
  transfer,
  referral,
}

/// Transaction record
class TokenTransaction {
  final TransactionType type;
  final BigInt amount;
  final DateTime timestamp;
  final String description;
  final String? txHash;

  const TokenTransaction({
    required this.type,
    required this.amount,
    required this.timestamp,
    required this.description,
    this.txHash,
  });
}

/// Vesting tier options
enum VestingTier {
  bronze(90, 1.05, 0.5),
  silver(180, 1.15, 1.0),
  gold(365, 1.30, 1.5),
  diamond(730, 1.50, 2.0);

  final int lockDays;
  final double apyMultiplier;
  final double votingMultiplier;

  const VestingTier(this.lockDays, this.apyMultiplier, this.votingMultiplier);
}

class InsufficientBalanceException implements Exception {
  final String message;
  InsufficientBalanceException(this.message);
}
