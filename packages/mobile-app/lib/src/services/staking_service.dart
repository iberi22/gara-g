import 'api_client.dart';

class StakingService {
  final ApiClient _apiClient = ApiClient();

  Future<Map<String, dynamic>> getStakingData() async {
    final response = await _apiClient.dio.get('/enterprise/staking');
    if (response.statusCode == 200) {
      return response.data['data'];
    }
    throw Exception('Failed to load staking data');
  }

  Future<bool> stakeTokens(double amount, int lockDays) async {
    final response = await _apiClient.dio.post('/enterprise/staking', data: {
      'amount': amount,
      'lockDays': lockDays,
    });
    return response.statusCode == 200;
  }

  Future<bool> claimRewards() async {
    final response = await _apiClient.dio.post('/enterprise/staking/claim');
    return response.statusCode == 200;
  }
}
