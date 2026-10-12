import 'package:hive_flutter/hive_flutter.dart';

/// Schedule model for marketplace opt-in active window
class OptInScheduleConfig {
  final int startHour;
  final int endHour;
  final List<int> daysOfWeek; // 0=Sunday, 1=Monday... 6=Saturday

  const OptInScheduleConfig({
    this.startHour = 0,
    this.endHour = 24,
    this.daysOfWeek = const [0, 1, 2, 3, 4, 5, 6],
  });

  Map<String, dynamic> toJson() => {
        'startHour': startHour,
        'endHour': endHour,
        'daysOfWeek': daysOfWeek,
      };

  factory OptInScheduleConfig.fromJson(Map<String, dynamic> json) {
    return OptInScheduleConfig(
      startHour: json['startHour'] as int? ?? 0,
      endHour: json['endHour'] as int? ?? 24,
      daysOfWeek: (json['daysOfWeek'] as List<dynamic>?)
              ?.map((e) => e as int)
              .toList() ??
          const [0, 1, 2, 3, 4, 5, 6],
    );
  }
}

/// Comprehensive user configuration for Marketplace Opt-In
class ExtendedOptInPreferences {
  final bool enabled;
  final List<String> categories;
  final double minPayoutGara;
  final double maxDistanceKm;
  final OptInScheduleConfig schedule;

  const ExtendedOptInPreferences({
    this.enabled = true,
    this.categories = const [
      'telemetry',
      'traffic_density',
      'road_hazards',
      'new_listings',
      'deals'
    ],
    this.minPayoutGara = 10.0,
    this.maxDistanceKm = 50.0,
    this.schedule = const OptInScheduleConfig(),
  });

  Map<String, dynamic> toJson() => {
        'enabled': enabled,
        'categories': categories,
        'minPayoutGara': minPayoutGara,
        'maxDistanceKm': maxDistanceKm,
        'schedule': schedule.toJson(),
      };

  factory ExtendedOptInPreferences.fromJson(Map<String, dynamic> json) {
    return ExtendedOptInPreferences(
      enabled: json['enabled'] as bool? ?? true,
      categories: (json['categories'] as List<dynamic>?)
              ?.map((e) => e as String)
              .toList() ??
          const [
            'telemetry',
            'traffic_density',
            'road_hazards',
            'new_listings',
            'deals'
          ],
      minPayoutGara: (json['minPayoutGara'] as num?)?.toDouble() ?? 10.0,
      maxDistanceKm: (json['maxDistanceKm'] as num?)?.toDouble() ?? 50.0,
      schedule: json['schedule'] != null
          ? OptInScheduleConfig.fromJson(
              Map<String, dynamic>.from(json['schedule'] as Map))
          : const OptInScheduleConfig(),
    );
  }

  ExtendedOptInPreferences copyWith({
    bool? enabled,
    List<String>? categories,
    double? minPayoutGara,
    double? maxDistanceKm,
    OptInScheduleConfig? schedule,
  }) {
    return ExtendedOptInPreferences(
      enabled: enabled ?? this.enabled,
      categories: categories ?? this.categories,
      minPayoutGara: minPayoutGara ?? this.minPayoutGara,
      maxDistanceKm: maxDistanceKm ?? this.maxDistanceKm,
      schedule: schedule ?? this.schedule,
    );
  }
}

/// Service managing marketplace opt-in preferences and offer filtering in Flutter
class OptInService {
  static final OptInService _instance = OptInService._();
  factory OptInService() => _instance;
  OptInService._();

  static const String _boxName = 'marketplace_opt_in_prefs';
  Box<dynamic>? _box;

  Future<void> initialize() async {
    _box = await Hive.openBox(_boxName);
  }

  Future<ExtendedOptInPreferences> getPreferences() async {
    await _ensureInitialized();
    final data = _box!.get('preferences');
    if (data == null) {
      return const ExtendedOptInPreferences();
    }
    return ExtendedOptInPreferences.fromJson(
        Map<String, dynamic>.from(data as Map));
  }

  Future<void> savePreferences(ExtendedOptInPreferences prefs) async {
    await _ensureInitialized();
    await _box!.put('preferences', prefs.toJson());
  }

  Future<void> setEnabled(bool enabled) async {
    final current = await getPreferences();
    await savePreferences(current.copyWith(enabled: enabled));
  }

  /// Check if a marketplace offer matches the user's opt-in preferences and schedule
  Future<bool> isOfferMatching({
    required String category,
    required double payoutGara,
    required double distanceKm,
    DateTime? now,
  }) async {
    final prefs = await getPreferences();
    if (!prefs.enabled) return false;

    if (!prefs.categories.contains(category)) return false;
    if (payoutGara < prefs.minPayoutGara) return false;
    if (distanceKm > prefs.maxDistanceKm) return false;

    final currentTime = now ?? DateTime.now();
    final dayOfWeek = currentTime.weekday == 7 ? 0 : currentTime.weekday; // 0=Sunday
    final hour = currentTime.hour;

    if (!prefs.schedule.daysOfWeek.contains(dayOfWeek)) return false;

    if (prefs.schedule.startHour <= prefs.schedule.endHour) {
      if (hour < prefs.schedule.startHour || hour >= prefs.schedule.endHour) {
        return false;
      }
    } else {
      if (hour < prefs.schedule.startHour && hour >= prefs.schedule.endHour) {
        return false;
      }
    }

    return true;
  }

  Future<void> _ensureInitialized() async {
    if (_box == null) {
      await initialize();
    }
  }
}
