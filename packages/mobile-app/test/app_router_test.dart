import 'package:flutter_test/flutter_test.dart';
import 'package:gara_g_pilot/src/app_router.dart';

void main() {
  group('AppRouter Tests', () {
    test('Route constants definitions', () {
      expect(AppRouter.home, '/');
      expect(AppRouter.login, '/login');
      expect(AppRouter.dashboard, '/dashboard');
      expect(AppRouter.analytics, '/analytics');
      expect(AppRouter.fleets, '/fleets');
      expect(AppRouter.subscription, '/subscription');
      expect(AppRouter.staking, '/staking');
      expect(AppRouter.governance, '/governance');
      expect(AppRouter.exchange, '/exchange');
      expect(AppRouter.liquidity, '/liquidity');
      expect(AppRouter.vesting, '/vesting');
      expect(AppRouter.v2v, '/v2v');
      expect(AppRouter.earnings, '/earnings');
      expect(AppRouter.wallet, '/wallet');
      expect(AppRouter.videoEditor, '/video-editor');
      expect(AppRouter.gallery, '/gallery');
    });

    test('GoRouter configuration is instantiated', () {
      expect(AppRouter.router, isNotNull);
      expect(AppRouter.router.configuration.routes.length, 16);
    });
  });
}
