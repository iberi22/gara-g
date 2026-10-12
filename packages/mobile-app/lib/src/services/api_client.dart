import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class ApiClient {
  static final ApiClient _instance = ApiClient._internal();
  factory ApiClient() => _instance;

  late Dio _dio;
  final _storage = const FlutterSecureStorage();

  ApiClient._internal() {
    _dio = Dio(
      BaseOptions(
        // El Worker real. Un APK que hable a localhost no sirve de nada en el
        // vehiculo, y ademas manda las credenciales al sitio equivocado.
        baseUrl: 'https://gara-g.swal.network',
        connectTimeout: const Duration(seconds: 15),
        receiveTimeout: const Duration(seconds: 15),
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      ),
    );

    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          final token = await _storage.read(key: 'auth_token');
          if (token != null) {
            options.headers['Authorization'] = 'Bearer $token';
          }
          return handler.next(options);
        },
        onError: (DioException e, handler) {
          // Global error handling
          print('API Error: ${e.message}');
          return handler.next(e);
        },
      ),
    );
  }

  Dio get dio => _dio;

  @visibleForTesting
  set dio(Dio value) => _dio = value;

  Future<void> setBaseUrl(String url) async {
    _dio.options.baseUrl = url;
  }

  Future<void> saveToken(String token) async {
    await _storage.write(key: 'auth_token', value: token);
  }

  Future<void> clearToken() async {
    await _storage.delete(key: 'auth_token');
  }

  /// Inicia sesion contra el Worker.
  ///
  /// Devuelve el email del usuario, o lanza [AuthException]. El Worker responde
  /// con la cookie `session` en `Set-Cookie` — la PWA no usa Authorization — asi
  /// que la cookie se guarda aqui: sin ella, el resto de la app no autenticaria.
  Future<String> login(String email, String password) async {
    final response = await _dio.post<Map<String, dynamic>>(
      '/auth/login',
      data: {'email': email.trim(), 'password': password},
      options: Options(validateStatus: (s) => s != null && s < 500),
    );

    final code = response.statusCode ?? 0;
    if (code == 401 || code == 400) {
      // Mismo texto para cualquier motivo: distinguir "email no existe" de
      // "contrasena incorrecta" diria que emails estan dados de alta.
      throw const AuthException('Credenciales invalidas');
    }
    if (code >= 400) {
      throw const AuthException('No se pudo iniciar sesion');
    }

    final cookie = response.headers.value('set-cookie');
    if (cookie == null || cookie.isEmpty) {
      // Sin cookie el login "funciona" pero nada mas queda autenticado.
      throw const AuthException('El servidor no devolvio sesion');
    }
    await saveToken(cookie.split(';').first);

    final data = response.data ?? const {};
    final user = data['user'];
    if (user is Map && user['email'] is String) {
      return user['email'] as String;
    }
    return email.trim();
  }
}

/// Credenciales rechazadas o sesion no establecida. No distingue el motivo.
class AuthException implements Exception {
  const AuthException(this.message);
  final String message;

  @override
  String toString() => message;
}
