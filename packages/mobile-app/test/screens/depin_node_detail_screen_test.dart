import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gara_g_pilot/src/screens/depin_node_detail_screen.dart';
import 'package:gara_g_pilot/src/providers/depin_provider.dart';
import 'package:mockito/mockito.dart';
import 'package:provider/provider.dart';

class MockDepinProvider extends Mock implements DepinProvider {
  @override
  bool get isLoading => false;
  @override
  Map<String, dynamic>? get selectedNode => null;
  @override
  Future<void> loadNodeDetail(String nodeId) async {}

  @override
  void addListener(VoidCallback listener) {}
  @override
  void removeListener(VoidCallback listener) {}
}

void main() {
  testWidgets('DepinNodeDetailScreen shows node details', (WidgetTester tester) async {
    final mockProvider = MockDepinProvider();
    when(mockProvider.isLoading).thenReturn(false);
    when(mockProvider.selectedNode).thenReturn({
      'id': 'NODE-001',
      'status': 'online',
      'batteryLevel': 85.0,
      'signalStrength': -45,
      'peers': ['PEER-A', 'PEER-B'],
      'storageUsed': 124.5,
    });

    await tester.pumpWidget(
      ChangeNotifierProvider<DepinProvider>.value(
        value: mockProvider,
        child: const MaterialApp(
          home: DepinNodeDetailScreen(nodeId: 'NODE-001'),
        ),
      ),
    );

    expect(find.text('NODE-001'), findsOneWidget);
    expect(find.text('ONLINE'), findsOneWidget);
    expect(find.text('85%'), findsOneWidget);
    expect(find.text('PEER-A'), findsOneWidget);
    expect(find.text('REBOOT NODE'), findsOneWidget);
  });
}
