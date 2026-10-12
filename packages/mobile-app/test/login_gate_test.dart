// test/login_gate_test.dart — F6: el login de Flutter no validaba nada.
//
// El boton de LOGIN navegaba a HomeScreen sin mirar el email ni la contrasena:
// la app se abria a cualquiera, y las pantallas siguientes no tenian ninguna
// sesion que las respaldara. Ahora el formulario exige credenciales y las pide
// al Worker.
//
// El login NO puede distinguir "el email no existe" de "la contrasena no es la
// correcta": con dos mensajes distintos, un atacante sabe que emails estan dados
// de alta.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:gara_g_pilot/src/screens/login_screen.dart';
import 'package:gara_g_pilot/src/services/api_client.dart';

void main() {
  group('F6 — el login exige credenciales de verdad', () {
    testWidgets('el boton existe y hay un campo de email', (tester) async {
      await tester.pumpWidget(const MaterialApp(home: LoginScreen()));
      expect(find.byKey(const Key('login_email_field')), findsOneWidget);
      expect(find.byKey(const Key('login_password_field')), findsOneWidget);
      expect(find.byKey(const Key('login_button')), findsOneWidget);
    });

    testWidgets('la contrasena va oculta', (tester) async {
      await tester.pumpWidget(const MaterialApp(home: LoginScreen()));
      // El flag lo consume el EditableText que hay bajo el TextFormField.
      final editable = tester.widget<EditableText>(
        find.descendant(
          of: find.byKey(const Key('login_password_field')),
          matching: find.byType(EditableText),
        ),
      );
      expect(editable.obscureText, isTrue, reason: 'la contrasena no puede verse');
    });

    testWidgets('sin datos, el login se niega y no navega', (tester) async {
      await tester.pumpWidget(const MaterialApp(home: LoginScreen()));
      await tester.tap(find.byKey(const Key('login_button')));
      await tester.pump();

      // Los dos validadores saltan: no se llega a llamar al servidor.
      expect(find.text('El email es obligatorio'), findsOneWidget);
      expect(find.text('La contrasena es obligatoria'), findsOneWidget);
    });

    testWidgets('un email sin forma de email se rechaza', (tester) async {
      await tester.pumpWidget(const MaterialApp(home: LoginScreen()));

      await tester.enterText(find.byKey(const Key('login_email_field')), 'esto-no-es');
      await tester.enterText(
        find.byKey(const Key('login_password_field')),
        'una-contrasena-larga',
      );
      await tester.tap(find.byKey(const Key('login_button')));
      await tester.pump();

      expect(find.text('El email no tiene forma de email'), findsOneWidget);
    });
  });

  group('AuthException — no distingue el motivo', () {
    test('el texto no revela si el email existe', () {
      // Un solo texto para todos los fallos: un 404 distinto para "email
      // desconocido" daria la lista de clientes dados de alta.
      expect(const AuthException('Credenciales invalidas').toString(),
          'Credenciales invalidas');
    });

    test('es una Exception, para que el catch del widget la distinga', () {
      expect(const AuthException('x'), isA<Exception>());
    });
  });
}
