import 'package:flutter/material.dart';
import 'package:gara_g_pilot/src/screens/garage_screen.dart';

class DiagnosticsScreen extends StatelessWidget {
  final VehicleNft vehicle;

  const DiagnosticsScreen({super.key, required this.vehicle});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('Diagnostics: ${vehicle.name}'),
      ),
      body: const Center(
        child: Text('Diagnostics Screen - Coming Soon!'),
      ),
    );
  }
}
