import 'dart:async';
import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:flutter_background_service/flutter_background_service.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

Future<void> initializeBackgroundService() async {
  final service = FlutterBackgroundService();

  const AndroidNotificationChannel channel = AndroidNotificationChannel(
    'gara_foreground', // id
    'Gara-G Service', // title
    description: 'Running Gara-G Sentinel in background',
    importance: Importance.low,
  );

  final FlutterLocalNotificationsPlugin flutterLocalNotificationsPlugin =
      FlutterLocalNotificationsPlugin();

  await flutterLocalNotificationsPlugin
      .resolvePlatformSpecificImplementation<
          AndroidFlutterLocalNotificationsPlugin>()
      ?.createNotificationChannel(channel);

  await service.configure(
    androidConfiguration: AndroidConfiguration(
      // This will be executed in the isolate
      onStart: onStart,
      autoStart: false, // User triggers it manually
      isForegroundMode: true,
      notificationChannelId: 'gara_foreground',
      initialNotificationTitle: 'Gara-G Sentinel Active',
      initialNotificationContent: 'Monitoring V2V and Dashcam...',
      foregroundServiceNotificationId: 888,
    ),
    iosConfiguration: IosConfiguration(
        autoStart: false,
        onForeground: onStart,
        onBackground: onIosBackground,
    ),
  );
}

@pragma('vm:entry-point')
Future<bool> onIosBackground(ServiceInstance service) async {
  WidgetsFlutterBinding.ensureInitialized();
  return true;
}

@pragma('vm:entry-point')
void onStart(ServiceInstance service) async {
  // Only available for flutter 3.0.0 and later
  DartPluginRegistrant.ensureInitialized();

  // For Flutter prior to 3.0.0
  // We have to register the plugin manually

  if (service is AndroidServiceInstance) {
    service.on('setAsForeground').listen((event) {
      service.setAsForegroundService();
    });

    service.on('setAsBackground').listen((event) {
      service.setAsBackgroundService();
    });
  }

  service.on('stopService').listen((event) {
    service.stopSelf();
  });

  // Background Loop
  Timer.periodic(const Duration(seconds: 10), (timer) async {
    if (service is AndroidServiceInstance) {
      if (await service.isForegroundService()) {
        
        // Update notification
        // TODO: Get stats from Rust layer
        
        /*
        flutterLocalNotificationsPlugin.show(
          888,
          'Gara-G Sentinel Active',
          'Mesh Nodes: 3 | Dashcam: ON ${DateTime.now()}',
          const NotificationDetails(
            android: AndroidNotificationDetails(
              'gara_foreground',
              'Gara-G Service',
              icon: 'ic_bg_service_small',
              ongoing: true,
            ),
          ),
        );
        */
        
        service.invoke(
          'update',
          {
            "current_date": DateTime.now().toIso8601String(),
            "device": "Sentinel Node Active",
          },
        );
      }
    }
  });
}
