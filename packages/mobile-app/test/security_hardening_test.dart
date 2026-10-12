// test/security_hardening_test.dart — F1 y F3 de la auditoría de Opus 5.5.
//
// F1: la clave de SQLCipher era una constante en el APK
//   ("000102...1f"). Cualquiera que descargase el APK descifraba la base de
//   datos de telemetría completa de cualquier dispositivo. Ahora se genera por
//   dispositivo con Random.secure y vive en flutter_secure_storage.
//
// F3: el chat "privado" se emitía en claro a toda la malla
//   (`_meshService.sendPayload(...)` hace broadcast a todos los dispositivos
//   conectados), además de ir por la ruta firmada al destinatario.

import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// Lee un fichero del repo. Lanza si no existe: un test que pasa porque no
/// encuentra el fichero no está probando nada.
String _read(String path) {
  final file = File(path);
  if (!file.existsSync()) {
    throw StateError('no encuentro $path');
  }
  return file.readAsStringSync();
}

const _claveVieja =
    '"000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"';

void main() {
  group('F1 — la clave del vault no está en el APK', () {
    final mainDart = _read('lib/main.dart');

    test('no hay ninguna constante hexadecimal de 64 caracteres', () {
      // La clave vieja era exactamente 32 bytes en hex, repetibles.
      final hex64 = RegExp("[\"'][0-9a-fA-F]{64}[\"']");
      expect(
        hex64.hasMatch(mainDart),
        isFalse,
        reason:
            'hay una constante hex de 64 chars en main.dart: es una clave fija',
      );
    });

    test('no aparece la clave de ejemplo que se usó antes', () {
      expect(mainDart.contains('0001020304050607'), isFalse);
    });

    test('la clave se genera con Random.secure', () {
      expect(mainDart.contains('Random.secure()'), isTrue);
      expect(mainDart.contains("import 'dart:math'"), isTrue);
    });

    test('la clave se guarda en secure storage', () {
      expect(mainDart.contains('flutter_secure_storage'), isTrue);
      expect(mainDart.contains('FlutterSecureStorage'), isTrue);
    });

    test('genera 32 bytes, que es lo que espera SQLCipher', () {
      expect(
        mainDart.contains('List<int>.generate(32'),
        isTrue,
        reason: 'SQLCipher usa 32 bytes de clave',
      );
    });

    test('initDatabase recibe una clave, no una constante', () {
      final llamada = RegExp(r'initDatabase\([^;]*encryptionKey:\s*(\w+)');
      final match = llamada.firstMatch(mainDart);
      expect(match, isNotNull, reason: 'initDatabase no recibe encryptionKey');
      expect(
        match!.group(1),
        'encryptionKey',
        reason: 'debería pasar la clave resuelta, no un literal',
      );
    });

    test('la clave no se imprime en ninguna parte', () {
      for (final linea in mainDart.split('\n')) {
        final conPrint =
            linea.contains('print(') || linea.contains('debugPrint(');
        if (conPrint) {
          expect(
            linea.contains('clave'),
            isFalse,
            reason: 'la clave no debe aparecer en un print: $linea',
          );
        }
      }
    });
  });

  group('F3 — el chat privado no se difunde a la malla', () {
    final provider = _read('lib/src/providers/v2v_provider.dart');
    final mesh = _read('lib/src/services/mesh_service.dart');

    test('sendTextMessage no llama a sendPayload', () {
      // sendPayload es broadcast: recorre todos los dispositivos conectados.
      final inicio = provider.indexOf('sendTextMessage');
      expect(inicio, greaterThan(-1));
      final cuerpo = provider.substring(inicio, inicio + 700);
      expect(
        cuerpo.contains('sendPayload'),
        isFalse,
        reason: 'el texto vuelve a salir por la malla en claro',
      );
    });

    test('sendPayload sigue siendo broadcast (el aviso lo explica)', () {
      expect(
        mesh.contains('for (final deviceId in _connectedDevices)'),
        isTrue,
        reason: 'sendPayload difunde a todos los dispositivos',
      );
    });

    test('el texto sale solo por la ruta firmada al destinatario', () {
      final inicio = provider.indexOf('sendTextMessage');
      final cuerpo = provider.substring(inicio, inicio + 700);
      expect(
        cuerpo.contains('_v2vService.sendTextMessage(endpointId'),
        isTrue,
        reason: 'debe mantenerse la envío firmado a endpointId',
      );
    });
  });

  // El binario, no solo el fuente.
  //
  // Que main.dart no tenga clave fija no basta: podria venir de otro fichero, de
  // un asset o de un .so. Se comprueba el APK si ya existe.
  //
  // Sobre falsos positivos: la secuencia completa 0x00..0xff en hexadecimal SI
  // aparece en libflutter.so, pero es la tabla de permutacion de
  // pinenacl/ed25519 (Salsa20/Poly1305), identica en cualquier instalacion. Lo
  // que no debe aparecer es la clave del vault como literal entrecomillado.
  test('el APK construido no lleva la clave del vault', () {
    final apk = File('build/app/outputs/flutter-apk/app-release.apk');
    if (!apk.existsSync()) {
      markTestSkipped(
        'aun no se ha construido el APK: flutter build apk --release',
      );
      return;
    }

    final contenido = utf8.decode(apk.readAsBytesSync(), allowMalformed: true);
    expect(
      contenido.contains(_claveVieja),
      isFalse,
      reason: 'la clave fija del vault sigue dentro del APK',
    );
  });
}
