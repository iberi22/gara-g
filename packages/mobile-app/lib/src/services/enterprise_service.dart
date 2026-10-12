import 'api_client.dart';

class EnterpriseService {
  final ApiClient _apiClient = ApiClient();

  Future<List<Map<String, dynamic>>> getExchangePrices() async {
    final response = await _apiClient.dio.get('/enterprise/exchange/prices');
    if (response.statusCode == 200) {
      return List<Map<String, dynamic>>.from(response.data['data']);
    }
    throw Exception('Failed to load exchange prices');
  }

  Future<List<Map<String, dynamic>>> getLiquidityPools() async {
    final response = await _apiClient.dio.get('/enterprise/liquidity/pools');
    if (response.statusCode == 200) {
      return List<Map<String, dynamic>>.from(response.data['data']);
    }
    throw Exception('Failed to load liquidity pools');
  }

  Future<List<Map<String, dynamic>>> getVestingSchedules() async {
    final response = await _apiClient.dio.get('/enterprise/vesting/schedules');
    if (response.statusCode == 200) {
      return List<Map<String, dynamic>>.from(response.data['data']);
    }
    throw Exception('Failed to load vesting schedules');
  }

  Future<Map<String, dynamic>> getEarningStats() async {
    // Reusing gamification or custom enterprise stats
    final response = await _apiClient.dio.get('/gamification/points/me');
    return response.data['data'];
  }
}
