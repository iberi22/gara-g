/// Main V2V Chat Screen
/// Shows nearby vehicles and allows communication

import 'dart:io';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/v2v_service.dart';
import '../services/depin_service.dart';
import '../providers/v2v_provider.dart';
import 'chat_screen.dart';
import 'v2v_settings_screen.dart';
import 'ai_screen.dart';

class V2VScreen extends StatefulWidget {
  const V2VScreen({super.key});

  @override
  State<V2VScreen> createState() => _V2VScreenState();
}

class _V2VScreenState extends State<V2VScreen> with TickerProviderStateMixin {
  late AnimationController _pulseController;

  @override
  void initState() {
    super.initState();
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 2),
    )..repeat();

    // Connect to real WebSocket
    if (!Platform.environment.containsKey('FLUTTER_TEST')) {
      DepinService().connect('ws://localhost:8080/ws/depin');
    }
  }

  @override
  void dispose() {
    _pulseController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<V2VProvider>(
      builder: (context, v2vProvider, child) {
        return Scaffold(
          backgroundColor: const Color(0xFF1A1A2E),
          appBar: AppBar(
            backgroundColor: const Color(0xFF16213E),
            title: const Text(
              'Gara-G V2V',
              style: TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.bold,
              ),
            ),
            actions: [
              // Connection status indicator
              Container(
                margin: const EdgeInsets.only(right: 16),
                child: Row(
                  children: [
                    Icon(
                      v2vProvider.isActive
                          ? Icons.wifi_tethering
                          : Icons.wifi_tethering_off,
                      color: v2vProvider.isActive ? Colors.greenAccent : Colors.grey,
                    ),
                    const SizedBox(width: 8),
                    Text(
                      '${v2vProvider.nearbyVehicles.length}',
                      style: TextStyle(
                        color: v2vProvider.isActive ? Colors.greenAccent : Colors.grey,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ],
                ),
              ),
              
              IconButton(
                icon: const Icon(Icons.settings, color: Colors.white),
                onPressed: () {
                  Navigator.push(
                    context,
                    MaterialPageRoute(builder: (context) => const V2VSettingsScreen()),
                  );
                },
              ),
              IconButton(
                icon: const Icon(Icons.camera_alt, color: Colors.white),
                onPressed: () {
                  Navigator.push(
                    context,
                    MaterialPageRoute(builder: (context) => const AiScreen()),
                  );
                },
              ),
            ],
          ),
          body: Column(
            children: [
              // Rewards banner
              _buildRewardsBanner(v2vProvider),

              // Radar-style visualization
              _buildRadarSection(v2vProvider),

              // Quick actions bar
              _buildQuickActionsBar(v2vProvider),

              // Nearby vehicles list
              Expanded(
                child: _buildNearbyList(v2vProvider),
              ),
            ],
          ),
          floatingActionButton: FloatingActionButton.extended(
            key: const Key('v2v_connect_button'),
            onPressed: () => v2vProvider.isActive
                ? v2vProvider.stopV2V()
                : v2vProvider.startV2V(),
            backgroundColor:
                v2vProvider.isActive ? Colors.redAccent : Colors.greenAccent,
            icon: Icon(
              v2vProvider.isActive ? Icons.stop : Icons.play_arrow,
              color: Colors.white,
            ),
            label: Text(
              v2vProvider.isActive ? 'Detener' : 'Conectar',
              style: const TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.bold,
              ),
            ),
          ),
        );
      },
    );
  }

  Widget _buildRadarSection(V2VProvider v2vProvider) {
    return Container(
      height: 200,
      width: double.infinity,
      margin: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF0F3460),
        borderRadius: BorderRadius.circular(20),
        boxShadow: [
          BoxShadow(
            color: Colors.greenAccent.withOpacity(0.2),
            blurRadius: 20,
            spreadRadius: 5,
          ),
        ],
      ),
      child: Stack(
        alignment: Alignment.center,
        children: [
          // Radar circles
          ...List.generate(3, (index) {
            return AnimatedBuilder(
              animation: _pulseController,
              builder: (context, child) {
                final scale = 1.0 + (_pulseController.value * 0.3 * (index + 1));
                final opacity = (1.0 - _pulseController.value) * 0.3;
                return Container(
                  width: 60.0 * scale,
                  height: 60.0 * scale,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    border: Border.all(
                      color: Colors.greenAccent.withOpacity(opacity),
                      width: 2,
                    ),
                  ),
                );
              },
            );
          }),

          // Center icon (you)
          Container(
            width: 50,
            height: 50,
            decoration: BoxDecoration(
              color: Colors.greenAccent,
              shape: BoxShape.circle,
              boxShadow: [
                BoxShadow(
                  color: Colors.greenAccent.withOpacity(0.5),
                  blurRadius: 10,
                  spreadRadius: 2,
                ),
              ],
            ),
            child: const Icon(
              Icons.directions_car,
              color: Colors.white,
              size: 30,
            ),
          ),

          // Nearby vehicle dots
          ...v2vProvider.nearbyVehicles.asMap().entries.map((entry) {
            final index = entry.key;
            final vehicle = entry.value;
            final angle = (index * 60.0) * 3.14159 / 180; // Spread around
            final distance = 60.0 + (index * 20.0);

            final isSentinel = vehicle.isSentinel;
            final icon = isSentinel ? Icons.shield : Icons.directions_car;
            final color = isSentinel
                ? Colors.cyanAccent
                : (vehicle.isConnected
                    ? Colors.blueAccent
                    : Colors.orangeAccent);

            return Positioned(
              left: 100 + distance * 0.8 * (index % 2 == 0 ? 1 : -1),
              top: 100 + distance * 0.5 * (index % 3 == 0 ? -1 : 1),
              child: GestureDetector(
                onTap: () => isSentinel ? null : _openChat(context, vehicle),
                child: Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: color,
                    shape: BoxShape.circle,
                  ),
                  child: Icon(
                    icon,
                    color: Colors.white,
                    size: 20,
                  ),
                ),
              ),
            );
          }),

          // Status text
          Positioned(
            bottom: 10,
            child: Text(
              v2vProvider.isActive
                  ? 'Buscando vehículos cercanos...'
                  : 'V2V desactivado',
              style: TextStyle(
                color: Colors.white.withOpacity(0.7),
                fontSize: 12,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildQuickActionsBar(V2VProvider v2vProvider) {
    return Container(
      height: 100,
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: ListView(
        scrollDirection: Axis.horizontal,
        children: [
          _buildQuickAction(
            icon: Icons.warning_amber,
            label: 'Peligro',
            color: Colors.redAccent,
            onTap: () => v2vProvider.broadcastQuickMessage(QuickMessage.hazardAhead),
          ),
          _buildQuickAction(
            icon: Icons.local_police,
            label: 'Policía',
            color: Colors.blueAccent,
            onTap: () => v2vProvider.broadcastQuickMessage(QuickMessage.policeAhead),
          ),
          _buildQuickAction(
            icon: Icons.traffic,
            label: 'Tráfico',
            color: Colors.orangeAccent,
            onTap: () => v2vProvider.broadcastQuickMessage(QuickMessage.trafficJam),
          ),
          _buildQuickAction(
            icon: Icons.thumb_up,
            label: 'Gracias',
            color: Colors.greenAccent,
            onTap: () => v2vProvider.broadcastQuickMessage(QuickMessage.thanks),
          ),
          _buildQuickAction(
            icon: Icons.emergency,
            label: 'SOS',
            color: Colors.red,
            onTap: () => _showEmergencyDialog(context, v2vProvider),
          ),
        ],
      ),
    );
  }

  Widget _buildQuickAction({
    required IconData icon,
    required String label,
    required Color color,
    required VoidCallback onTap,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 70,
        margin: const EdgeInsets.only(right: 12),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              width: 50,
              height: 50,
              decoration: BoxDecoration(
                color: color.withOpacity(0.2),
                borderRadius: BorderRadius.circular(15),
                border: Border.all(color: color, width: 2),
              ),
              child: Icon(icon, color: color),
            ),
            const SizedBox(height: 4),
            Text(
              label,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 10,
              ),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildNearbyList(V2VProvider v2vProvider) {
    if (v2vProvider.nearbyVehicles.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              Icons.search_off,
              size: 64,
              color: Colors.white.withOpacity(0.3),
            ),
            const SizedBox(height: 16),
            Text(
              v2vProvider.isActive
                  ? 'No hay vehículos cercanos'
                  : 'Activa V2V para buscar vehículos',
              style: TextStyle(
                color: Colors.white.withOpacity(0.5),
                fontSize: 16,
              ),
            ),
          ],
        ),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: v2vProvider.nearbyVehicles.length,
      itemBuilder: (context, index) {
        final vehicle = v2vProvider.nearbyVehicles[index];
        return _buildVehicleCard(context, vehicle, v2vProvider);
      },
    );
  }

  Widget _buildVehicleCard(
    BuildContext context,
    NearbyVehicle vehicle,
    V2VProvider v2vProvider,
  ) {
    final unreadCount = v2vProvider.getUnreadCount(vehicle.endpointId);

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: const Color(0xFF16213E),
        borderRadius: BorderRadius.circular(15),
        border: Border.all(
          color: vehicle.isConnected
              ? Colors.greenAccent.withOpacity(0.5)
              : Colors.transparent,
        ),
      ),
      child: ListTile(
        contentPadding: const EdgeInsets.all(12),
        leading: Stack(
          children: [
            Container(
              width: 50,
              height: 50,
              decoration: BoxDecoration(
                color: vehicle.isSentinel
                    ? Colors.cyanAccent.withOpacity(0.2)
                    : (vehicle.isConnected
                        ? Colors.greenAccent.withOpacity(0.2)
                        : Colors.grey.withOpacity(0.2)),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(
                vehicle.isSentinel ? Icons.shield : Icons.directions_car,
                color: vehicle.isSentinel
                    ? Colors.cyanAccent
                    : (vehicle.isConnected ? Colors.greenAccent : Colors.grey),
              ),
            ),
            if (vehicle.isConnected)
              Positioned(
                right: 0,
                bottom: 0,
                child: Container(
                  width: 14,
                  height: 14,
                  decoration: BoxDecoration(
                    color: Colors.greenAccent,
                    shape: BoxShape.circle,
                    border: Border.all(color: const Color(0xFF16213E), width: 2),
                  ),
                ),
              ),
          ],
        ),
        title: Text(
          vehicle.deviceName,
          style: const TextStyle(
            color: Colors.white,
            fontWeight: FontWeight.bold,
          ),
        ),
        subtitle: Text(
          vehicle.isConnected ? 'Conectado' : 'Descubierto',
          style: TextStyle(
            color: vehicle.isConnected ? Colors.greenAccent : Colors.grey,
            fontSize: 12,
          ),
        ),
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (unreadCount > 0)
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: Colors.redAccent,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(
                  '$unreadCount',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 12,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
            const SizedBox(width: 8),
            if (!vehicle.isSentinel)
              IconButton(
                key: const Key('v2v_chat_button'),
                icon: const Icon(Icons.chat_bubble, color: Colors.white),
                onPressed: () => _openChat(context, vehicle),
              ),
          ],
        ),
        onTap: () => vehicle.isSentinel ? null : _openChat(context, vehicle),
      ),
    );
  }

  void _openChat(BuildContext context, NearbyVehicle vehicle) {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (context) => ChatScreen(vehicle: vehicle),
      ),
    );
  }

  void _showEmergencyDialog(BuildContext context, V2VProvider v2vProvider) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: const Color(0xFF16213E),
        title: const Row(
          children: [
            Icon(Icons.emergency, color: Colors.red),
            SizedBox(width: 8),
            Text('EMERGENCIA', style: TextStyle(color: Colors.red)),
          ],
        ),
        content: const Text(
          '¿Enviar alerta de emergencia a todos los vehículos cercanos?',
          style: TextStyle(color: Colors.white),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancelar'),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: Colors.red),
            onPressed: () {
              v2vProvider.broadcastEmergency('¡Emergencia! Necesito ayuda');
              Navigator.pop(context);
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(
                  content: Text('⚠️ Alerta de emergencia enviada'),
                  backgroundColor: Colors.red,
                ),
              );
            },
            child: const Text('ENVIAR SOS', style: TextStyle(color: Colors.white)),
          ),
        ],
      ),
    );
  }

  /// Build rewards banner showing GARA earnings
  Widget _buildRewardsBanner(V2VProvider v2vProvider) {
    return FutureBuilder<String>(
      future: v2vProvider.getFormattedPendingReward(),
      builder: (context, snapshot) {
        final rewardText = snapshot.data ?? '0 GARA';

        return Container(
          margin: const EdgeInsets.fromLTRB(16, 8, 16, 0),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              colors: [
                Colors.amber.withOpacity(0.2),
                Colors.orange.withOpacity(0.1),
              ],
            ),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color: Colors.amber.withOpacity(0.3),
              width: 1,
            ),
          ),
          child: Row(
            children: [
              // Token icon
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: Colors.amber.withOpacity(0.2),
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.toll,
                  color: Colors.amber,
                  size: 24,
                ),
              ),
              const SizedBox(width: 12),

              // Reward info
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Recompensas V2V',
                      style: TextStyle(
                        color: Colors.white70,
                        fontSize: 12,
                      ),
                    ),
                    Row(
                      children: [
                        Text(
                          rewardText,
                          style: const TextStyle(
                            color: Colors.amber,
                            fontSize: 18,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        const SizedBox(width: 8),
                        Text(
                          '(${v2vProvider.messageCount} msgs)',
                          style: TextStyle(
                            color: Colors.white.withOpacity(0.5),
                            fontSize: 12,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              
              // Sync button
              IconButton(
                icon: const Icon(Icons.sync, color: Colors.amber),
                onPressed: () {
                  v2vProvider.syncRewardsNow();
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Sincronizando recompensas...')),
                  );
                },
                tooltip: 'Sincronizar con Blockchain',
              ),

              // Refresh button
              IconButton(
                icon: const Icon(Icons.refresh, color: Colors.amber),
                onPressed: () => v2vProvider.refreshRewardStats(),
              ),
            ],
          ),
        );
      },
    );
  }
}
