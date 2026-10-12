import 'api_client.dart';

class GovernanceService {
  final ApiClient _apiClient = ApiClient();

  Future<List<Map<String, dynamic>>> getProposals() async {
    final response = await _apiClient.dio.get('/enterprise/governance/proposals');
    if (response.statusCode == 200) {
      return List<Map<String, dynamic>>.from(response.data['data']);
    }
    throw Exception('Failed to load proposals');
  }

  Future<bool> castVote(int proposalId, bool support) async {
    final response = await _apiClient.dio.post(
      '/enterprise/governance/proposals/$proposalId/vote',
      data: {'support': support},
    );
    return response.statusCode == 200;
  }
}
