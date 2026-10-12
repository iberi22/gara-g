import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:mockito/annotations.dart';
import 'package:mockito/mockito.dart';
import 'package:gara_g_pilot/src/services/blockchain_service.dart';

import 'blockchain_service_test.mocks.dart';

@GenerateMocks([http.Client])
void main() {
  group('BlockchainService', () {
    late MockClient mockClient;
    late BlockchainService blockchainService;

    setUp(() {
      mockClient = MockClient();
      blockchainService = BlockchainService(client: mockClient);
    });

    test('submitRewardProof returns true on 200', () async {
      when(mockClient.post(
        any,
        headers: anyNamed('headers'),
        body: any,
        encoding: anyNamed('encoding'),
      )).thenAnswer(
        (_) async => http.Response('{"success": true}', 200),
      );

      final result = await blockchainService.submitRewardProof('[{"reward": 10}]');

      expect(result, isTrue);
      verify(mockClient.post(
        any,
        headers: {'Content-Type': 'application/json'},
        body: any,
      )).called(1);
    });

    test('submitRewardProof returns false on error', () async {
      when(mockClient.post(
        any,
        headers: anyNamed('headers'),
        body: any,
        encoding: anyNamed('encoding'),
      )).thenAnswer(
        (_) async => http.Response('Error', 500),
      );

      final result = await blockchainService.submitRewardProof('[{"reward": 10}]');

      expect(result, isFalse);
    });

    test('submitRewardProof returns true for empty reward', () async {
      final result = await blockchainService.submitRewardProof('[]');
      expect(result, isTrue);
    });
  });
}
