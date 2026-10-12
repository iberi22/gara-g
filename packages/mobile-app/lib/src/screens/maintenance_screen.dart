import 'package:flutter/material.dart';
import 'package:gara_g_pilot/src/screens/garage_screen.dart';

class MaintenanceScreen extends StatelessWidget {
  final VehicleNft vehicle;

  const MaintenanceScreen({super.key, required this.vehicle});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('Maintenance: ${vehicle.name}'),
      ),
      body: const Center(
        child: Text('Maintenance Screen - Coming Soon!'),
      ),
    );
  }
}
