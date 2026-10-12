import 'dart:convert';
import 'package:http/http.dart' as http;

class SubscriptionService {
  final String baseUrl;
  final String organizationId;

  SubscriptionService({required this.baseUrl, required this.organizationId});

  Future<Map<String, dynamic>> getSubscription() async {
    final uri = Uri.parse('$baseUrl/api/enterprise/subscription?organizationId=$organizationId');
    final response = await http.get(uri);

    if (response.statusCode == 200) {
      return json.decode(response.body);
    } else {
      throw Exception('Failed to load subscription');
    }
  }

  Future<Map<String, dynamic>> upgradePlan(String tier) async {
    final uri = Uri.parse('$baseUrl/api/enterprise/subscription');
    final response = await http.post(
      uri,
      headers: {'Content-Type': 'application/json'},
      body: json.encode({'organizationId': organizationId, 'tier': tier}),
    );

    if (response.statusCode == 200) {
      return json.decode(response.body);
    } else {
      throw Exception('Failed to upgrade plan');
    }
  }

  Future<Map<String, dynamic>> getPlans() async {
    final uri = Uri.parse('$baseUrl/api/enterprise/plans');
    final response = await http.get(uri);

    if (response.statusCode == 200) {
      return json.decode(response.body);
    } else {
      throw Exception('Failed to load plans');
    }
  }

  Future<List<dynamic>> getInvoices({String? status, int limit = 50}) async {
    final queryParams = {'organizationId': organizationId, 'limit': limit.toString()};
    if (status != null) queryParams['status'] = status;
    final uri = Uri.parse('$baseUrl/api/enterprise/invoices').replace(queryParameters: queryParams);
    try {
      final response = await http.get(uri);
      if (response.statusCode == 200) {
        final decoded = json.decode(response.body);
        if (decoded is List) return decoded;
        return decoded['data'] ?? [];
      }
    } catch (_) {}
    return [];
  }

  Future<List<dynamic>> getPaymentMethods() async {
    return [];
  }

  Future<void> setDefaultPaymentMethod(String id) async {}

  Future<Map<String, dynamic>> cancelSubscription() async {
    final uri = Uri.parse('$baseUrl/api/enterprise/subscription');
    final response = await http.delete(
      uri,
      headers: {'Content-Type': 'application/json'},
      body: json.encode({'organizationId': organizationId}),
    );

    if (response.statusCode == 200) {
      return json.decode(response.body);
    } else {
      throw Exception('Failed to cancel subscription');
    }
  }
}
