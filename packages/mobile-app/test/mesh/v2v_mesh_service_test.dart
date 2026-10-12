import 'dart:typed_data';
import 'package:flutter_test/flutter_test.dart';
import 'package:gara_g_pilot/src/mesh/safetyPacket.dart';
import 'package:gara_g_pilot/src/mesh/v2vMeshService.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('SafetyPacket Tests', () {
    test('heartbeat packet creation and getters', () {
      final pkt = SafetyPacket.heartbeat(
        tempId: 12345,
        lat: 40.4168,
        lon: -3.7038,
        speedKmh: 50.0,
      );

      expect(pkt.msgType, MsgType.heartbeat);
      expect(pkt.tempId, 12345);
      expect(pkt.lat, closeTo(40.4168, 0.0001));
      expect(pkt.lon, closeTo(-3.7038, 0.0001));
      expect(pkt.isCrashEvent, isFalse);
      expect(pkt.isHighPriority, isFalse);
      expect(pkt.canForward, isTrue);
    });

    test('hazard packet bitmasks and high priority flag', () {
      final pkt = SafetyPacket.hazard(
        tempId: 9999,
        lat: 40.4168,
        lon: -3.7038,
        eventMask: kCrashEventMask | kHardBrakeMask | kRoadHazardMask,
      );

      expect(pkt.msgType, MsgType.hazard);
      expect(pkt.isCrashEvent, isTrue);
      expect(pkt.isHardBrake, isTrue);
      expect(pkt.isRoadHazard, isTrue);
      expect(pkt.isHazardLights, isFalse);
      expect(pkt.isHighPriority, isTrue);
    });

    test('emergency brake packet max hops', () {
      final pkt = SafetyPacket.emergencyBrake(
        tempId: 777,
        lat: 40.0,
        lon: -3.0,
        speedKmh: 90.0,
      );

      expect(pkt.msgType, MsgType.emergencyBrake);
      expect(pkt.maxHops, kMaxHopCount + 2);
      expect(pkt.isHardBrake, isTrue);
      expect(pkt.isHighPriority, isTrue);
    });

    test('forwarded packet increments hop count', () {
      final pkt = SafetyPacket.heartbeat(
        tempId: 100,
        lat: 0.0,
        lon: 0.0,
        speedKmh: 0.0,
      );

      expect(pkt.hopCount, 0);
      final fwd = pkt.forwarded();
      expect(fwd.hopCount, 1);
      expect(fwd.tempId, 100);
    });

    test('payload serialization and deserialization', () {
      final original = SafetyPacket.hazard(
        tempId: 54321,
        lat: 41.3851,
        lon: 2.1734,
        eventMask: kEmergencyVehicleMask,
      );

      final payload = original.toPayload();
      expect(payload, isNotEmpty);
      expect(payload.length, greaterThanOrEqualTo(31));

      final decoded = SafetyPacket.fromPayload(payload);
      expect(decoded, isNotNull);
      expect(decoded!.tempId, 54321);
      expect(decoded.lat, closeTo(41.3851, 0.0001));
      expect(decoded.lon, closeTo(2.1734, 0.0001));
      expect(decoded.isEmergencyVehicle, isTrue);
    });

    test('Ed25519 signing and verification', () async {
      final pkt = SafetyPacket.heartbeat(
        tempId: 8888,
        lat: 40.4168,
        lon: -3.7038,
        speedKmh: 60.0,
      );

      final seed = Uint8List.fromList(List.generate(32, (i) => i));
      final signedPkt = await pkt.sign(seed);

      expect(signedPkt.publicKey, isNotNull);
      expect(signedPkt.signature, isNotNull);
      expect(signedPkt.publicKey!.length, 32);
      expect(signedPkt.signature!.length, 64);
      expect(signedPkt.verify(), isTrue);

      final signedPayload = signedPkt.toPayload();
      final decoded = SafetyPacket.fromPayload(signedPayload);
      expect(decoded, isNotNull);
      expect(decoded!.verify(), isTrue);
    });
  });

  group('V2VMeshService Tests', () {
    test('singleton instance and duty cycle state', () {
      final service = V2VMeshService();
      expect(service, isNotNull);
      expect(service.dutyCycleState, DutyCycleState.inactive);
      expect(service.connectedEndpoints, isEmpty);
      expect(service.foregroundService, isNotNull);
    });

    test('handleIncomingPayload deduplication and stream emission', () async {
      final service = V2VMeshService();
      final receivedPackets = <SafetyPacket>[];
      final subscription = service.packetStream.listen(receivedPackets.add);

      final pkt = SafetyPacket.hazard(
        tempId: 11111,
        lat: 37.7749,
        lon: -122.4194,
        eventMask: kHazardLightsMask,
      );
      final payload = pkt.toPayload();

      service.handleIncomingPayload(payload, 'peer_1');
      await Future.delayed(Duration(milliseconds: 10));

      expect(receivedPackets.length, 1);
      expect(receivedPackets.first.tempId, 11111);

      // Duplicate payload should be ignored
      service.handleIncomingPayload(payload, 'peer_1');
      await Future.delayed(Duration(milliseconds: 10));
      expect(receivedPackets.length, 1);

      await subscription.cancel();
    });
  });
}
