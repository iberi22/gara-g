import 'package:flutter/material.dart';
import 'package:gara_g_pilot/src/screens/exchange_screen.dart';
import 'package:gara_g_pilot/src/screens/liquidity_screen.dart';
import 'package:gara_g_pilot/src/screens/earnings_screen.dart';
import 'package:gara_g_pilot/src/screens/dashboard_screen.dart';
import 'package:gara_g_pilot/src/widgets/nav_bar.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _selectedIndex = 0;

  static const List<Widget> _screens = [
    DashboardScreen(),
    ExchangeScreen(),
    LiquidityScreen(),
    EarningsScreen(),
  ];

  void _onItemTapped(int index) {
    setState(() {
      _selectedIndex = index;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: IndexedStack(
        index: _selectedIndex,
        children: _screens,
      ),
      bottomNavigationBar: GaraNavBar(
        currentIndex: _selectedIndex,
        onTap: _onItemTapped,
      ),
    );
  }
}
