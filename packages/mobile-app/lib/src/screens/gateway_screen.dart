import 'package:flutter/material.dart';
import '../rust/api.dart' as rust; // Bridge API
import '../services/sigfox_service.dart';

class GatewayScreen extends StatefulWidget {
  const GatewayScreen({super.key});

  @override
  State<GatewayScreen> createState() => _GatewayScreenState();
}

class _GatewayScreenState extends State<GatewayScreen> {
  String _satStatus = "Checking...";
  String _loraStatus = "Checking...";
  String _sigfoxStatus = "Checking...";
  bool _loraActive = false;
  bool _sigfoxActive = false;
  int _loraFrequency = 0; // 0=EU868, 1=US915, 2=CN470
  final List<String> _logs = [];
  bool _isLoadingStats = false;

  @override
  void initState() {
    super.initState();
    _updateStatuses();
  }

  Future<void> _updateStatuses() async {
    try {
      final status = await rust.getGatewayStatus();
      
      setState(() {
        _satStatus = status.satellite;
        _loraStatus = status.lora;
        _sigfoxStatus = status.sigfox;
        _addLog("[INIT] Satellite: ${_satStatus}");
        _addLog("[INIT] LoRa: ${_loraStatus}");
        _addLog("[INIT] Sigfox: ${_sigfoxStatus}");
      });
    } catch (e) {
      setState(() {
        _satStatus = "Error: $e";
        _loraStatus = "Error: $e";
      });
    }
  }

  Future<void> _connectSatellite() async {
    setState(() {
      _satStatus = "Connecting...";
    });
    
    try {
      await rust.connectSatellite();
      await _updateStatuses();
      _addLog("[SAT] Connection attempt finished");
    } catch (e) {
      setState(() {
        _satStatus = "Failed: $e";
        _addLog("[SAT] Connection failed: $e");
      });
    }
  }

  Future<void> _testSat() async {
    setState(() {
      _satStatus = "Connecting to Iridium...";
    });
    try {
      final res = await rust.sendSatelliteAlert(alertMsg: "TEST PING");
      setState(() {
        _satStatus = "Sent successfully";
        _addLog("[SAT] Uplink confirmed: $res");
      });
    } catch (e) {
      setState(() {
        _satStatus = "Failed: $e";
        _addLog("[SAT] Error: $e");
      });
    }
  }

  Future<void> _connectLora() async {
    setState(() {
      _loraStatus = "Connecting...";
    });
    
    try {
      await rust.connectLora(frequencyIndex: _loraFrequency);
      await _updateStatuses();
      _loraActive = _loraStatus.contains("Connected");
      _addLog("[LORA] Connection attempt finished");
    } catch (e) {
      setState(() {
        _loraStatus = "Failed: $e";
        _loraActive = false;
        _addLog("[LORA] Error: $e");
      });
    }
  }

  Future<void> _connectSigfox() async {
    setState(() {
      _sigfoxStatus = "Connecting...";
    });

    try {
      await SigfoxService().connect();
      await _updateStatuses();
      _sigfoxActive = _sigfoxStatus.contains("Connected");
      _addLog("[SIGFOX] Connection attempt finished");
    } catch (e) {
      setState(() {
        _sigfoxStatus = "Failed: $e";
        _sigfoxActive = false;
        _addLog("[SIGFOX] Error: $e");
      });
    }
  }

  Future<void> _testSigfox() async {
    setState(() {
      _sigfoxStatus = "Uplinking...";
    });
    try {
      final res = await SigfoxService().sendTelemetry(12345, 40.7128, -74.0060);
      setState(() {
        _sigfoxStatus = "Uplink Successful";
        _addLog("[SIGFOX] Result: $res");
      });
    } catch (e) {
      setState(() {
        _sigfoxStatus = "Failed: $e";
        _addLog("[SIGFOX] Error: $e");
      });
    }
  }

  Future<void> _toggleLoraListening(bool value) async {
    if (!value) {
      setState(() {
        _loraActive = false;
        _addLog("[LORA] Stopped listening");
      });
      return;
    }

    try {
      // Mock listening
      final msg = "Listening on ${_getFrequencyLabel()}";
      setState(() {
        _loraActive = true;
        _addLog("[LORA] $msg");
      });
    } catch (e) {
      setState(() {
        _loraActive = false;
        _addLog("[LORA] Failed to start: $e");
      });
    }
  }

  void _addLog(String message) {
    setState(() {
      _logs.add(message);
      // Keep only last 50 logs
      if (_logs.length > 50) {
        _logs.removeAt(0);
      }
    });
  }

  String _getFrequencyLabel() {
    switch (_loraFrequency) {
      case 0:
        return "EU868";
      case 1:
        return "US915";
      case 2:
        return "CN470";
      default:
        return "EU868";
    }
  }

  Color _getStatusColor(String status) {
    if (status.contains("No Hardware")) {
      return Colors.grey;
    } else if (status.contains("Connected")) {
      return Colors.green;
    } else if (status.contains("Connecting")) {
      return Colors.orange;
    } else if (status.contains("Error") || status.contains("Failed")) {
      return Colors.red;
    } else {
      return Colors.grey;
    }
  }

  IconData _getStatusIcon(String status) {
    if (status.contains("No Hardware")) {
      return Icons.error_outline;
    } else if (status.contains("Connected")) {
      return Icons.check_circle;
    } else if (status.contains("Connecting")) {
      return Icons.sync;
    } else if (status.contains("Error") || status.contains("Failed")) {
      return Icons.warning;
    } else {
      return Icons.help_outline;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Gateway Operations'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _updateStatuses,
            tooltip: 'Refresh Status',
          ),
        ],
      ),
      body: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Satellite Card
            Card(
              color: Colors.blueGrey[900],
              child: Padding(
                padding: const EdgeInsets.all(12.0),
                child: Column(
                  children: [
                    ListTile(
                      leading: Icon(
                        Icons.satellite_alt,
                        size: 32,
                        color: Colors.cyanAccent,
                      ),
                      title: const Text(
                        "Satellite Uplink",
                        style: TextStyle(fontWeight: FontWeight.bold),
                      ),
                      subtitle: Row(
                        children: [
                          Icon(
                            _getStatusIcon(_satStatus),
                            size: 16,
                            color: _getStatusColor(_satStatus),
                          ),
                          const SizedBox(width: 6),
                          Expanded(
                            child: Text(
                              _satStatus,
                              style: TextStyle(
                                color: _getStatusColor(_satStatus),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.end,
                      children: [
                        TextButton(
                          onPressed: _connectSatellite,
                          child: const Text("Connect"),
                        ),
                        const SizedBox(width: 8),
                        ElevatedButton(
                          onPressed: _satStatus.contains("Connected")
                              ? _testSat
                              : null,
                          child: const Text("Test Alert"),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 10),

            // Sigfox Card
            Card(
              color: Colors.blueGrey[900],
              child: Padding(
                padding: const EdgeInsets.all(12.0),
                child: Column(
                  children: [
                    ListTile(
                      leading: Icon(
                        Icons.sensors,
                        size: 32,
                        color: Colors.greenAccent,
                      ),
                      title: const Text(
                        "Sigfox 0G Uplink",
                        style: TextStyle(fontWeight: FontWeight.bold),
                      ),
                      subtitle: Row(
                        children: [
                          Icon(
                            _getStatusIcon(_sigfoxStatus),
                            size: 16,
                            color: _getStatusColor(_sigfoxStatus),
                          ),
                          const SizedBox(width: 6),
                          Expanded(
                            child: Text(
                              _sigfoxStatus,
                              style: TextStyle(
                                color: _getStatusColor(_sigfoxStatus),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.end,
                      children: [
                        TextButton(
                          onPressed: _connectSigfox,
                          child: const Text("Connect"),
                        ),
                        const SizedBox(width: 8),
                        ElevatedButton(
                          onPressed: _sigfoxStatus.contains("Connected")
                              ? _testSigfox
                              : null,
                          child: const Text("Uplink 12B"),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 10),

            // LoRa Card
            Card(
              color: Colors.blueGrey[900],
              child: Padding(
                padding: const EdgeInsets.all(12.0),
                child: Column(
                  children: [
                    ListTile(
                      leading: Icon(
                        Icons.wifi_tethering,
                        size: 32,
                        color: Colors.orangeAccent,
                      ),
                      title: const Text(
                        "LoRaWAN Listener",
                        style: TextStyle(fontWeight: FontWeight.bold),
                      ),
                      subtitle: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Icon(
                                _getStatusIcon(_loraStatus),
                                size: 16,
                                color: _getStatusColor(_loraStatus),
                              ),
                              const SizedBox(width: 6),
                              Expanded(
                                child: Text(
                                  _loraStatus,
                                  style: TextStyle(
                                    color: _getStatusColor(_loraStatus),
                                  ),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 4),
                          Text(
                            "Frequency: ${_getFrequencyLabel()} MHz",
                            style: const TextStyle(fontSize: 12),
                          ),
                        ],
                      ),
                      trailing: Switch(
                        value: _loraActive,
                        onChanged: _toggleLoraListening,
                      ),
                    ),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.end,
                      children: [
                        DropdownButton<int>(
                          value: _loraFrequency,
                          items: const [
                            DropdownMenuItem(value: 0, child: Text("EU868")),
                            DropdownMenuItem(value: 1, child: Text("US915")),
                            DropdownMenuItem(value: 2, child: Text("CN470")),
                          ],
                          onChanged: (value) {
                            if (value != null) {
                              setState(() {
                                _loraFrequency = value;
                                _loraActive = false;
                              });
                              _updateStatuses();
                            }
                          },
                        ),
                        const SizedBox(width: 8),
                        TextButton(
                          onPressed: _connectLora,
                          child: const Text("Connect"),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 20),

            // Logs Section
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text(
                  "Gateway Logs",
                  style: TextStyle(
                    fontWeight: FontWeight.bold,
                    fontSize: 16,
                  ),
                ),
                TextButton(
                  onPressed: () {
                    setState(() {
                      _logs.clear();
                    });
                  },
                  child: const Text("Clear"),
                ),
              ],
            ),
            Expanded(
              child: Container(
                decoration: BoxDecoration(
                  color: Colors.black26,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: _logs.isEmpty
                    ? const Center(
                        child: Text(
                          "No logs yet",
                          style: TextStyle(color: Colors.grey),
                        ),
                      )
                    : ListView.builder(
                        itemCount: _logs.length,
                        reverse: true, // Show newest at bottom
                        itemBuilder: (ctx, i) {
                          final logIndex = _logs.length - 1 - i;
                          return Padding(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 8.0,
                              vertical: 2.0,
                            ),
                            child: Text(
                              _logs[logIndex],
                              style: const TextStyle(
                                fontFamily: 'monospace',
                                fontSize: 11,
                                color: Colors.white70,
                              ),
                            ),
                          );
                        },
                      ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
