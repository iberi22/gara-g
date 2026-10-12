import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gara_g_pilot/src/screens/depin_nodes_screen.dart';
import 'package:gara_g_pilot/src/providers/depin_provider.dart';
import 'package:mockito/mockito.dart';
import 'package:provider/provider.dart';

class MockDepinProvider extends Mock implements DepinProvider {
  @override
  bool get isLoading => false;
  @override
  List<Map<String, dynamic>> get nodes => [];
  @override
  Future<void> loadNodes() async {}

  @override
  void addListener(VoidCallback listener) {}
  @override
  void removeListener(VoidCallback listener) {}
}

void main() {
  testWidgets('DepinNodesScreen shows loading state', (WidgetTester tester) async {
    final mockProvider = MockDepinProvider();
    when(mockProvider.isLoading).thenReturn(true);

    await tester.pumpWidget(
      ChangeNotifierProvider<DepinProvider>.value(
        value: mockProvider,
        child: const MaterialApp(home: DepinNodesScreen()),
      ),
    );

    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });

  testWidgets('DepinNodesScreen shows empty state', (WidgetTester tester) async {
    final mockProvider = MockDepinProvider();
    when(mockProvider.isLoading).thenReturn(false);
    when(mockProvider.nodes).thenReturn([]);

    await tester.pumpWidget(
      ChangeNotifierProvider<DepinProvider>.value(
        value: mockProvider,
        child: const MaterialApp(home: DepinNodesScreen()),
      ),
    );

    expect(find.text('No nodes found'), findsOneWidget);
  });

  testWidgets('DepinNodesScreen shows node list', (WidgetTester tester) async {
    final mockProvider = MockDepinProvider();
    when(mockProvider.isLoading).thenReturn(false);
    when(mockProvider.nodes).thenReturn([
      {'id': 'NODE-001', 'type': 'Gateway', 'status': 'online'},
      {'id': 'NODE-002', 'type': 'Relay', 'status': 'offline'},
    ]);

    await tester.pumpWidget(
      ChangeNotifierProvider<DepinProvider>.value(
        value: mockProvider,
        child: const MaterialApp(home: DepinNodesScreen()),
      ),
    );

    expect(find.text('NODE-001'), findsOneWidget);
    expect(find.text('NODE-002'), findsOneWidget);
  });
}
