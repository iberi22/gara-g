import 'package:flutter_test/flutter_test.dart';
import 'package:gara_g_pilot/economy/quest_system.dart';
import 'package:gara_g_pilot/economy/token_manager.dart';

void main() {
  group('Quest', () {
    test('progressPercent returns correct ratio', () {
      final quest = Quest(
        id: 'test_quest',
        title: 'Test Quest',
        description: 'A test quest',
        category: QuestCategory.daily,
        rewardDc: BigInt.from(10 * 100000),
        targetProgress: 5,
        currentProgress: 2,
      );

      expect(quest.progressPercent, closeTo(0.4, 0.001));
    });

    test('canClaim only true when completed and not claimed and not expired', () {
      final active = Quest(
        id: 'test',
        title: 'Test',
        description: 'Test',
        category: QuestCategory.daily,
        rewardDc: BigInt.from(10 * 100000),
        targetProgress: 1,
        currentProgress: 1,
        completed: true,
        claimed: false,
      );
      expect(active.canClaim, isTrue);

      final claimed = active.copyWith(claimed: true);
      expect(claimed.canClaim, isFalse);

      final notCompleted = active.copyWith(completed: false, claimed: false);
      expect(notCompleted.canClaim, isFalse);
    });

    test('copyWith creates modified quest without mutating original', () {
      final original = Quest(
        id: 'test',
        title: 'Test',
        description: 'Test',
        category: QuestCategory.daily,
        rewardDc: BigInt.from(10 * 100000),
        targetProgress: 5,
        currentProgress: 2,
      );

      final updated = original.copyWith(currentProgress: 5, completed: true);

      expect(original.currentProgress, 2);
      expect(original.completed, isFalse);
      expect(updated.currentProgress, 5);
      expect(updated.completed, isTrue);
      expect(updated.id, original.id);
    });

    test('isExpired returns true when expiry date is past', () {
      final past = Quest(
        id: 'expired',
        title: 'Expired',
        description: 'Expired quest',
        category: QuestCategory.daily,
        rewardDc: BigInt.from(10 * 100000),
        targetProgress: 1,
        expiresAt: DateTime.now().subtract(const Duration(days: 1)),
      );
      expect(past.isExpired, isTrue);
    });
  });

  group('QuestService', () {
    late QuestService questService;

    setUp(() {
      questService = QuestService();
    });

    test('loadDailyQuests populates active quests and notifies listeners', () {
      int notifyCount = 0;
      questService.addListener(() => notifyCount++);

      questService.loadDailyQuests();

      expect(questService.activeQuests.length, 3);
      expect(questService.activeQuests[0].category, QuestCategory.daily);
      expect(notifyCount, greaterThanOrEqualTo(1));
    });

    test('updateProgress increments quest progress and marks completed', () {
      questService.loadDailyQuests();

      // The daily check-in quest has targetProgress=1, start at 0
      questService.updateProgress('daily_checkin', 1);

      final quest = questService.activeQuests.firstWhere(
        (q) => q.id == 'daily_checkin',
      );
      expect(quest.currentProgress, 1);
      expect(quest.completed, isTrue);
    });

    test('updateProgress clamps progress to targetProgress', () {
      questService.loadDailyQuests();

      questService.updateProgress('daily_trips', 10); // target is 3

      final quest = questService.activeQuests.firstWhere(
        (q) => q.id == 'daily_trips',
      );
      expect(quest.currentProgress, 3);
      expect(quest.completed, isTrue);
    });

    test('updateProgress with unknown questId does nothing', () {
      questService.loadDailyQuests();
      questService.updateProgress('nonexistent', 5);

      expect(questService.activeQuests.length, 3);
    });

    test('claimReward adds tokens and moves quest to completed list', () async {
      questService.loadDailyQuests();
      questService.updateProgress('daily_checkin', 1);

      final tokenManager = TokenManager();
      final reward = await questService.claimReward(
        'daily_checkin',
        tokenManager,
      );

      expect(reward, BigInt.from(10 * 100000));
      expect(tokenManager.balance.pendingRewards, BigInt.from(10 * 100000));
      expect(questService.completedQuests.length, 1);
      expect(questService.completedQuests[0].claimed, isTrue);

      // Quest removed from active
      expect(
        questService.activeQuests.where((q) => q.id == 'daily_checkin').length,
        0,
      );
    });

    test('claimReward returns null for incomplete quest', () async {
      questService.loadDailyQuests();

      final tokenManager = TokenManager();
      final reward = await questService.claimReward(
        'daily_checkin', // not completed yet
        tokenManager,
      );

      expect(reward, isNull);
      expect(tokenManager.balance.pendingRewards, BigInt.zero);
    });

    test('claimReward returns null for already claimed quest', () async {
      questService.loadDailyQuests();
      questService.updateProgress('daily_checkin', 1);

      final tokenManager = TokenManager();
      await questService.claimReward('daily_checkin', tokenManager);

      // Try claiming again
      final secondReward = await questService.claimReward(
        'daily_checkin',
        tokenManager,
      );

      expect(secondReward, isNull);
    });

    test('claimReward with unknown questId returns null', () async {
      final tokenManager = TokenManager();
      final reward = await questService.claimReward(
        'nonexistent',
        tokenManager,
      );
      expect(reward, isNull);
    });

    test('loadWeeklyQuests adds weekly quests to active list', () {
      questService.loadDailyQuests();
      questService.loadWeeklyQuests();

      expect(questService.activeQuests.length, 6);
      final weeklyQuests = questService.activeQuests
          .where((q) => q.category == QuestCategory.weekly);
      expect(weeklyQuests.length, 3);
    });
  });
}
