import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gara_g_pilot/src/screens/home_screen.dart';
import 'package:provider/provider.dart';
import 'package:gara_g_pilot/src/providers/v2v_provider.dart';
import 'package:gara_g_pilot/src/providers/depin_provider.dart';
import 'package:gara_g_pilot/src/providers/mesh_provider.dart';
import 'package:gara_g_pilot/src/providers/ai_provider.dart';
import 'package:gara_g_pilot/src/services/ai_bridge.dart';
import 'package:gara_g_pilot/src/services/telemetry_service.dart';

void main() {
  testWidgets('HomeScreen renders correctly', (WidgetTester tester) async {
    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider(create: (_) => V2VProvider()),
          ChangeNotifierProvider(create: (_) => DepinProvider()),
          ChangeNotifierProvider(create: (_) => MeshProvider()),
          Provider<AiBridge>(create: (_) => AiBridge()),
          ChangeNotifierProvider(create: (context) => AiProvider(context.read<AiBridge>())),
          Provider<TelemetryService>(create: (_) => TelemetryService()),
        ],
        child: const MaterialApp(
          home: HomeScreen(),
        ),
      ),
    );

    // DashboardScreen title
    expect(find.text('Gara-G Pilot'), findsOneWidget);

    // Verify common navigation icons exist in the bottom nav bar
    expect(find.byIcon(Icons.dashboard), findsOneWidget);
    expect(find.byIcon(Icons.swap_horiz), findsOneWidget);

    // Settle any timers
    await tester.pump(const Duration(milliseconds: 100));
  });
}
