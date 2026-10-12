import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gara_g_pilot/src/screens/dashcam_screen.dart';
import 'package:provider/provider.dart';
import 'package:gara_g_pilot/src/providers/adas_provider.dart';
import 'package:gara_g_pilot/src/services/adas_service.dart';
import 'package:gara_g_pilot/src/services/ai_bridge.dart';

void main() {
  testWidgets('DashcamScreen renders placeholder when no camera', (WidgetTester tester) async {
    // We don't initialize Camera in this test environment
    await tester.pumpWidget(
      MultiProvider(
        providers: [
          Provider<AiBridge>(create: (_) => AiBridge()),
          Provider<AdasService>(create: (context) => AdasService(context.read<AiBridge>())),
          ChangeNotifierProvider(create: (context) => AdasProvider(context.read<AdasService>())),
        ],
        child: const MaterialApp(
          home: DashcamScreen(),
        ),
      ),
    );

    // Initial status message is "Initializing..."
    expect(find.text('Initializing...'), findsOneWidget);

    // It should NOT find "Dashcam Sentinel" yet because it's in the scaffold of the "error" state
    // but the error state is only reached after _checkPermissionsAndInitialize fails.
    // In initState, it starts as "Initializing..."
  });
}
