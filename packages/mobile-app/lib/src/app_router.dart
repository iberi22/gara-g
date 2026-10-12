import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'screens/home_screen.dart';
import 'screens/fleet_screen.dart';
import 'screens/subscription_screen.dart';
import 'screens/staking_screen.dart';
import 'screens/governance_screen.dart';
import 'screens/exchange_screen.dart';
import 'screens/liquidity_screen.dart';
import 'screens/vesting_screen.dart';
import 'screens/v2v_screen.dart';
import 'screens/earnings_screen.dart';
import 'screens/dashboard_screen.dart';
import 'screens/wallet_screen.dart';
import 'screens/login_screen.dart';
import 'screens/analytics_screen.dart';
import 'screens/video_editor_screen.dart';
import 'screens/gallery_screen.dart';

class AppRouter {
  static const String home = '/';
  static const String login = '/login';
  static const String dashboard = '/dashboard';
  static const String analytics = '/analytics';
  static const String fleets = '/fleets';
  static const String subscription = '/subscription';
  static const String staking = '/staking';
  static const String governance = '/governance';
  static const String exchange = '/exchange';
  static const String liquidity = '/liquidity';
  static const String vesting = '/vesting';
  static const String v2v = '/v2v';
  static const String earnings = '/earnings';
  static const String wallet = '/wallet';
  static const String videoEditor = '/video-editor';
  static const String gallery = '/gallery';

  static final GoRouter router = GoRouter(
    initialLocation: login,
    routes: [
      GoRoute(
        path: home,
        builder: (context, state) => const HomeScreen(),
      ),
      GoRoute(
        path: login,
        builder: (context, state) => const LoginScreen(),
      ),
      GoRoute(
        path: dashboard,
        builder: (context, state) => const DashboardScreen(),
      ),
      GoRoute(
        path: analytics,
        builder: (context, state) => const AnalyticsScreen(),
      ),
      GoRoute(
        path: fleets,
        builder: (context, state) => const FleetScreen(),
      ),
      GoRoute(
        path: subscription,
        builder: (context, state) => const SubscriptionScreen(),
      ),
      GoRoute(
        path: staking,
        builder: (context, state) => const StakingScreen(),
      ),
      GoRoute(
        path: governance,
        builder: (context, state) => const GovernanceScreen(),
      ),
      GoRoute(
        path: exchange,
        builder: (context, state) => const ExchangeScreen(),
      ),
      GoRoute(
        path: liquidity,
        builder: (context, state) => const LiquidityScreen(),
      ),
      GoRoute(
        path: vesting,
        builder: (context, state) => const VestingScreen(),
      ),
      GoRoute(
        path: v2v,
        builder: (context, state) => const V2VScreen(),
      ),
      GoRoute(
        path: earnings,
        builder: (context, state) => const EarningsScreen(),
      ),
      GoRoute(
        path: wallet,
        builder: (context, state) => const WalletScreen(),
      ),
      GoRoute(
        path: videoEditor,
        builder: (context, state) {
          final extra = state.extra as Map<String, dynamic>?;
          return VideoEditorScreen(videoPath: extra?['path'] ?? '');
        },
      ),
      GoRoute(
        path: gallery,
        builder: (context, state) => const GalleryScreen(),
      ),
    ],
    errorBuilder: (context, state) => Scaffold(
      body: Center(
        child: Text('No route defined for ${state.uri.toString()}'),
      ),
    ),
  );

  static Route<dynamic> generateRoute(RouteSettings settings) {
    switch (settings.name) {
      case home:
        return MaterialPageRoute(builder: (_) => const HomeScreen());
      case login:
        return MaterialPageRoute(builder: (_) => const LoginScreen());
      case dashboard:
        return MaterialPageRoute(builder: (_) => const DashboardScreen());
      case analytics:
        return MaterialPageRoute(builder: (_) => const AnalyticsScreen());
      case fleets:
        return MaterialPageRoute(builder: (_) => const FleetScreen());
      case subscription:
        return MaterialPageRoute(builder: (_) => const SubscriptionScreen());
      case staking:
        return MaterialPageRoute(builder: (_) => const StakingScreen());
      case governance:
        return MaterialPageRoute(builder: (_) => const GovernanceScreen());
      case exchange:
        return MaterialPageRoute(builder: (_) => const ExchangeScreen());
      case liquidity:
        return MaterialPageRoute(builder: (_) => const LiquidityScreen());
      case vesting:
        return MaterialPageRoute(builder: (_) => const VestingScreen());
      case v2v:
        return MaterialPageRoute(builder: (_) => const V2VScreen());
      case earnings:
        return MaterialPageRoute(builder: (_) => const EarningsScreen());
      case wallet:
        return MaterialPageRoute(builder: (_) => const WalletScreen());
      case videoEditor:
        final args = settings.arguments as Map<String, dynamic>?;
        return MaterialPageRoute(
          builder: (_) => VideoEditorScreen(videoPath: args?['path'] ?? ''),
        );
      case gallery:
        return MaterialPageRoute(builder: (_) => const GalleryScreen());
      default:
        return MaterialPageRoute(
          builder: (_) => Scaffold(
            body: Center(child: Text('No route defined for ${settings.name}')),
          ),
        );
    }
  }
}
