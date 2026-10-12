import 'package:flutter/material.dart';
import 'package:gara_g_pilot/src/screens/garage_screen.dart';
import 'package:gara_g_pilot/src/screens/obd_live_screen.dart';
import 'package:gara_g_pilot/src/screens/maintenance_screen.dart';
import 'package:gara_g_pilot/src/screens/diagnostics_screen.dart';

class VehicleDetailScreen extends StatefulWidget {
  final VehicleNft vehicle;

  const VehicleDetailScreen({super.key, required this.vehicle});

  @override
  State<VehicleDetailScreen> createState() => _VehicleDetailScreenState();
}

class _VehicleDetailScreenState extends State<VehicleDetailScreen> {
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0D0D1A),
      body: CustomScrollView(
        slivers: [
          // Hero Image AppBar
          SliverAppBar(
            expandedHeight: 250,
            pinned: true,
            backgroundColor: const Color(0xFF1A1A2E),
            flexibleSpace: FlexibleSpaceBar(
              title: Text(
                widget.vehicle.name,
                style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
              ),
              background: Stack(
                fit: StackFit.expand,
                children: [
                  Image.network(
                    widget.vehicle.imageUrl,
                    fit: BoxFit.cover,
                    errorBuilder: (_, __, ___) => Container(
                      color: Colors.grey[800],
                      child: const Icon(Icons.directions_car, size: 80, color: Colors.white24),
                    ),
                  ),
                  Container(
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        begin: Alignment.topCenter,
                        end: Alignment.bottomCenter,
                        colors: [Colors.transparent, Colors.black.withOpacity(0.7)],
                      ),
                    ),
                  ),
                ],
              ),
            ),
            actions: [
              IconButton(
                icon: const Icon(Icons.edit),
                onPressed: _editVehicle,
                tooltip: 'Editar',
              ),
              PopupMenuButton<String>(
                onSelected: _handleMenuAction,
                itemBuilder: (context) => [
                  const PopupMenuItem(value: 'transfer', child: Text('Transferir')),
                  const PopupMenuItem(value: 'sell', child: Text('Poner en Venta')),
                  const PopupMenuItem(value: 'report_stolen', child: Text('Reportar Robo')),
                ],
              ),
            ],
          ),

          // Content
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Status Card
                  _buildStatusCard(),
                  const SizedBox(height: 16),

                  // Quick Stats
                  _buildQuickStats(),
                  const SizedBox(height: 24),

                  // Action Buttons Grid
                  _buildActionGrid(),
                  const SizedBox(height: 24),

                  // Vehicle Details
                  _buildDetailsSection(),
                  const SizedBox(height: 24),

                  // Sentinel Device Section
                  _buildDeviceSection(),
                  const SizedBox(height: 24),

                  // Recent Activity
                  _buildRecentActivity(),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStatusCard() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: widget.vehicle.statusColor.withOpacity(0.1),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: widget.vehicle.statusColor.withOpacity(0.3)),
      ),
      child: Row(
        children: [
          Icon(widget.vehicle.statusIcon, color: widget.vehicle.statusColor, size: 32),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Estado: ${widget.vehicle.status}',
                  style: TextStyle(
                    color: widget.vehicle.statusColor,
                    fontSize: 16,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                Text(
                  'NFT #${widget.vehicle.tokenId}',
                  style: TextStyle(color: Colors.white.withOpacity(0.7)),
                ),
              ],
            ),
          ),
          TextButton(
            onPressed: _changeStatus,
            child: const Text('Cambiar'),
          ),
        ],
      ),
    );
  }

  Widget _buildQuickStats() {
    return Row(
      children: [
        Expanded(child: _buildStatCard('Kilometraje', '${widget.vehicle.mileage}', 'km', Icons.speed)),
        const SizedBox(width: 12),
        Expanded(child: _buildStatCard('Servicios', '5', 'total', Icons.build)),
        const SizedBox(width: 12),
        Expanded(child: _buildStatCard('Score', '92', 'pts', Icons.star)),
      ],
    );
  }

  Widget _buildStatCard(String label, String value, String unit, IconData icon) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A2E),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        children: [
          Icon(icon, color: Colors.greenAccent, size: 24),
          const SizedBox(height: 8),
          Text(
            value,
            style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold),
          ),
          Text(unit, style: TextStyle(color: Colors.white.withOpacity(0.5), fontSize: 12)),
          Text(label, style: TextStyle(color: Colors.white.withOpacity(0.7), fontSize: 12)),
        ],
      ),
    );
  }

  Widget _buildActionGrid() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Acciones Rápidas',
          style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 12),
        GridView.count(
          crossAxisCount: 2,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          crossAxisSpacing: 12,
          mainAxisSpacing: 12,
          childAspectRatio: 1.5,
          children: [
            _buildActionButton(
              icon: Icons.speed,
              label: 'OBD en Vivo',
              color: Colors.blueAccent,
              onTap: () => Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => OBDLiveScreen(vehicle: widget.vehicle)),
              ),
            ),
            _buildActionButton(
              icon: Icons.build_circle,
              label: 'Mantenimiento',
              color: Colors.orangeAccent,
              onTap: () => Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => MaintenanceScreen(vehicle: widget.vehicle)),
              ),
            ),
            _buildActionButton(
              icon: Icons.warning_amber,
              label: 'Diagnóstico',
              color: Colors.redAccent,
              onTap: () => Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => DiagnosticsScreen(vehicle: widget.vehicle)),
              ),
            ),
            _buildActionButton(
              icon: Icons.history,
              label: 'Historial',
              color: Colors.purpleAccent,
              onTap: _showHistory,
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildActionButton({
    required IconData icon,
    required String label,
    required Color color,
    required VoidCallback onTap,
  }) {
    return Material(
      color: color.withOpacity(0.15),
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Container(
          padding: const EdgeInsets.all(16),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, color: color, size: 32),
              const SizedBox(height: 8),
              Text(label, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w500)),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildDetailsSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Detalles del Vehículo',
          style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 12),
        Container(
          decoration: BoxDecoration(
            color: const Color(0xFF1A1A2E),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Column(
            children: [
              _buildDetailRow('VIN', 'JT2BG22K0T0000001'),
              _buildDetailRow('Placa', widget.vehicle.plateNumber ?? 'No registrada'),
              _buildDetailRow('Marca', 'Toyota'),
              _buildDetailRow('Modelo', 'Corolla'),
              _buildDetailRow('Año', '2020'),
              _buildDetailRow('Color', 'Plata'),
              _buildDetailRow('Motor', '1.8L 4-Cilindros'),
              _buildDetailRow('Transmisión', 'CVT'),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildDetailRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: TextStyle(color: Colors.white.withOpacity(0.7))),
          Text(value, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w500)),
        ],
      ),
    );
  }

  Widget _buildDeviceSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Dispositivo Sentinel',
          style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 12),
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: const Color(0xFF1A1A2E),
            borderRadius: BorderRadius.circular(12),
          ),
          child: widget.vehicle.hasDevice
              ? Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: Colors.green.withOpacity(0.2),
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(Icons.bluetooth_connected, color: Colors.green),
                    ),
                    const SizedBox(width: 16),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text('Sentinel Pro', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                          Text('Conectado • Última sync: hace 2 min', style: TextStyle(color: Colors.white.withOpacity(0.7), fontSize: 12)),
                        ],
                      ),
                    ),
                    IconButton(
                      icon: const Icon(Icons.settings, color: Colors.white54),
                      onPressed: _configureDevice,
                    ),
                  ],
                )
              : Column(
                  children: [
                    Icon(Icons.bluetooth_disabled, size: 48, color: Colors.white.withOpacity(0.3)),
                    const SizedBox(height: 12),
                    const Text('Sin dispositivo vinculado', style: TextStyle(color: Colors.white70)),
                    const SizedBox(height: 12),
                    ElevatedButton.icon(
                      onPressed: _pairDevice,
                      icon: const Icon(Icons.bluetooth_searching),
                      label: const Text('Vincular Sentinel'),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: Colors.greenAccent,
                        foregroundColor: Colors.black,
                      ),
                    ),
                  ],
                ),
        ),
      ],
    );
  }

  Widget _buildRecentActivity() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Actividad Reciente',
          style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 12),
        _buildActivityItem(Icons.local_gas_station, 'Tanque lleno', 'Hace 2 días', Colors.amber),
        _buildActivityItem(Icons.build, 'Cambio de aceite', 'Hace 1 semana', Colors.orange),
        _buildActivityItem(Icons.speed, 'Kilometraje actualizado', 'Hace 2 semanas', Colors.blue),
      ],
    );
  }

  Widget _buildActivityItem(IconData icon, String title, String time, Color color) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A2E),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        children: [
          Icon(icon, color: color, size: 24),
          const SizedBox(width: 12),
          Expanded(
            child: Text(title, style: const TextStyle(color: Colors.white)),
          ),
          Text(time, style: TextStyle(color: Colors.white.withOpacity(0.5), fontSize: 12)),
        ],
      ),
    );
  }

  void _editVehicle() {
    // TODO: Navigate to edit screen
  }

  void _handleMenuAction(String action) {
    switch (action) {
      case 'transfer':
        _showTransferDialog();
        break;
      case 'sell':
        _changeStatus();
        break;
      case 'report_stolen':
        _reportStolen();
        break;
    }
  }

  void _changeStatus() {
    showModalBottomSheet(
      context: context,
      backgroundColor: const Color(0xFF1A1A2E),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (context) => Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Cambiar Estado', style: TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold)),
            const SizedBox(height: 16),
            _buildStatusOption('Active', 'Uso normal', Icons.check_circle, Colors.green),
            _buildStatusOption('ForSale', 'En venta', Icons.sell, Colors.blue),
            _buildStatusOption('Maintenance', 'En mantenimiento', Icons.build, Colors.orange),
            _buildStatusOption('Retired', 'Retirado', Icons.archive, Colors.grey),
          ],
        ),
      ),
    );
  }

  Widget _buildStatusOption(String status, String description, IconData icon, Color color) {
    return ListTile(
      leading: Icon(icon, color: color),
      title: Text(status, style: const TextStyle(color: Colors.white)),
      subtitle: Text(description, style: const TextStyle(color: Colors.white54)),
      onTap: () {
        Navigator.pop(context);
        // TODO: Call contract setStatus
      },
    );
  }

  void _showTransferDialog() {
    // TODO: Implement transfer dialog
  }

  void _reportStolen() {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: const Color(0xFF1A1A2E),
        title: const Text('⚠️ Reportar Robo', style: TextStyle(color: Colors.redAccent)),
        content: const Text(
          'Esta acción bloqueará el NFT del vehículo y notificará a la red. ¿Estás seguro?',
          style: TextStyle(color: Colors.white70),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancelar')),
          ElevatedButton(
            onPressed: () {
              Navigator.pop(context);
              // TODO: Call contract reportStolen
            },
            style: ElevatedButton.styleFrom(backgroundColor: Colors.redAccent),
            child: const Text('Confirmar Robo'),
          ),
        ],
      ),
    );
  }

  void _showHistory() {
    // TODO: Navigate to full history
  }

  void _configureDevice() {
    // TODO: Navigate to device settings
  }

  void _pairDevice() {
    // TODO: Start BLE pairing flow
  }
}