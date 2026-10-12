import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gara_g_pilot/src/screens/chat_screen.dart';
import 'package:gara_g_pilot/src/providers/v2v_provider.dart';
import 'package:gara_g_pilot/src/services/v2v_service.dart';
import 'package:mockito/mockito.dart';
import 'package:mockito/annotations.dart';
import 'package:provider/provider.dart';

class MockV2VProvider extends Mock implements V2VProvider {
  @override
  List<V2VMessage> getMessages(String endpointId) => [];

  @override
  void markAsRead(String endpointId) {}

  @override
  void addListener(VoidCallback listener) {}
  @override
  void removeListener(VoidCallback listener) {}
}

void main() {
  final mockVehicle = NearbyVehicle(
    endpointId: 'test_id',
    deviceName: 'Test Vehicle',
    isConnected: true,
    discoveredAt: DateTime.now(),
  );

  testWidgets('ChatScreen renders empty state', (WidgetTester tester) async {
    final mockV2VProvider = MockV2VProvider();
    when(mockV2VProvider.getMessages('test_id')).thenReturn([]);

    await tester.pumpWidget(
      ChangeNotifierProvider<V2VProvider>.value(
        value: mockV2VProvider,
        child: MaterialApp(
          home: ChatScreen(vehicle: mockVehicle),
        ),
      ),
    );

    expect(find.text('Test Vehicle'), findsOneWidget);
    expect(find.text('Inicia la conversación'), findsOneWidget);
  });

  testWidgets('ChatScreen shows messages', (WidgetTester tester) async {
    final mockV2VProvider = MockV2VProvider();
    final messages = [
      V2VMessage(
        senderId: 'other',
        payload: 'Hello!',
        timestamp: DateTime.now(),
        isOutgoing: false,
        type: V2VMessageType.text,
      ),
      V2VMessage(
        senderId: 'me',
        payload: 'Hi there!',
        timestamp: DateTime.now(),
        isOutgoing: true,
        type: V2VMessageType.text,
      ),
    ];

    when(mockV2VProvider.getMessages('test_id')).thenReturn(messages);

    await tester.pumpWidget(
      ChangeNotifierProvider<V2VProvider>.value(
        value: mockV2VProvider,
        child: MaterialApp(
          home: ChatScreen(vehicle: mockVehicle),
        ),
      ),
    );

    expect(find.text('Hello!'), findsOneWidget);
    expect(find.text('Hi there!'), findsOneWidget);
  });
}
