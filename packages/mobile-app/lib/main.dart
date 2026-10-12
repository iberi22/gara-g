import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:hive_flutter/hive_flutter.dart';
import 'package:gara_g_pilot/src/rust/api.dart';
import 'package:path_provider/path_provider.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'dart:math';
import 'package:gara_g_pilot/src/rust/frb_generated.dart';
import 'package:gara_g_pilot/src/app_router.dart';
import 'package:gara_g_pilot/src/providers/appProvider.dart';
import 'package:gara_g_pilot/src/providers/v2v_provider.dart';
import 'package:gara_g_pilot/src/providers/depin_provider.dart';
import 'package:gara_g_pilot/src/providers/mesh_provider.dart';
import 'package:gara_g_pilot/src/providers/ai_provider.dart';
import 'package:gara_g_pilot/src/providers/adas_provider.dart';
import 'package:gara_g_pilot/src/services/ai_bridge.dart';
import 'package:gara_g_pilot/src/services/adas_service.dart';
import 'package:gara_g_pilot/src/services/telemetry_service.dart';
import 'package:gara_g_pilot/src/services/background_service.dart';
import 'package:gara_g_pilot/src/services/activity_recognition_service.dart';
import 'package:gara_g_pilot/src/services/trip_service.dart';
import 'package:gara_g_pilot/src/services/sync_manager.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Initialize Hive for local storage
  await Hive.initFlutter();

  // Initialize Rust bridge
  await RustLib.init();

  // Initialize Background Service
  await initializeBackgroundService();

  // Initialize Native Video Recorder with app directory
  final appDir = await getApplicationDocumentsDirectory();
  await initRecorder(appDir: appDir.path);

  // Initialize Encrypted Database / Vault
  //
  // La clave va en flutter_secure_storage (Keystore en Android, Keychain en
  // iOS), generada en el primer arranque. Antes era una constante en el APK
  // ("000102...1f"), con lo que cualquiera que descargase el APK descifraba la
  // base de datos de telemetría completa de cualquier dispositivo.
  final encryptionKey = await _resolveVaultKey();
  await initDatabase(appDir: appDir.path, encryptionKey: encryptionKey);

  // Initialize AppProvider & setup EdgeMesh, Xavier NS (:8006), Encrypted Vault
  final appProvider = AppProvider();
  appProvider.setEdgeMeshStatus(connected: true, nodeId: 'edge-mesh-mobile-01');
  appProvider.setXavierStatus(connected: true, endpoint: 'http://localhost:8006');
  appProvider.setVaultStatus(initialized: true, recordCount: 0);

  final meshProvider = MeshProvider();
  await meshProvider.start();

  // Start Telemetry
  final telemetryService = TelemetryService();
  telemetryService.startMonitoring();

  // Start Activity Recognition and Trip Services
  final activityRecognitionService = ActivityRecognitionService();
  final tripService = TripService(activityRecognitionService);
  tripService.start();

  // Start Sync Manager
  SyncManager().start();

  runApp(GaraGApp(
    appProvider: appProvider,
    telemetryService: telemetryService,
    activityRecognitionService: activityRecognitionService,
    tripService: tripService,
  ));
}

class GaraGApp extends StatelessWidget {
  final AppProvider appProvider;
  final TelemetryService telemetryService;
  final ActivityRecognitionService activityRecognitionService;
  final TripService tripService;

  const GaraGApp({
    super.key,
    required this.appProvider,
    required this.telemetryService,
    required this.activityRecognitionService,
    required this.tripService,
  });

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider<AppProvider>.value(value: appProvider),
        ChangeNotifierProvider(create: (_) => V2VProvider()),
        ChangeNotifierProvider(create: (_) => MeshProvider()),
        ChangeNotifierProvider(create: (_) => DepinProvider()),
        Provider<AiBridge>(create: (_) => AiBridge()),
        ChangeNotifierProvider(
          create: (context) => AiProvider(context.read<AiBridge>()),
        ),
        Provider<AdasService>(
          create: (context) => AdasService(context.read<AiBridge>()),
        ),
        ChangeNotifierProvider(
          create: (context) => AdasProvider(context.read<AdasService>()),
        ),
        Provider<TelemetryService>.value(value: telemetryService),
        Provider<ActivityRecognitionService>.value(value: activityRecognitionService),
        Provider<TripService>.value(value: tripService),
      ],
      child: MaterialApp.router(
        title: 'Gara-G',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(
          useMaterial3: true,
          colorScheme: ColorScheme.fromSeed(
            seedColor: Colors.greenAccent,
            brightness: Brightness.dark,
          ),
          scaffoldBackgroundColor: const Color(0xFF1A1A2E),
        ),
        routerConfig: AppRouter.router,
      ),
    );
  }
}

/// Clave de 32 bytes para SQLCipher, en hexadecimal.
///
/// Se lee de flutter_secure_storage; si no existe (primer arranque) se genera
/// con [Random.secure] y se guarda ahí. Nunca se registra ni se sale del
/// dispositivo.
Future<String> _resolveVaultKey() async {
  // Sin `encryptedSharedPreferences`: Google la deprecó (se migra sola a los
  // cifrados propios de Android en el primer acceso).
  const storage = FlutterSecureStorage();
  const claveKey = 'gara_g.vault.key.v1';

  final existente = await storage.read(key: claveKey);
  if (existente != null && existente.length == 64) return existente;

  final rng = Random.secure();
  final bytes = List<int>.generate(32, (_) => rng.nextInt(256));
  final clave = bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
  await storage.write(key: claveKey, value: clave);
  return clave;
}
