import 'dart:async';
import 'dart:convert';
import 'package:web_socket_channel/web_socket_channel.dart';
import 'package:dio/dio.dart';
import 'api_client.dart';

class DepinService {
  static final DepinService _instance = DepinService._internal();
  factory DepinService() => _instance;
  DepinService._internal();

  final Dio _dio = ApiClient().dio;
  WebSocketChannel? _channel;
  final _messageController = StreamController<Map<String, dynamic>>.broadcast();

  Stream<Map<String, dynamic>> get messages => _messageController.stream;

  // REST API Methods
  Future<List<Map<String, dynamic>>> getNodes() async {
    try {
      final response = await _dio.get('/depin/nodes');
      return List<Map<String, dynamic>>.from(response.data);
    } catch (e) {
      print('Error fetching nodes: $e');
      return [];
    }
  }

  Future<Map<String, dynamic>?> getNodeDetail(String nodeId) async {
    try {
      final response = await _dio.get('/depin/nodes/$nodeId');
      return response.data;
    } catch (e) {
      print('Error fetching node detail: $e');
      return null;
    }
  }

  Future<Map<String, dynamic>> getNetworkStats() async {
    try {
      final response = await _dio.get('/depin/network-stats');
      return response.data;
    } catch (e) {
      print('Error fetching network stats: $e');
      return {};
    }
  }

  Future<List<Map<String, dynamic>>> getFirmwareVersions() async {
    try {
      // Assuming endpoint exists or mocked
      final response = await _dio.get('/firmware/ota');
      return List<Map<String, dynamic>>.from(response.data);
    } catch (e) {
      print('Error fetching firmware: $e');
      // Fallback/Mock for now
      return [
        {
          'version': '1.2.4',
          'status': 'stable',
          'releaseDate': '2024-03-15',
          'critical': true
        }
      ];
    }
  }

  // WebSocket Methods
  void connect(String url) {
    _channel = WebSocketChannel.connect(Uri.parse(url));
    _channel!.stream.listen((message) {
      final data = jsonDecode(message);
      _messageController.add(data);
    }, onDone: () {
      print('WebSocket connection closed');
    }, onError: (error) {
      print('WebSocket error: $error');
    });
  }

  void sendMessage(Map<String, dynamic> data) {
    if (_channel != null) {
      _channel!.sink.add(jsonEncode(data));
    }
  }

  void disconnect() {
    _channel?.sink.close();
    _channel = null;
  }

  void dispose() {
    disconnect();
    _messageController.close();
  }
}
