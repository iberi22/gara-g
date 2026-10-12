// Mobile app service & provider mocks for Flutter unit and integration testing.
import 'package:mockito/annotations.dart';
import 'package:gara_g_pilot/src/services/v2v_service.dart';
import 'package:gara_g_pilot/src/services/ble_service.dart';
import 'package:gara_g_pilot/src/services/blockchain_service.dart';
import 'package:gara_g_pilot/src/services/mesh_service.dart';
import 'package:gara_g_pilot/src/services/vaultService.dart';
import 'package:gara_g_pilot/src/services/solanaWalletDelegated.dart';
import 'package:gara_g_pilot/src/providers/v2v_provider.dart';
import 'package:gara_g_pilot/src/providers/adas_provider.dart';
import 'package:gara_g_pilot/src/providers/telemetry_provider.dart';
import 'package:gara_g_pilot/src/services/radarService.dart';
import 'package:gara_g_pilot/src/services/adas_service.dart';
import 'package:gara_g_pilot/src/services/dms_service.dart';
import 'package:gara_g_pilot/src/services/voice_safety_agent.dart';

@GenerateMocks([
  V2VService,
  BleService,
  BlockchainService,
  MeshService,
  VaultService,
  SolanaWalletDelegated,
  V2VProvider,
  AdasProvider,
  TelemetryProvider,
  RadarService,
  AdasService,
  DmsService, // Mocks for VaultService, TelemetryProvider, RadarService, AdasService, DmsService
  VoiceSafetyAgent,
])
void main() {}
