import 'dart:convert';
import 'dart:io';
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';

class FleetService {
  final String baseUrl;
  final String organizationId;
  final http.Client _client;

  FleetService({
    required this.baseUrl,
    required this.organizationId,
    http.Client? client,
  }) : _client = client ?? http.Client();

  Future<File> _getCacheFile(String key) async {
    final directory = await getTemporaryDirectory();
    return File('${directory.path}/fleet_cache_$key.json');
  }

  Future<void> _writeCache(String key, Map<String, dynamic> data) async {
    try {
      final file = await _getCacheFile(key);
      await file.writeAsString(json.encode({
        'timestamp': DateTime.now().toIso8601String(),
        'data': data,
      }));
    } catch (e) {
      print('Cache write error: $e');
    }
  }

  Future<Map<String, dynamic>?> _readCache(String key) async {
    try {
      final file = await _getCacheFile(key);
      if (await file.exists()) {
        final content = await file.readAsString();
        return json.decode(content);
      }
    } catch (e) {
      print('Cache read error: $e');
    }
    return null;
  }

  Future<Map<String, dynamic>> listFleets({int page = 1, int limit = 20, String? status, String? search}) async {
    final queryParams = {
      'organizationId': organizationId,
      'page': page.toString(),
      'limit': limit.toString(),
    };
    if (status != null) queryParams['status'] = status;
    if (search != null) queryParams['search'] = search;

    final uri = Uri.parse('$baseUrl/api/enterprise/fleets').replace(queryParameters: queryParams);

    try {
      final response = await _client.get(uri);
      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        await _writeCache('list_fleets', data);
        return data;
      } else {
        throw Exception('Failed to load fleets: ${response.statusCode}');
      }
    } catch (e) {
      final cache = await _readCache('list_fleets');
      if (cache != null) return cache['data'];
      rethrow;
    }
  }

  Future<Map<String, dynamic>> getFleetStats() async {
    final uri = Uri.parse('$baseUrl/api/enterprise/fleets/stats?organizationId=$organizationId');

    try {
      final response = await _client.get(uri);
      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        await _writeCache('stats', data);
        return data;
      } else {
        throw Exception('Failed to load fleet stats: ${response.statusCode}');
      }
    } catch (e) {
      final cache = await _readCache('stats');
      if (cache != null) return cache['data'];
      rethrow;
    }
  }

  Future<Map<String, dynamic>> getAnalytics({String period = '30d'}) async {
    final uri = Uri.parse('$baseUrl/api/enterprise/analytics?organizationId=$organizationId&period=$period');

    try {
      final response = await _client.get(uri);
      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        await _writeCache('analytics', data);
        return data;
      } else {
        throw Exception('Failed to load analytics: ${response.statusCode}');
      }
    } catch (e) {
      final cache = await _readCache('analytics');
      if (cache != null) return cache['data'];
      rethrow;
    }
  }

  Future<Map<String, dynamic>> getMultiFleetDashboard() async {
    final stats = await getFleetStats();
    return {
      'data': {
        'kpis': stats['kpis'] ?? {
          'totalVehicles': stats['totalVehicles'] ?? 0,
          'activeRoutes': stats['activeRoutes'] ?? 0,
          'averageComplianceScore': stats['averageComplianceScore'] ?? 100,
          'totalMonthlyCost': stats['totalMonthlyCost'] ?? 0,
        },
        'roiAnalytics': stats['roiAnalytics'] ?? {
          'totalSavings': 0,
          'subscriptionCost': 0,
          'netROI': 0,
          'roiPercentage': 0,
        },
        'alerts': stats['alerts'] ?? [],
      }
    };
  }

  Future<Map<String, dynamic>> createFleet(Map<String, dynamic> fleetData) async {
    final uri = Uri.parse('$baseUrl/api/enterprise/fleets');
    final response = await _client.post(
      uri,
      headers: {'Content-Type': 'application/json'},
      body: json.encode({...fleetData, 'organizationId': organizationId}),
    );

    if (response.statusCode == 201) {
      return json.decode(response.body);
    } else {
      throw Exception('Failed to create fleet');
    }
  }
}
