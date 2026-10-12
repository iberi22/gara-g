// ignore_for_file: file_names, unnecessary_import

import 'dart:typed_data';
import 'package:pinenacl/ed25519.dart';

/// Protocol version (V2)
const int kProtocolVersion = 2;

/// Default maximum hops
const int kMaxHopCount = 5;

/// Default public network ID
const int kDefaultNetworkId = 0;

/// Event Bitmasks
const int kCrashEventMask = 0x0001;
const int kHardBrakeMask = 0x0002;
const int kHazardLightsMask = 0x0004;
const int kEmergencyVehicleMask = 0x0008;
const int kRoadHazardMask = 0x0010;

enum MsgType {
  heartbeat(0x01),
  hazard(0x02),
  chat(0x03),
  handshake(0x99),
  emergencyBrake(0x10),
  roadCondition(0x11);

  final int value;
  const MsgType(this.value);

  static MsgType fromValue(int val) {
    return MsgType.values.firstWhere(
      (e) => e.value == val,
      orElse: () => MsgType.heartbeat,
    );
  }
}

/// SafetyPacket representing a V2V telemetry, hazard, or emergency message
/// with Ed25519 signature and telemetry bitmask.
class SafetyPacket {
  final int magic;
  final int version;
  final MsgType msgType;
  final int networkId;
  final int hopCount;
  final int maxHops;
  final int tempId;
  final DateTime timestamp;
  final double lat;
  final double lon;
  final int speedCms;
  final int heading;
  final int events;
  final Uint8List? publicKey;
  final Uint8List? signature;

  const SafetyPacket({
    this.magic = 0x47, // 'G'
    this.version = kProtocolVersion,
    required this.msgType,
    this.networkId = kDefaultNetworkId,
    this.hopCount = 0,
    this.maxHops = kMaxHopCount,
    required this.tempId,
    required this.timestamp,
    required this.lat,
    required this.lon,
    required this.speedCms,
    required this.heading,
    required this.events,
    this.publicKey,
    this.signature,
  });

  /// Factory constructor for heartbeat packet
  factory SafetyPacket.heartbeat({
    required int tempId,
    required double lat,
    required double lon,
    required double speedKmh,
    int heading = 0,
  }) {
    return SafetyPacket(
      msgType: MsgType.heartbeat,
      tempId: tempId,
      timestamp: DateTime.now(),
      lat: lat,
      lon: lon,
      speedCms: (speedKmh * 27.7778).round(),
      heading: heading,
      events: 0,
    );
  }

  /// Factory constructor for hazard packet
  factory SafetyPacket.hazard({
    required int tempId,
    required double lat,
    required double lon,
    required int eventMask,
  }) {
    return SafetyPacket(
      msgType: MsgType.hazard,
      tempId: tempId,
      timestamp: DateTime.now(),
      lat: lat,
      lon: lon,
      speedCms: 0,
      heading: 0,
      events: eventMask,
    );
  }

  /// Factory constructor for emergency brake packet
  factory SafetyPacket.emergencyBrake({
    required int tempId,
    required double lat,
    required double lon,
    required double speedKmh,
    int heading = 0,
  }) {
    return SafetyPacket(
      msgType: MsgType.emergencyBrake,
      maxHops: kMaxHopCount + 2,
      tempId: tempId,
      timestamp: DateTime.now(),
      lat: lat,
      lon: lon,
      speedCms: (speedKmh * 27.7778).round(),
      heading: heading,
      events: kHardBrakeMask,
    );
  }

  // Telemetry bitmask getters
  bool get isCrashEvent => (events & kCrashEventMask) != 0;
  bool get isHardBrake => (events & kHardBrakeMask) != 0;
  bool get isHazardLights => (events & kHazardLightsMask) != 0;
  bool get isEmergencyVehicle => (events & kEmergencyVehicleMask) != 0;
  bool get isRoadHazard => (events & kRoadHazardMask) != 0;

  bool get isHighPriority =>
      msgType == MsgType.emergencyBrake ||
      msgType == MsgType.hazard ||
      isCrashEvent ||
      isHardBrake;

  bool get canForward => hopCount < maxHops;

  SafetyPacket forwarded() {
    return SafetyPacket(
      magic: magic,
      version: version,
      msgType: msgType,
      networkId: networkId,
      hopCount: hopCount + 1,
      maxHops: maxHops,
      tempId: tempId,
      timestamp: timestamp,
      lat: lat,
      lon: lon,
      speedCms: speedCms,
      heading: heading,
      events: events,
      publicKey: publicKey,
      signature: signature,
    );
  }

  /// Generate signable bytes for Ed25519 signing
  Uint8List signableBytes() {
    final builder = BytesBuilder();
    builder.addByte(magic);
    builder.addByte(version);
    builder.addByte(msgType.value);
    builder.addByte(networkId);
    builder.addByte(hopCount);
    builder.addByte(maxHops);

    final bd = ByteData(25);
    bd.setUint32(0, tempId, Endian.little);
    bd.setUint64(4, timestamp.millisecondsSinceEpoch, Endian.little);
    bd.setInt32(12, (lat * 1e6).round(), Endian.little);
    bd.setInt32(16, (lon * 1e6).round(), Endian.little);
    bd.setUint16(20, speedCms, Endian.little);
    bd.setUint8(22, heading);
    bd.setUint16(23, events, Endian.little);

    builder.add(bd.buffer.asUint8List());
    return builder.toBytes();
  }

  /// Sign this packet with a 32-byte Ed25519 seed / private key using PineNaCl Ed25519
  Future<SafetyPacket> sign(Uint8List seed) async {
    final signingKey = SigningKey.fromSeed(seed);
    final message = signableBytes();
    final signedMsg = signingKey.sign(message);
    final sigBytes = Uint8List.fromList(signedMsg.signature);
    final pubKeyBytes = Uint8List.fromList(signingKey.verifyKey);

    return SafetyPacket(
      magic: magic,
      version: version,
      msgType: msgType,
      networkId: networkId,
      hopCount: hopCount,
      maxHops: maxHops,
      tempId: tempId,
      timestamp: timestamp,
      lat: lat,
      lon: lon,
      speedCms: speedCms,
      heading: heading,
      events: events,
      publicKey: pubKeyBytes,
      signature: sigBytes,
    );
  }

  /// Verify Ed25519 signature against signable bytes
  bool verify() {
    if (publicKey == null || signature == null) return false;
    if (publicKey!.length != 32 || signature!.length != 64) return false;

    try {
      final verifyKey = VerifyKey(publicKey!);
      final message = signableBytes();
      return verifyKey.verify(
        message: message,
        signature: Signature(signature!),
      );
    } catch (_) {
      return false;
    }
  }

  /// Binary payload serialization (for BLE / Nearby Connections transport)
  Uint8List toPayload() {
    final builder = BytesBuilder();
    final headerBytes = signableBytes();
    builder.add(headerBytes);

    if (publicKey != null && publicKey!.length == 32) {
      builder.addByte(1); // Has pubkey flag
      builder.add(publicKey!);
    } else {
      builder.addByte(0);
    }

    if (signature != null && signature!.length == 64) {
      builder.addByte(1); // Has signature flag
      builder.add(signature!);
    } else {
      builder.addByte(0);
    }

    return builder.toBytes();
  }

  /// Binary payload deserialization
  static SafetyPacket? fromPayload(Uint8List payload) {
    if (payload.length < 31) return null;

    try {
      final magic = payload[0];
      final version = payload[1];
      final msgType = MsgType.fromValue(payload[2]);
      final networkId = payload[3];
      final hopCount = payload[4];
      final maxHops = payload[5];

      final bd = ByteData.sublistView(payload, 6, 31);
      final tempId = bd.getUint32(0, Endian.little);
      final timestampMs = bd.getUint64(4, Endian.little);
      final latInt = bd.getInt32(12, Endian.little);
      final lonInt = bd.getInt32(16, Endian.little);
      final speedCms = bd.getUint16(20, Endian.little);
      final heading = bd.getUint8(22);
      final events = bd.getUint16(23, Endian.little);

      int offset = 31;
      Uint8List? pubKey;
      Uint8List? sig;

      if (offset < payload.length && payload[offset] == 1) {
        offset++;
        if (offset + 32 <= payload.length) {
          pubKey = payload.sublist(offset, offset + 32);
          offset += 32;
        }
      } else if (offset < payload.length) {
        offset++;
      }

      if (offset < payload.length && payload[offset] == 1) {
        offset++;
        if (offset + 64 <= payload.length) {
          sig = payload.sublist(offset, offset + 64);
        }
      }

      return SafetyPacket(
        magic: magic,
        version: version,
        msgType: msgType,
        networkId: networkId,
        hopCount: hopCount,
        maxHops: maxHops,
        tempId: tempId,
        timestamp: DateTime.fromMillisecondsSinceEpoch(timestampMs),
        lat: latInt / 1e6,
        lon: lonInt / 1e6,
        speedCms: speedCms,
        heading: heading,
        events: events,
        publicKey: pubKey,
        signature: sig,
      );
    } catch (_) {
      return null;
    }
  }
}
