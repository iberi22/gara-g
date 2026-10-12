import 'package:flutter/material.dart';
import 'package:gara_g_pilot/src/screens/vehicle_detail_screen.dart';
import 'package:gara_g_pilot/src/rust/api.dart';

/// Represents a vehicle NFT in the user's garage
class VehicleNft {
  final int tokenId;
  final String name;
  final String imageUrl;
  final String status; // Active, ForSale, Maintenance, Stolen, Retired
  final int mileage;
  final String? plateNumber;
  final bool hasDevice;

  VehicleNft({
    required this.tokenId,
    required this.name,
    required this.imageUrl,
    required this.status,
    required this.mileage,
    this.plateNumber,
    required this.hasDevice,
  });

  factory VehicleNft.fromJson(Map<String, dynamic> json) {
    return VehicleNft(
      tokenId: json['tokenId'] ?? 0,
      name: json['name'] ?? 'Unknown Vehicle',
      imageUrl: json['image'] ?? '',
      status: json['status'] ?? 'Active',
      mileage: json['mileage'] ?? 0,
      plateNumber: json['plate'],
      hasDevice: json['hasDevice'] ?? false,
    );
  }

  Color get statusColor {
    switch (status) {
      case 'Active': return Colors.green;
      case 'ForSale': return Colors.blue;
      case 'Maintenance': return Colors.orange;
      case 'Stolen': return Colors.red;
      case 'Retired': return Colors.grey;
      default: return Colors.white;
    }
  }

  IconData get statusIcon {
    switch (status) {
      case 'Active': return Icons.check_circle;
      case 'ForSale': return Icons.sell;
      case 'Maintenance': return Icons.build;
      case 'Stolen': return Icons.warning;
      case 'Retired': return Icons.archive;
      default: return Icons.help;
    }
  }
}

class GarageScreen extends StatefulWidget {
  const GarageScreen({super.key});

  @override
  State<GarageScreen> createState() => _GarageScreenState();
}

class _GarageScreenState extends State<GarageScreen> {
  List<VehicleNft> _vehicles = [];
  bool _isLoading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadGarage();
  }

  Future<void> _loadGarage() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      // TODO: Call actual blockchain function
      // final pubkey = await walletGetPublicKey();
      // final vehiclesJson = await getGarageVehicles(owner: pubkey);

      // Mock data for now
      await Future.delayed(const Duration(seconds: 1));
      setState(() {
        _vehicles = [
          VehicleNft(
            tokenId: 1,
            name: 'Toyota Corolla 2020',
            imageUrl: 'https://placehold.co/400x300/1a1a2e/white?text=Toyota',
            status: 'Active',
            mileage: 45230,
            plateNumber: 'ABC-123',
            hasDevice: true,
          ),
          VehicleNft(
            tokenId: 2,
            name: 'Honda Civic 2019',
            imageUrl: 'https://placehold.co/400x300/1a1a2e/white?text=Honda',
            status: 'Maintenance',
            mileage: 62100,
            plateNumber: 'XYZ-789',
            hasDevice: false,
          ),
        ];
        _isLoading = false;
      });
    } catch (e) {
      setState(() {
        _error = e.toString();
        _isLoading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0D0D1A),
      appBar: AppBar(
        title: const Text('🚗 Mi Garaje'),
        backgroundColor: Colors.transparent,
        elevation: 0,
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _loadGarage,
          ),
          IconButton(
            icon: const Icon(Icons.add_circle_outline),
            onPressed: _showAddVehicleDialog,
            tooltip: 'Agregar Vehículo',
          ),
        ],
      ),
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_isLoading) {
      return const Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            CircularProgressIndicator(color: Colors.greenAccent),
            SizedBox(height: 16),
            Text('Cargando garaje...', style: TextStyle(color: Colors.white70)),
          ],
        ),
      );
    }

    if (_error != null) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.error_outline, size: 64, color: Colors.redAccent),
            const SizedBox(height: 16),
            Text(_error!, style: const TextStyle(color: Colors.redAccent)),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: _loadGarage,
              child: const Text('Reintentar'),
            ),
          ],
        ),
      );
    }

    if (_vehicles.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.garage_outlined, size: 80, color: Colors.white.withOpacity(0.3)),
            const SizedBox(height: 24),
            const Text(
              'Tu garaje está vacío',
              style: TextStyle(color: Colors.white70, fontSize: 18),
            ),
            const SizedBox(height: 8),
            const Text(
              'Agrega tu primer vehículo para comenzar',
              style: TextStyle(color: Colors.white38, fontSize: 14),
            ),
            const SizedBox(height: 24),
            ElevatedButton.icon(
              onPressed: _showAddVehicleDialog,
              icon: const Icon(Icons.add),
              label: const Text('Agregar Vehículo'),
              style: ElevatedButton.styleFrom(
                backgroundColor: Colors.greenAccent,
                foregroundColor: Colors.black,
              ),
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _loadGarage,
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: _vehicles.length,
        itemBuilder: (context, index) => _buildVehicleCard(_vehicles[index]),
      ),
    );
  }

  Widget _buildVehicleCard(VehicleNft vehicle) {
    return Card(
      color: const Color(0xFF1A1A2E),
      margin: const EdgeInsets.only(bottom: 16),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: vehicle.statusColor.withOpacity(0.3)),
      ),
      child: InkWell(
        onTap: () => _openVehicleDetail(vehicle),
        borderRadius: BorderRadius.circular(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Vehicle Image
            ClipRRect(
              borderRadius: const BorderRadius.vertical(top: Radius.circular(16)),
              child: Stack(
                children: [
                  Image.network(
                    vehicle.imageUrl,
                    height: 160,
                    width: double.infinity,
                    fit: BoxFit.cover,
                    errorBuilder: (_, __, ___) => Container(
                      height: 160,
                      color: Colors.grey[800],
                      child: const Icon(Icons.directions_car, size: 64, color: Colors.white24),
                    ),
                  ),
                  // Status Badge
                  Positioned(
                    top: 12,
                    right: 12,
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                      decoration: BoxDecoration(
                        color: vehicle.statusColor.withOpacity(0.9),
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(vehicle.statusIcon, size: 16, color: Colors.white),
                          const SizedBox(width: 4),
                          Text(
                            vehicle.status,
                            style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
                          ),
                        ],
                      ),
                    ),
                  ),
                  // Device indicator
                  if (vehicle.hasDevice)
                    Positioned(
                      top: 12,
                      left: 12,
                      child: Container(
                        padding: const EdgeInsets.all(8),
                        decoration: BoxDecoration(
                          color: Colors.green.withOpacity(0.9),
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(Icons.bluetooth_connected, size: 16, color: Colors.white),
                      ),
                    ),
                ],
              ),
            ),
            // Vehicle Info
            Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          vehicle.name,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 18,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                      Text(
                        '#${vehicle.tokenId}',
                        style: TextStyle(color: Colors.white.withOpacity(0.5)),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      _buildInfoChip(Icons.speed, '${vehicle.mileage.toString().replaceAllMapped(RegExp(r'(\d{1,3})(?=(\d{3})+(?!\d))'), (m) => '${m[1]},')} km'),
                      const SizedBox(width: 12),
                      if (vehicle.plateNumber != null)
                        _buildInfoChip(Icons.confirmation_number, vehicle.plateNumber!),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildInfoChip(IconData icon, String label) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: Colors.white.withOpacity(0.1),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: Colors.white70),
          const SizedBox(width: 6),
          Text(label, style: const TextStyle(color: Colors.white70, fontSize: 12)),
        ],
      ),
    );
  }

  void _openVehicleDetail(VehicleNft vehicle) {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => VehicleDetailScreen(vehicle: vehicle),
      ),
    );
  }

  void _showAddVehicleDialog() {
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
          children: [
            const Text(
              'Agregar Vehículo',
              style: TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 24),
            ListTile(
              leading: const CircleAvatar(
                backgroundColor: Colors.blueAccent,
                child: Icon(Icons.qr_code_scanner, color: Colors.white),
              ),
              title: const Text('Escanear VIN', style: TextStyle(color: Colors.white)),
              subtitle: const Text('Usar cámara para leer VIN', style: TextStyle(color: Colors.white54)),
              onTap: () {
                Navigator.pop(context);
                // TODO: Navigate to VIN scanner
              },
            ),
            ListTile(
              leading: const CircleAvatar(
                backgroundColor: Colors.greenAccent,
                child: Icon(Icons.edit, color: Colors.white),
              ),
              title: const Text('Ingresar Manualmente', style: TextStyle(color: Colors.white)),
              subtitle: const Text('Escribir datos del vehículo', style: TextStyle(color: Colors.white54)),
              onTap: () {
                Navigator.pop(context);
                // TODO: Navigate to manual entry form
              },
            ),
            ListTile(
              leading: const CircleAvatar(
                backgroundColor: Colors.orangeAccent,
                child: Icon(Icons.bluetooth_searching, color: Colors.white),
              ),
              title: const Text('Desde Dispositivo OBD', style: TextStyle(color: Colors.white)),
              subtitle: const Text('Leer VIN automáticamente', style: TextStyle(color: Colors.white54)),
              onTap: () {
                Navigator.pop(context);
                // TODO: Navigate to OBD connection
              },
            ),
            const SizedBox(height: 16),
          ],
        ),
      ),
    );
  }
}