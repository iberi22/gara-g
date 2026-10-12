import 'package:flutter/material.dart';
import 'package:gara_g_pilot/src/screens/dashcam_screen.dart';
import 'package:gara_g_pilot/src/screens/v2v_screen.dart';
import 'package:gara_g_pilot/src/screens/v2v_settings_screen.dart';
import 'package:gara_g_pilot/src/screens/wallet_screen.dart';
import 'package:gara_g_pilot/src/screens/governance_screen.dart';
import 'package:gara_g_pilot/src/screens/marketplace_screen.dart';
import 'package:gara_g_pilot/src/screens/garage_screen.dart';
import 'package:gara_g_pilot/src/screens/gateway_screen.dart';
import 'package:gara_g_pilot/src/screens/staking_screen.dart';
import 'package:gara_g_pilot/src/screens/vesting_screen.dart';
import 'package:gara_g_pilot/src/screens/route_screen.dart';
import 'package:gara_g_pilot/src/screens/analytics_screen.dart';
import 'package:gara_g_pilot/src/services/ble_service.dart';

class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        title: const Text('Gara-G Pilot'),
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
      ),
      body: GridView.count(
        crossAxisCount: 2,
        padding: const EdgeInsets.all(16),
        crossAxisSpacing: 16,
        mainAxisSpacing: 16,
        children: [
          _buildDashboardCard(
            key: const Key('dashboard_dashcam_card'),
            icon: Icons.videocam,
            label: "Dashcam Sentinel",
            color: Colors.redAccent,
            onTap: () {
              Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => const DashcamScreen()),
              );
            },
          ),
          _buildDashboardCard(
            key: const Key('dashboard_v2v_card'),
            icon: Icons.map,
            label: "V2V Map",
            color: Colors.blueAccent,
            onTap: () {
              Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => const V2VScreen()),
              );
            },
          ),
          _buildDashboardCard(
            icon: Icons.wallet,
            label: "Wallet",
            color: Colors.greenAccent,
            onTap: () {
              Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => const WalletScreen()),
              );
            },
          ),
          _buildDashboardCard(
            icon: Icons.bluetooth_connected,
            label: "Sentinel BLE",
            color: Colors.orangeAccent,
            onTap: () {
               BleService().startScan();
               ScaffoldMessenger.of(context).showSnackBar(
                 const SnackBar(content: Text("Scanning for Sentinel Hardware...")),
               );
            },
          ),
          _buildDashboardCard(
            icon: Icons.how_to_vote,
            label: "DAO",
            color: Colors.purpleAccent,
            onTap: () {
              Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => const GovernanceScreen()),
              );
            },
          ),
          _buildDashboardCard(
            key: const Key('dashboard_market_card'),
            icon: Icons.store,
            label: "Market",
            color: Colors.amberAccent,
            onTap: () {
              Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => const MarketplaceScreen()),
              );
            },
          ),
          _buildDashboardCard(
            icon: Icons.router,
            label: "Gateway",
            color: Colors.cyan,
            onTap: () {
              Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => const GatewayScreen()),
              );
            },
          ),
          _buildDashboardCard(
            icon: Icons.settings,
            label: "Settings",
            color: Colors.grey,
            onTap: () {
              Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => const V2VSettingsScreen()),
              );
            },
          ),
          _buildDashboardCard(
            icon: Icons.garage,
            label: "Garaje",
            color: Colors.tealAccent,
            onTap: () {
              Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => const GarageScreen()),
              );
            },
          ),
          _buildDashboardCard(
            icon: Icons.lock,
            label: "Staking",
            color: Colors.indigoAccent,
            onTap: () {
              Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => const StakingScreen()),
              );
            },
          ),
          _buildDashboardCard(
            icon: Icons.timer,
            label: "Vesting",
            color: Colors.purpleAccent,
            onTap: () {
              Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => const VestingScreen()),
              );
            },
          ),
          _buildDashboardCard(
            icon: Icons.alt_route,
            label: "Routes",
            color: Colors.lightBlueAccent,
            onTap: () {
              Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => const RouteScreen()),
              );
            },
          ),
          _buildDashboardCard(
            key: const Key('dashboard_metrics_card'),
            icon: Icons.analytics,
            label: "Metrics",
            color: Colors.orangeAccent,
            onTap: () {
              Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => const AnalyticsScreen()),
              );
            },
          ),
        ],
      ),
    );
  }

  Widget _buildDashboardCard({
    Key? key,
    required IconData icon,
    required String label,
    required Color color,
    required VoidCallback onTap,
  }) {
    return InkWell(
      key: key,
      onTap: onTap,
      child: Container(
        decoration: BoxDecoration(
          color: const Color(0xFF1A1A2E),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: color.withOpacity(0.5)),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, size: 48, color: color),
            const SizedBox(height: 12),
            Text(
              label,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 16,
                fontWeight: FontWeight.bold,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
