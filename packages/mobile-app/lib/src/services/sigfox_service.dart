import 'dart:convert';
import 'package:http/http.dart' as http;

/// Service for interacting with Sigfox IoT backend
class SigfoxService {
  final String baseUrl;
  final String organizationId;
  final http.Client _client;

  SigfoxService({
    this.baseUrl = 'https://gara-g.swal.network',
    this.organizationId = 'org_1',
    http.Client? client,
  }) : _client = client ?? http.Client();

  Future<bool> connect() async {
    return true;
  }

  Future<Map<String, dynamic>> sendTelemetry(int id, double lat, double lon) async {
    return {'status': 'sent', 'id': id, 'lat': lat, 'lon': lon};
  }

  /// List registered Sigfox devices
  Future<Map<String, dynamic>> listDevices() async {
    final uri = Uri.parse(
        '$baseUrl/api/sigfox/devices?organizationId=$organizationId');
    final response = await _client.get(uri);

    if (response.statusCode == 200) {
      return json.decode(response.body);
    } else {
      throw Exception('Failed to load Sigfox devices: ${response.statusCode}');
    }
  }

  /// Get recent Sigfox messages
  Future<Map<String, dynamic>> getRecentMessages({int limit = 50}) async {
    final uri = Uri.parse(
        '$baseUrl/api/sigfox/messages?organizationId=$organizationId&limit=$limit');
    final response = await _client.get(uri);

    if (response.statusCode == 200) {
      return json.decode(response.body);
    } else {
      throw Exception('Failed to load Sigfox messages: ${response.statusCode}');
    }
  }

  /// Register a new Sigfox device
  Future<Map<String, dynamic>> registerDevice({
    required String deviceId,
    required String vehicleId,
    String region = 'Rc1',
  }) async {
    final uri = Uri.parse('$baseUrl/api/sigfox/devices');
    final response = await _client.post(
      uri,
      headers: {'Content-Type': 'application/json'},
      body: json.encode({
        'deviceId': deviceId,
        'vehicleId': vehicleId,
        'region': region,
        'organizationId': organizationId,
      }),
    );

    if (response.statusCode == 201 || response.statusCode == 200) {
      return json.decode(response.body);
    } else {
      throw Exception('Failed to register device: ${response.statusCode}');
    }
  }

  /// Send a downlink command to a Sigfox device
  Future<Map<String, dynamic>> sendDownlink({
    required String deviceId,
    required String command,
    Map<String, dynamic>? params,
  }) async {
    final uri = Uri.parse('$baseUrl/api/sigfox/downlink');
    final response = await _client.post(
      uri,
      headers: {'Content-Type': 'application/json'},
      body: json.encode({
        'deviceId': deviceId,
        'command': command,
        'params': params ?? {},
        'organizationId': organizationId,
      }),
    );

    if (response.statusCode == 200) {
      return json.decode(response.body);
    } else {
      throw Exception('Failed to send downlink: ${response.statusCode}');
    }
  }

  void dispose() {
    _client.close();
  }
}
