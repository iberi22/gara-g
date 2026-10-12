import 'package:flutter/material.dart';
import 'package:gara_g_pilot/src/rust/api.dart'; // Bridge API
import '../services/marketplace_service.dart';
import '../models/marketplace_models.dart';
import '../services/solanaWalletDelegated.dart';

class DataStream {
  final String id;
  final String name;
  final double price;
  final String description;

  DataStream({required this.id, required this.name, required this.price, required this.description});
}

class MarketplaceScreen extends StatefulWidget {
  const MarketplaceScreen({super.key});

  @override
  State<MarketplaceScreen> createState() => _MarketplaceScreenState();
}

class _MarketplaceScreenState extends State<MarketplaceScreen> {
  final MarketplaceService _marketplaceService = MarketplaceService();
  final SolanaWalletDelegated _solanaWalletService = SolanaWalletDelegated();

  bool _isOptedIn = false;
  double _totalEarnings = 0.0;
  double _pendingEarnings = 0.0;
  List<DataPackage> _recentSales = [];
  MarketplaceSettings _settings = const MarketplaceSettings();
  bool _isLoading = true;
  bool _isClaiming = false;

  // Notification Preferences (DEPIN-04)
  bool _notificationsEnabled = true;
  bool _notifNewListings = true;
  bool _notifPriceDrops = true;
  bool _notifDeals = true;
  double _minDistanceKm = 0.0;
  double _maxDistanceKm = 50.0;

  final List<DataStream> _availableStreams = [
    DataStream(id: '1', name: 'Real-time Traffic NYC', price: 10.0, description: 'Live telemetry from 500+ vehicles in Manhattan.'),
    DataStream(id: '2', name: 'Weather Data SF', price: 5.0, description: 'Ambient temperature and humidity from San Francisco fleet.'),
    DataStream(id: '3', name: 'Road Quality Berlin', price: 15.0, description: 'Pothole and road surface analysis using accelerometer data.'),
  ];

  final List<String> _purchaseHistory = [];

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    setState(() => _isLoading = true);
    try {
      await _marketplaceService.initialize();

      final isOptedIn = await _marketplaceService.isOptedIn();
      final settings = await _marketplaceService.getSettings();
      final earnings = await _marketplaceService.getEarnings();
      final recentSales = await _marketplaceService.getRecentSales(limit: 5);

      // Get blockchain balance
      double totalEarnings = 0.0;
      try {
        if (_solanaWalletService.isConnected) {
          totalEarnings = await _solanaWalletService.getGaraBalance();
        } else {
          final pubkey = await walletGetPublicKey();
          final balanceBigInt = await getWalletBalance(pubkey: pubkey);
          totalEarnings = balanceBigInt.toDouble() / 1000000.0;
        }
      } catch (e) {
        totalEarnings = 0.0;
      }

      setState(() {
        _isOptedIn = isOptedIn;
        _settings = settings;
        _pendingEarnings = earnings;
        _totalEarnings = totalEarnings;
        _recentSales = recentSales;
        _isLoading = false;
      });
    } catch (e) {
      setState(() => _isLoading = false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error loading data: $e')),
        );
      }
    }
  }

  Future<void> _toggleOptIn(bool value) async {
    try {
      if (value) {
        await _marketplaceService.optIn(_settings);
      } else {
        await _marketplaceService.optOut();
      }
      setState(() => _isOptedIn = value);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(value
                ? 'Successfully opted in to marketplace'
                : 'Successfully opted out of marketplace'),
            backgroundColor: Colors.green,
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e')),
        );
      }
    }
  }

  Future<void> _claimEarnings() async {
    if (_pendingEarnings <= 0) return;

    setState(() => _isClaiming = true);
    try {
      final result = await _marketplaceService.claimEarnings();
      await _loadData();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Claim successful: $result'),
            backgroundColor: Colors.green,
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Claim failed: $e')),
        );
      }
    } finally {
      setState(() => _isClaiming = false);
    }
  }

  Future<void> _updateDataCategory(String category, bool value) async {
    MarketplaceSettings newSettings;
    switch (category) {
      case 'location':
        newSettings = _settings.copyWith(shareLocation: value);
        break;
      case 'telemetry':
        newSettings = _settings.copyWith(shareTelemetry: value);
        break;
      case 'video':
        newSettings = _settings.copyWith(shareVideo: value);
        break;
      case 'roadConditions':
        newSettings = _settings.copyWith(shareRoadConditions: value);
        break;
      default:
        return;
    }

    await _marketplaceService.saveSettings(newSettings);
    setState(() => _settings = newSettings);
  }

  Future<void> _buyStream(DataStream stream) async {
    if (!_solanaWalletService.isConnected) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please connect your Solana wallet in the Staking screen first.')),
      );
      return;
    }

    setState(() => _isLoading = true);
    try {
      await Future.delayed(const Duration(seconds: 2));

      setState(() {
        _purchaseHistory.add('${stream.name} - ${DateTime.now().toLocal()}');
      });

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Purchased access to ${stream.name}!')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Purchase failed: $e')),
        );
      }
    } finally {
      setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Data Marketplace'),
          bottom: const TabBar(
            tabs: [
              Tab(text: 'My Data'),
              Tab(text: 'Available Streams'),
            ],
          ),
        ),
        body: TabBarView(
          children: [
            _buildMyDataTab(),
            _buildAvailableStreamsTab(),
          ],
        ),
      ),
    );
  }

  Widget _buildNotificationPreferencesCard() {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.notifications_active, color: Colors.blueAccent),
                const SizedBox(width: 8),
                const Text(
                  'Preferencias de Notificaciones P2P',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            const Text(
              'Recibe alertas a través de la red mesh cuando nuevos datasets se ajusten a tus preferencias.',
              style: TextStyle(color: Colors.white70, fontSize: 12),
            ),
            const Divider(height: 24),
            SwitchListTile(
              dense: true,
              title: const Text('Habilitar Alertas de Marketplace'),
              value: _notificationsEnabled,
              onChanged: (val) {
                setState(() => _notificationsEnabled = val);
              },
              activeColor: Colors.blueAccent,
            ),
            if (_notificationsEnabled) ...[
              const SizedBox(height: 8),
              const Padding(
                padding: EdgeInsets.symmetric(horizontal: 16.0),
                child: Text(
                  'Tipos de Notificación',
                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
                ),
              ),
              CheckboxListTile(
                dense: true,
                title: const Text('Nuevos Listados (New Listings)'),
                value: _notifNewListings,
                onChanged: (val) {
                  setState(() => _notifNewListings = val ?? false);
                },
                activeColor: Colors.blueAccent,
              ),
              CheckboxListTile(
                dense: true,
                title: const Text('Caídas de Precio (Price Drops)'),
                value: _notifPriceDrops,
                onChanged: (val) {
                  setState(() => _notifPriceDrops = val ?? false);
                },
                activeColor: Colors.blueAccent,
              ),
              CheckboxListTile(
                dense: true,
                title: const Text('Ofertas Exclusivas (Deals)'),
                value: _notifDeals,
                onChanged: (val) {
                  setState(() => _notifDeals = val ?? false);
                },
                activeColor: Colors.blueAccent,
              ),
              const Divider(height: 24),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16.0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Distancia de Cobertura P2P: ${_minDistanceKm.toStringAsFixed(0)} km - ${_maxDistanceKm.toStringAsFixed(0)} km',
                      style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
                    ),
                    const SizedBox(height: 8),
                    RangeSlider(
                      values: RangeValues(_minDistanceKm, _maxDistanceKm),
                      min: 0.0,
                      max: 200.0,
                      divisions: 20,
                      labels: RangeLabels(
                        '${_minDistanceKm.toStringAsFixed(0)} km',
                        '${_maxDistanceKm.toStringAsFixed(0)} km',
                      ),
                      onChanged: (RangeValues values) {
                        setState(() {
                          _minDistanceKm = values.start;
                          _maxDistanceKm = values.end;
                        });
                      },
                      activeColor: Colors.blueAccent,
                      inactiveColor: Colors.blueAccent.withOpacity(0.2),
                    ),
                  ],
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildMyDataTab() {
    return _isLoading
        ? const Center(child: CircularProgressIndicator())
        : RefreshIndicator(
            onRefresh: _loadData,
            child: SingleChildScrollView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.all(16.0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _buildPrivacyNotice(),
                  const SizedBox(height: 16),
                  _buildEarningsCard(),
                  const SizedBox(height: 16),
                  _buildOptInSection(),
                  const SizedBox(height: 16),
                  _buildNotificationPreferencesCard(),
                  const SizedBox(height: 16),
                  if (_isOptedIn) ...[
                    _buildDataCategories(),
                    const SizedBox(height: 16),
                    _buildRecentSales(),
                  ],
                ],
              ),
            ),
          );
  }

  Widget _buildAvailableStreamsTab() {
    return Column(
      children: [
        Expanded(
          child: ListView.builder(
            padding: const EdgeInsets.all(16.0),
            itemCount: _availableStreams.length,
            itemBuilder: (context, index) {
              final stream = _availableStreams[index];
              return Card(
                margin: const EdgeInsets.only(bottom: 16.0),
                child: Padding(
                  padding: const EdgeInsets.all(16.0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        stream.name,
                        style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                      ),
                      const SizedBox(height: 8),
                      Text(stream.description),
                      const SizedBox(height: 16),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(
                            '${stream.price} GARA',
                            style: const TextStyle(fontSize: 16, color: Colors.green, fontWeight: FontWeight.bold),
                          ),
                          ElevatedButton(
                            key: Key('market_buy_button_$index'),
                            onPressed: _isLoading ? null : () => _buyStream(stream),
                            child: const Text('Buy Access'),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              );
            },
          ),
        ),
        if (_purchaseHistory.isNotEmpty) ...[
          const Divider(),
          const Padding(
            padding: EdgeInsets.all(16.0),
            child: Text('Purchase History', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          ),
          SizedBox(
            height: 150,
            child: ListView.builder(
              padding: const EdgeInsets.symmetric(horizontal: 16.0),
              itemCount: _purchaseHistory.length,
              itemBuilder: (context, index) {
                return ListTile(
                  dense: true,
                  leading: const Icon(Icons.history, size: 16),
                  title: Text(_purchaseHistory[index], style: const TextStyle(fontSize: 12)),
                );
              },
            ),
          ),
        ],
      ],
    );
  }

  Widget _buildPrivacyNotice() {
    return Card(
      color: Colors.blue.withOpacity(0.1),
      child: Padding(
        padding: const EdgeInsets.all(12.0),
        child: Row(
          children: [
            const Icon(Icons.privacy_tip, color: Colors.blueAccent),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Your Privacy is Protected',
                    style: TextStyle(
                      fontWeight: FontWeight.bold,
                      color: Colors.blueAccent,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'All data is anonymized before sharing. No personal information is ever disclosed.',
                    style: TextStyle(
                      fontSize: 12,
                      color: Colors.white.withOpacity(0.7),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildEarningsCard() {
    return Card(
      color: Colors.green.withOpacity(0.1),
      child: Padding(
        padding: const EdgeInsets.all(20.0),
        child: Column(
          children: [
            Row(
              children: [
                const Icon(
                  Icons.account_balance_wallet,
                  size: 48,
                  color: Colors.greenAccent,
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '${_totalEarnings.toStringAsFixed(2)} GARA',
                        style: const TextStyle(
                          fontSize: 24,
                          fontWeight: FontWeight.bold,
                          color: Colors.greenAccent,
                        ),
                      ),
                      const Text(
                        'Total Earned',
                        style: TextStyle(color: Colors.white70),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        'Pending: ${_pendingEarnings.toStringAsFixed(2)} GARA',
                        style: const TextStyle(color: Colors.white70),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: _pendingEarnings > 0 && !_isClaiming
                    ? _claimEarnings
                    : null,
                icon: _isClaiming
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : const Icon(Icons.download),
                label: Text(_isClaiming ? 'Claiming...' : 'Claim Earnings'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.greenAccent,
                  foregroundColor: Colors.black,
                  padding: const EdgeInsets.symmetric(vertical: 12),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildOptInSection() {
    return Card(
      child: SwitchListTile(
        title: const Text(
          'Share My Data',
          style: TextStyle(fontWeight: FontWeight.bold),
        ),
        subtitle: const Text('Earn GARA by contributing anonymized telemetry'),
        value: _isOptedIn,
        onChanged: _toggleOptIn,
        activeColor: Colors.greenAccent,
        secondary: Icon(
          _isOptedIn ? Icons.cloud_upload : Icons.cloud_off,
          color: _isOptedIn ? Colors.greenAccent : Colors.grey,
        ),
      ),
    );
  }

  Widget _buildDataCategories() {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Data Categories',
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 8),
            const Text(
              'Select which data types to share',
              style: TextStyle(color: Colors.white70, fontSize: 12),
            ),
            const Divider(height: 24),
            _dataTypeToggle(
              'Location Data',
              Icons.location_on,
              _settings.shareLocation,
              'location',
            ),
            _dataTypeToggle(
              'Speed & Acceleration',
              Icons.speed,
              _settings.shareTelemetry,
              'telemetry',
            ),
            _dataTypeToggle(
              'Dashcam Footage',
              Icons.videocam,
              _settings.shareVideo,
              'video',
            ),
            _dataTypeToggle(
              'Road Conditions',
              Icons.warning,
              _settings.shareRoadConditions,
              'roadConditions',
            ),
          ],
        ),
      ),
    );
  }

  Widget _dataTypeToggle(String title, IconData icon, bool value, String category) {
    return SwitchListTile(
      dense: true,
      title: Text(title),
      secondary: Icon(icon, color: value ? Colors.greenAccent : Colors.grey),
      value: value,
      onChanged: (val) => _updateDataCategory(category, val),
      activeColor: Colors.greenAccent,
    );
  }

  Widget _buildRecentSales() {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Recent Sales',
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 8),
            if (_recentSales.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 20.0),
                child: Center(
                  child: Text(
                    'No sales yet. Enable data sharing to start earning!',
                    style: TextStyle(color: Colors.white70),
                    textAlign: TextAlign.center,
                  ),
                ),
              )
            else
              ListView.builder(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                itemCount: _recentSales.length,
                itemBuilder: (context, index) {
                  final sale = _recentSales[index];
                  return ListTile(
                    dense: true,
                    leading: Icon(
                      _getTypeIcon(sale.type),
                      color: Colors.greenAccent,
                    ),
                    title: Text(
                      '${sale.earnedGara.toStringAsFixed(2)} GARA',
                      style: const TextStyle(fontWeight: FontWeight.bold),
                    ),
                    subtitle: Text(
                      '${sale.dataPoints} data points • ${_formatDate(sale.timestamp)}',
                      style: const TextStyle(fontSize: 12),
                    ),
                    trailing: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 4,
                      ),
                      decoration: BoxDecoration(
                        color: sale.status == 'claimed'
                            ? Colors.green.withOpacity(0.2)
                            : Colors.orange.withOpacity(0.2),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Text(
                        sale.status.toUpperCase(),
                        style: TextStyle(
                          fontSize: 10,
                          color: sale.status == 'claimed'
                              ? Colors.greenAccent
                              : Colors.orangeAccent,
                        ),
                      ),
                    ),
                  );
                },
              ),
          ],
        ),
      ),
    );
  }

  IconData _getTypeIcon(String type) {
    switch (type) {
      case 'telemetry':
        return Icons.speed;
      case 'video':
        return Icons.videocam;
      case 'aggregate':
        return Icons.analytics;
      default:
        return Icons.data_usage;
    }
  }

  String _formatDate(DateTime date) {
    final now = DateTime.now();
    final diff = now.difference(date);

    if (diff.inDays > 0) {
      return '${diff.inDays}d ago';
    } else if (diff.inHours > 0) {
      return '${diff.inHours}h ago';
    } else if (diff.inMinutes > 0) {
      return '${diff.inMinutes}m ago';
    } else {
      return 'Just now';
    }
  }
}
