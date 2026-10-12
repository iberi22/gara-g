import 'package:flutter/material.dart';
import '../app_router.dart';

class GaraNavBar extends StatelessWidget {
  final int currentIndex;
  final Function(int) onTap;

  const GaraNavBar({
    super.key,
    required this.currentIndex,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return BottomNavigationBar(
      backgroundColor: const Color(0xFF16213E),
      selectedItemColor: Colors.greenAccent,
      unselectedItemColor: Colors.white54,
      currentIndex: currentIndex,
      onTap: onTap,
      type: BottomNavigationBarType.fixed,
      items: const [
        BottomNavigationBarItem(
          icon: Icon(Icons.dashboard),
          label: 'Dashboard',
        ),
        BottomNavigationBarItem(
          icon: Icon(Icons.swap_horiz),
          label: 'Exchange',
        ),
        BottomNavigationBarItem(
          icon: Icon(Icons.waves),
          label: 'Liquidity',
        ),
        BottomNavigationBarItem(
          icon: Icon(Icons.monetization_on),
          label: 'Earnings',
        ),
      ],
    );
  }
}
