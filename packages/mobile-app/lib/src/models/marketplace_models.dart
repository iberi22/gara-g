/// Data package representing a batch of sold/pending telemetry data
class DataPackage {
  final String id;
  final String type; // 'telemetry', 'video', 'aggregate'
  final DateTime timestamp;
  final double earnedGara;
  final String status; // 'pending', 'sold', 'claimed'
  final int dataPoints;

  const DataPackage({
    required this.id,
    required this.type,
    required this.timestamp,
    required this.earnedGara,
    required this.status,
    required this.dataPoints,
  });

  Map<String, dynamic> toJson() => {
        'id': id,
        'type': type,
        'timestamp': timestamp.toIso8601String(),
        'earnedGara': earnedGara,
        'status': status,
        'dataPoints': dataPoints,
      };

  factory DataPackage.fromJson(Map<String, dynamic> json) => DataPackage(
        id: json['id'] as String,
        type: json['type'] as String,
        timestamp: DateTime.parse(json['timestamp'] as String),
        earnedGara: (json['earnedGara'] as num).toDouble(),
        status: json['status'] as String,
        dataPoints: json['dataPoints'] as int,
      );
}

/// Settings for marketplace participation
class MarketplaceSettings {
  final bool shareLocation;
  final bool shareTelemetry;
  final bool shareVideo;
  final bool shareRoadConditions;
  final double minimumPrice; // GARA per data unit

  const MarketplaceSettings({
    this.shareLocation = false,
    this.shareTelemetry = false,
    this.shareVideo = false,
    this.shareRoadConditions = false,
    this.minimumPrice = 0.01,
  });

  Map<String, dynamic> toJson() => {
        'shareLocation': shareLocation,
        'shareTelemetry': shareTelemetry,
        'shareVideo': shareVideo,
        'shareRoadConditions': shareRoadConditions,
        'minimumPrice': minimumPrice,
      };

  factory MarketplaceSettings.fromJson(Map<String, dynamic> json) =>
      MarketplaceSettings(
        shareLocation: json['shareLocation'] as bool? ?? false,
        shareTelemetry: json['shareTelemetry'] as bool? ?? false,
        shareVideo: json['shareVideo'] as bool? ?? false,
        shareRoadConditions: json['shareRoadConditions'] as bool? ?? false,
        minimumPrice: (json['minimumPrice'] as num?)?.toDouble() ?? 0.01,
      );

  MarketplaceSettings copyWith({
    bool? shareLocation,
    bool? shareTelemetry,
    bool? shareVideo,
    bool? shareRoadConditions,
    double? minimumPrice,
  }) =>
      MarketplaceSettings(
        shareLocation: shareLocation ?? this.shareLocation,
        shareTelemetry: shareTelemetry ?? this.shareTelemetry,
        shareVideo: shareVideo ?? this.shareVideo,
        shareRoadConditions: shareRoadConditions ?? this.shareRoadConditions,
        minimumPrice: minimumPrice ?? this.minimumPrice,
      );
}

/// Individual earning entry for history tracking
class EarningEntry {
  final DateTime timestamp;
  final double amount;
  final String type;
  final String status; // 'pending', 'claimed'

  const EarningEntry({
    required this.timestamp,
    required this.amount,
    required this.type,
    required this.status,
  });

  Map<String, dynamic> toJson() => {
        'timestamp': timestamp.toIso8601String(),
        'amount': amount,
        'type': type,
        'status': status,
      };

  factory EarningEntry.fromJson(Map<String, dynamic> json) => EarningEntry(
        timestamp: DateTime.parse(json['timestamp'] as String),
        amount: (json['amount'] as num).toDouble(),
        type: json['type'] as String,
        status: json['status'] as String,
      );
}

/// Complete earnings history with statistics
class EarningsHistory {
  final List<EarningEntry> entries;
  final double totalEarned;
  final double totalClaimed;

  const EarningsHistory({
    this.entries = const [],
    this.totalEarned = 0.0,
    this.totalClaimed = 0.0,
  });

  double get totalPending => totalEarned - totalClaimed;

  Map<String, dynamic> toJson() => {
        'entries': entries.map((e) => e.toJson()).toList(),
        'totalEarned': totalEarned,
        'totalClaimed': totalClaimed,
      };

  factory EarningsHistory.fromJson(Map<String, dynamic> json) =>
      EarningsHistory(
        entries: (json['entries'] as List<dynamic>?)
                ?.map((e) => EarningEntry.fromJson(e as Map<String, dynamic>))
                .toList() ??
            [],
        totalEarned: (json['totalEarned'] as num?)?.toDouble() ?? 0.0,
        totalClaimed: (json['totalClaimed'] as num?)?.toDouble() ?? 0.0,
      );
}
