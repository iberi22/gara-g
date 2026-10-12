import 'package:flutter_test/flutter_test.dart';
import 'package:mockito/annotations.dart';
import 'package:mockito/mockito.dart';
import 'package:dio/dio.dart';
import 'package:gara_g_pilot/src/services/governance_service.dart';
import 'package:gara_g_pilot/src/services/api_client.dart';

import 'governance_service_test.mocks.dart';

@GenerateMocks([Dio])
void main() {
  group('GovernanceService', () {
    late MockDio mockDio;
    late GovernanceService governanceService;

    setUp(() {
      mockDio = MockDio();
      // Inject mock dio into the ApiClient singleton
      ApiClient().dio = mockDio;
      governanceService = GovernanceService();
    });

    test('getProposals returns list on 200', () async {
      final mockData = {
        'data': [
          {'id': 1, 'title': 'Proposal 1'}
        ]
      };

      when(mockDio.get(any)).thenAnswer(
        (_) async => Response(
          data: mockData,
          statusCode: 200,
          requestOptions: RequestOptions(path: ''),
        ),
      );

      final result = await governanceService.getProposals();

      expect(result.length, 1);
      expect(result[0]['title'], 'Proposal 1');
      verify(mockDio.get('/enterprise/governance/proposals')).called(1);
    });

    test('castVote returns true on 200', () async {
      when(mockDio.post(any, data: anyNamed('data'))).thenAnswer(
        (_) async => Response(
          data: {},
          statusCode: 200,
          requestOptions: RequestOptions(path: ''),
        ),
      );

      final result = await governanceService.castVote(1, true);

      expect(result, isTrue);
      verify(mockDio.post('/enterprise/governance/proposals/1/vote', data: {'support': true})).called(1);
    });
  });
}
