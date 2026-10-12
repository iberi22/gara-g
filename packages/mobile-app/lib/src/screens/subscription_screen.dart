import 'package:flutter/material.dart';
import '../services/subscription_service.dart';

class SubscriptionScreen extends StatefulWidget {
  const SubscriptionScreen({super.key});

  @override
  State<SubscriptionScreen> createState() => _SubscriptionScreenState();
}

class _SubscriptionScreenState extends State<SubscriptionScreen> {
  final SubscriptionService _subscriptionService = SubscriptionService(
    baseUrl: 'https://gara-g.swal.network', // Replace with config
    organizationId: 'org_1',
  );

  Map<String, dynamic>? _subscription;
  List<dynamic> _invoices = [];
  List<dynamic> _paymentMethods = [];
  bool _isLoading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final subResult = await _subscriptionService.getSubscription();
      final invoicesResult = await _subscriptionService.getInvoices();
      final pmResult = await _subscriptionService.getPaymentMethods();

      setState(() {
        _subscription = subResult['data'];
        _invoices = invoicesResult;
        _paymentMethods = pmResult;
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
      appBar: AppBar(
        title: const Text('Subscription & Billing'),
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(child: Text('Error: $_error'))
              : _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_subscription == null) return const Center(child: Text('No subscription data'));

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _buildPlanInfo(),
          const SizedBox(height: 24),
          _buildUsageInfo(),
          const SizedBox(height: 24),
          _buildPaymentMethodsSection(),
          const SizedBox(height: 24),
          _buildBillingHistorySection(),
          const SizedBox(height: 24),
          const Text(
            'Available Plans',
            style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 16),
          _buildPlanOption('Professional', '\$499/mo', 'Up to 100 vehicles, Advanced Analytics', 'pro'),
          _buildPlanOption('Enterprise', '\$2,999/mo', 'Unlimited fleets, Priority Support', 'enterprise'),
        ],
      ),
    );
  }

  Widget _buildPaymentMethodsSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            const Text(
              'Payment Methods',
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
            ),
            TextButton.icon(
              onPressed: () {},
              icon: const Icon(Icons.add),
              label: const Text('Add'),
            ),
          ],
        ),
        const SizedBox(height: 8),
        if (_paymentMethods.isEmpty)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 16),
            child: Center(child: Text('No payment methods found', style: TextStyle(color: Colors.grey))),
          )
        else
          ..._paymentMethods.map((pm) => Card(
                margin: const EdgeInsets.only(bottom: 8),
                child: ListTile(
                  leading: const Icon(Icons.credit_card),
                  title: Text('${pm['brand']} ending in ${pm['last4']}'),
                  subtitle: Text('Expires ${pm['expMonth']}/${pm['expYear']}'),
                  trailing: pm['isDefault']
                      ? const Badge(label: Text('Default'))
                      : TextButton(
                          onPressed: () => _setDefaultPaymentMethod(pm['id']),
                          child: const Text('Set Default'),
                        ),
                ),
              )),
      ],
    );
  }

  Widget _buildBillingHistorySection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Billing History',
          style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 16),
        if (_invoices.isEmpty)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 16),
            child: Center(child: Text('No invoices found', style: TextStyle(color: Colors.grey))),
          )
        else
          ListView.builder(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            itemCount: _invoices.length,
            itemBuilder: (context, index) {
              final inv = _invoices[index];
              return ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text('${inv['currency']} ${inv['amount']}'),
                subtitle: Text(inv['issuedAt'].toString().split('T')[0]),
                trailing: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: inv['status'] == 'paid' ? Colors.green.withOpacity(0.1) : Colors.orange.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: Text(
                    inv['status'].toString().toUpperCase(),
                    style: TextStyle(
                      color: inv['status'] == 'paid' ? Colors.green : Colors.orange,
                      fontSize: 12,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              );
            },
          ),
      ],
    );
  }

  Future<void> _setDefaultPaymentMethod(String id) async {
    try {
      await _subscriptionService.setDefaultPaymentMethod(id);
      _loadData();
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed to set default: $e')),
      );
    }
  }

  Widget _buildPlanInfo() {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Current Plan', style: TextStyle(color: Colors.grey)),
                    Text(
                      _subscription!['tier'].toString().toUpperCase(),
                      style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: Colors.blue),
                    ),
                  ],
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  decoration: BoxDecoration(
                    color: Colors.green.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Text(
                    _subscription!['status'].toString().toUpperCase(),
                    style: const TextStyle(color: Colors.green, fontWeight: FontWeight.bold),
                  ),
                ),
              ],
            ),
            const Divider(height: 32),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('Next Billing Date'),
                Text(
                  _subscription!['nextBillingDate'].toString().split('T')[0],
                  style: const TextStyle(fontWeight: FontWeight.bold),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildUsageInfo() {
    final limits = _subscription!['limits'];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Resource Usage',
          style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 16),
        _buildUsageItem('Vehicles', 145, limits['maxVehicles']),
        _buildUsageItem('Fleets', 5, limits['maxFleets']),
        _buildUsageItem('Users', 18, limits['maxUsers']),
      ],
    );
  }

  Widget _buildUsageItem(String label, int current, int max) {
    final double progress = max > 0 ? (current / max).clamp(0.0, 1.0) : 0.0;
    return Padding(
      padding: const EdgeInsets.only(bottom: 16.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(label),
              Text('$current / $max', style: const TextStyle(fontWeight: FontWeight.bold)),
            ],
          ),
          const SizedBox(height: 8),
          LinearProgressIndicator(
            value: progress,
            backgroundColor: Colors.grey[200],
            valueColor: AlwaysStoppedAnimation<Color>(progress > 0.9 ? Colors.red : Colors.blue),
          ),
        ],
      ),
    );
  }

  Widget _buildPlanOption(String name, String price, String description, String tier) {
    final bool isCurrent = _subscription!['tier'] == tier;

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(name, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                Text(price, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.blue)),
              ],
            ),
            const SizedBox(height: 8),
            Text(description, style: const TextStyle(color: Colors.grey)),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: isCurrent ? null : () => _upgrade(tier),
                child: Text(isCurrent ? 'Current Plan' : 'Upgrade'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _upgrade(String tier) async {
    try {
      await _subscriptionService.upgradePlan(tier);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Successfully upgraded to $tier plan')),
      );
      _loadData();
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Upgrade failed: $e')),
      );
    }
  }
}
