import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gara_g_pilot/src/screens/marketplace_screen.dart';
import 'package:mockito/mockito.dart';
import 'package:gara_g_pilot/src/services/marketplace_service.dart';

// Create a mock for the MarketplaceService
class MockMarketplaceService extends Mock implements MarketplaceService {}

void main() {
  group('MarketplaceScreen', () {
    late MockMarketplaceService mockMarketplaceService;

    setUp(() {
      mockMarketplaceService = MockMarketplaceService();
    });

    testWidgets('renders correctly', (WidgetTester tester) async {
      // Provide mock implementations for the service methods
      when(mockMarketplaceService.getEarnings()).thenAnswer((_) async => 10.0);

      // Build our app and trigger a frame.
      await tester.pumpWidget(MaterialApp(home: MarketplaceScreen()));

      // Verify that the title is rendered.
      expect(find.text('Data Marketplace'), findsOneWidget);

      // Verify that the earnings card is rendered.
      expect(find.text('Share My Data'), findsOneWidget);
    });
  });
}
