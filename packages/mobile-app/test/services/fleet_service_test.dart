import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:mockito/annotations.dart';
import 'package:mockito/mockito.dart';
import 'package:gara_g_pilot/src/services/fleet_service.dart';

import 'fleet_service_test.mocks.dart';

@GenerateMocks([http.Client])
void main() {
  group('FleetService', () {
    const baseUrl = 'http://api.example.com';
    const orgId = 'org_123';
    late MockClient mockClient;
    late FleetService fleetService;

    setUp(() {
      mockClient = MockClient();
      fleetService = FleetService(
        baseUrl: baseUrl,
        organizationId: orgId,
        client: mockClient,
      );
    });

    test('listFleets returns data on 200', () async {
      final mockResponse = {
        'data': [
          {'id': '1', 'name': 'Fleet 1'}
        ],
        'total': 1
      };

      when(mockClient.get(any)).thenAnswer(
        (_) async => http.Response(json.encode(mockResponse), 200),
      );

      final result = await fleetService.listFleets();

      expect(result['data'][0]['name'], 'Fleet 1');
      verify(mockClient.get(argThat(predicate<Uri>((uri) =>
          uri.path == '/api/enterprise/fleets' &&
          uri.queryParameters['organizationId'] == orgId)))).called(1);
    });

    test('listFleets throws on error', () async {
      when(mockClient.get(any)).thenAnswer(
        (_) async => http.Response('Error', 404),
      );

      expect(() => fleetService.listFleets(), throwsException);
    });

    test('getFleetStats returns data on 200', () async {
      final mockResponse = {'activeFleets': 5};

      when(mockClient.get(any)).thenAnswer(
        (_) async => http.Response(json.encode(mockResponse), 200),
      );

      final result = await fleetService.getFleetStats();

      expect(result['activeFleets'], 5);
      verify(mockClient.get(argThat(predicate<Uri>((uri) =>
          uri.path == '/api/enterprise/fleets/stats' &&
          uri.queryParameters['organizationId'] == orgId)))).called(1);
    });

    test('createFleet sends correct data and returns 201', () async {
      final fleetData = {'name': 'New Fleet'};
      final mockResponse = {'id': '123', 'name': 'New Fleet'};

      when(mockClient.post(
        any,
        headers: anyNamed('headers'),
        body: anyNamed('body'),
        encoding: anyNamed('encoding'),
      )).thenAnswer(
        (_) async => http.Response(json.encode(mockResponse), 201),
      );

      final result = await fleetService.createFleet(fleetData);

      expect(result['id'], '123');
      verify(mockClient.post(
        any,
        headers: anyNamed('headers'),
        body: anyNamed('body'),
        encoding: anyNamed('encoding'),
      )).called(1);
    });
  });
}
