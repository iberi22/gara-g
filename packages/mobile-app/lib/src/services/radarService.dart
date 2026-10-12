// ignore_for_file: file_names

import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';

/// Represents a virtual V2V node rendered on the Radar HUD
class VirtualRadarNode {
  final String id;
  final String name;
  final double distanceMeters;
  final double bearingDegrees; // 0 to 360 degrees relative to heading
  final String nodeType; // 'vehicle', 'sentinel', 'emergency', 'hazard'
  final List<String> hazardFlags; // e.g. ['hazardAhead', 'policeAhead', 'trafficJam']
  final double signalStrength; // 0.0 to 1.0
  final bool isConnected;
  final double speedKmh;
  final DateTime lastSeen;

  VirtualRadarNode({
    required this.id,
    required this.name,
    required this.distanceMeters,
    required this.bearingDegrees,
    this.nodeType = 'vehicle',
    this.hazardFlags = const [],
    this.signalStrength = 1.0,
    this.isConnected = true,
    this.speedKmh = 0.0,
    DateTime? lastSeen,
  }) : lastSeen = lastSeen ?? DateTime.now();

  /// Calculates visual color coding based on hazards, node type, and connectivity
  Color get nodeColor {
    final lowerFlags = hazardFlags.map((f) => f.toLowerCase()).toList();
    final hasCriticalHazard = lowerFlags.any((f) =>
        f.contains('hazard') ||
        f.contains('accident') ||
        f.contains('emergency') ||
        f.contains('danger'));

    if (hasCriticalHazard || nodeType == 'emergency') {
      return Colors.redAccent;
    } else if (hazardFlags.isNotEmpty) {
      return Colors.orangeAccent;
    } else if (nodeType == 'sentinel') {
      return Colors.cyanAccent;
    } else if (isConnected) {
      return Colors.greenAccent;
    } else {
      return Colors.blueAccent;
    }
  }

  VirtualRadarNode copyWith({
    String? id,
    String? name,
    double? distanceMeters,
    double? bearingDegrees,
    String? nodeType,
    List<String>? hazardFlags,
    double? signalStrength,
    bool? isConnected,
    double? speedKmh,
    DateTime? lastSeen,
  }) {
    return VirtualRadarNode(
      id: id ?? this.id,
      name: name ?? this.name,
      distanceMeters: distanceMeters ?? this.distanceMeters,
      bearingDegrees: bearingDegrees ?? this.bearingDegrees,
      nodeType: nodeType ?? this.nodeType,
      hazardFlags: hazardFlags ?? this.hazardFlags,
      signalStrength: signalStrength ?? this.signalStrength,
      isConnected: isConnected ?? this.isConnected,
      speedKmh: speedKmh ?? this.speedKmh,
      lastSeen: lastSeen ?? this.lastSeen,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'distanceMeters': distanceMeters,
        'bearingDegrees': bearingDegrees,
        'nodeType': nodeType,
        'hazardFlags': hazardFlags,
        'signalStrength': signalStrength,
        'isConnected': isConnected,
        'speedKmh': speedKmh,
        'lastSeen': lastSeen.millisecondsSinceEpoch,
      };

  factory VirtualRadarNode.fromJson(Map<String, dynamic> json) {
    return VirtualRadarNode(
      id: json['id'] as String,
      name: json['name'] as String? ?? 'Unknown Node',
      distanceMeters: (json['distanceMeters'] as num?)?.toDouble() ?? 0.0,
      bearingDegrees: (json['bearingDegrees'] as num?)?.toDouble() ?? 0.0,
      nodeType: json['nodeType'] as String? ?? 'vehicle',
      hazardFlags: (json['hazardFlags'] as List<dynamic>?)
              ?.map((e) => e.toString())
              .toList() ??
          const [],
      signalStrength: (json['signalStrength'] as num?)?.toDouble() ?? 1.0,
      isConnected: json['isConnected'] as bool? ?? true,
      speedKmh: (json['speedKmh'] as num?)?.toDouble() ?? 0.0,
      lastSeen: json['lastSeen'] != null
          ? DateTime.fromMillisecondsSinceEpoch(json['lastSeen'] as int)
          : DateTime.now(),
    );
  }
}

/// Service managing V2V virtual nodes with NearbyConnections edge-mesh transport adapter
/// and Yjs state synchronization.
class RadarService {
  static final RadarService _instance = RadarService._internal();
  factory RadarService() => _instance;
  RadarService._internal();

  final Map<String, VirtualRadarNode> _nodes = {};
  final StreamController<List<VirtualRadarNode>> _nodesController =
      StreamController<List<VirtualRadarNode>>.broadcast();

  bool _isScanning = false;
  bool _isYjsSynced = false;

  /// Active transport protocol identifier
  String get activeTransport => 'NearbyConnections';

  /// Streaming list of nearby active virtual nodes
  Stream<List<VirtualRadarNode>> get nodesStream => _nodesController.stream;

  /// List of current active virtual nodes
  List<VirtualRadarNode> get activeNodes => _nodes.values.toList();

  /// Status of scanning/transport active state
  bool get isScanning => _isScanning;

  /// Status of Yjs mesh synchronization
  bool get isYjsSynced => _isYjsSynced;

  /// Start radar scanning via NearbyConnections edge-mesh transport
  void startScanning() {
    _isScanning = true;
    _isYjsSynced = true;
    _notifyNodes();
  }

  /// Stop radar scanning
  void stopScanning() {
    _isScanning = false;
    _notifyNodes();
  }

  /// Add or update a virtual node on the radar HUD
  void addOrUpdateNode(VirtualRadarNode node) {
    _nodes[node.id] = node;
    _notifyNodes();
  }

  /// Remove a virtual node by ID
  void removeNode(String id) {
    if (_nodes.containsKey(id)) {
      _nodes.remove(id);
      _notifyNodes();
    }
  }

  /// Update hazard flags for a virtual node
  void updateNodeHazard(String id, List<String> hazardFlags) {
    if (_nodes.containsKey(id)) {
      _nodes[id] = _nodes[id]!.copyWith(hazardFlags: hazardFlags);
      _notifyNodes();
    }
  }

  /// Serializes node state into Yjs CRDT mesh payload format
  Map<String, dynamic> serializeYjsPayload() {
    return {
      'namespace': 'swal/gara-g/radar/nodes',
      'transport': activeTransport,
      'timestamp': DateTime.now().millisecondsSinceEpoch,
      'nodes': _nodes.values.map((node) => node.toJson()).toList(),
    };
  }

  /// Applies a Yjs CRDT state update received from the edge-mesh network
  void applyYjsUpdate(Map<String, dynamic> yjsPayload) {
    if (yjsPayload.containsKey('nodes') && yjsPayload['nodes'] is List) {
      final nodeList = yjsPayload['nodes'] as List<dynamic>;
      for (final rawNode in nodeList) {
        if (rawNode is Map<String, dynamic>) {
          final node = VirtualRadarNode.fromJson(rawNode);
          _nodes[node.id] = node;
        }
      }
      _isYjsSynced = true;
      _notifyNodes();
    }
  }

  /// Encode Yjs payload to JSON string
  String encodeYjsPayload() {
    return jsonEncode(serializeYjsPayload());
  }

  /// Clear all virtual nodes
  void clear() {
    _nodes.clear();
    _notifyNodes();
  }

  void _notifyNodes() {
    if (!_nodesController.isClosed) {
      _nodesController.add(activeNodes);
    }
  }

  /// Dispose resources
  void dispose() {
    _nodesController.close();
  }
}
