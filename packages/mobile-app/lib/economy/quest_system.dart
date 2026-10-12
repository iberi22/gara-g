/// Quest/Challenge system for gamified earning

import 'package:flutter/foundation.dart';
import 'package:gara_g_pilot/economy/token_manager.dart';

/// Quest categories
enum QuestCategory {
  daily,
  weekly,
  achievement,
  special,
}

/// Quest definition
class Quest {
  final String id;
  final String title;
  final String description;
  final QuestCategory category;
  final BigInt rewardDc;
  final int targetProgress;
  final int currentProgress;
  final DateTime? expiresAt;
  final bool completed;
  final bool claimed;

  const Quest({
    required this.id,
    required this.title,
    required this.description,
    required this.category,
    required this.rewardDc,
    required this.targetProgress,
    this.currentProgress = 0,
    this.expiresAt,
    this.completed = false,
    this.claimed = false,
  });

  double get progressPercent => currentProgress / targetProgress;
  bool get isExpired => expiresAt != null && DateTime.now().isAfter(expiresAt!);
  bool get canClaim => completed && !claimed && !isExpired;

  Quest copyWith({
    int? currentProgress,
    bool? completed,
    bool? claimed,
  }) => Quest(
    id: id,
    title: title,
    description: description,
    category: category,
    rewardDc: rewardDc,
    targetProgress: targetProgress,
    currentProgress: currentProgress ?? this.currentProgress,
    expiresAt: expiresAt,
    completed: completed ?? this.completed,
    claimed: claimed ?? this.claimed,
  );
}

/// Quest service
class QuestService extends ChangeNotifier {
  final List<Quest> _activeQuests = [];
  final List<Quest> _completedQuests = [];

  List<Quest> get activeQuests => List.unmodifiable(_activeQuests);
  List<Quest> get completedQuests => List.unmodifiable(_completedQuests);

  /// Load daily quests
  void loadDailyQuests() {
    _activeQuests.clear();

    // Daily quests
    _activeQuests.addAll([
      Quest(
        id: 'daily_checkin',
        title: 'Daily Check-in',
        description: 'Open the app and check in',
        category: QuestCategory.daily,
        rewardDc: BigInt.from(10 * 100000), // 10 DC
        targetProgress: 1,
        expiresAt: DateTime.now().add(const Duration(hours: 24)),
      ),
      Quest(
        id: 'daily_trips',
        title: 'Road Warrior',
        description: 'Complete 3 trips today',
        category: QuestCategory.daily,
        rewardDc: BigInt.from(20 * 100000), // 20 DC
        targetProgress: 3,
        expiresAt: DateTime.now().add(const Duration(hours: 24)),
      ),
      Quest(
        id: 'daily_share',
        title: 'Data Sharer',
        description: 'Share telemetry for 30 minutes',
        category: QuestCategory.daily,
        rewardDc: BigInt.from(15 * 100000), // 15 DC
        targetProgress: 30,
        expiresAt: DateTime.now().add(const Duration(hours: 24)),
      ),
    ]);

    notifyListeners();
  }

  /// Load weekly quests
  void loadWeeklyQuests() {
    _activeQuests.addAll([
      Quest(
        id: 'weekly_distance',
        title: 'Long Hauler',
        description: 'Drive 500 km this week',
        category: QuestCategory.weekly,
        rewardDc: BigInt.from(100 * 100000), // 100 DC
        targetProgress: 500,
        expiresAt: _nextSunday(),
      ),
      Quest(
        id: 'weekly_coverage',
        title: 'Explorer',
        description: 'Cover 10 new hexes this week',
        category: QuestCategory.weekly,
        rewardDc: BigInt.from(150 * 100000), // 150 DC
        targetProgress: 10,
        expiresAt: _nextSunday(),
      ),
      Quest(
        id: 'weekly_verify',
        title: 'Community Helper',
        description: 'Verify 5 incident reports',
        category: QuestCategory.weekly,
        rewardDc: BigInt.from(75 * 100000), // 75 DC
        targetProgress: 5,
        expiresAt: _nextSunday(),
      ),
    ]);

    notifyListeners();
  }

  DateTime _nextSunday() {
    final now = DateTime.now();
    final daysUntilSunday = DateTime.sunday - now.weekday;
    return DateTime(now.year, now.month, now.day + daysUntilSunday + 7);
  }

  /// Update quest progress
  void updateProgress(String questId, int progress) {
    final index = _activeQuests.indexWhere((q) => q.id == questId);
    if (index == -1) return;

    final quest = _activeQuests[index];
    final newProgress = (quest.currentProgress + progress)
        .clamp(0, quest.targetProgress);
    final completed = newProgress >= quest.targetProgress;

    _activeQuests[index] = quest.copyWith(
      currentProgress: newProgress,
      completed: completed,
    );

    notifyListeners();
  }

  /// Claim quest reward
  Future<BigInt?> claimReward(String questId, TokenManager tokenManager) async {
    final index = _activeQuests.indexWhere((q) => q.id == questId);
    if (index == -1) return null;

    final quest = _activeQuests[index];
    if (!quest.canClaim) return null;

    // Add to token manager
    tokenManager.addEarnings(quest.rewardDc, 'Quest: ${quest.title}');

    // Mark as claimed
    _activeQuests[index] = quest.copyWith(claimed: true);
    _completedQuests.add(_activeQuests[index]);
    _activeQuests.removeAt(index);

    notifyListeners();
    return quest.rewardDc;
  }
}
