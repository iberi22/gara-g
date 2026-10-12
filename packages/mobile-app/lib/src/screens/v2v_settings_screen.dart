import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../providers/v2v_provider.dart';

class V2VSettingsScreen extends StatefulWidget {
  const V2VSettingsScreen({super.key});

  @override
  State<V2VSettingsScreen> createState() => _V2VSettingsScreenState();
}

class _V2VSettingsScreenState extends State<V2VSettingsScreen> {
  final TextEditingController _nameController = TextEditingController();
  bool _showSecret = false;
  String? _secretKeyHex;

  @override
  void initState() {
    super.initState();
    _loadCurrentName();
  }

  void _loadCurrentName() async {
    // In a real app we'd get this from provider state directly if exposed,
    // or wallet storage. For now, we assume user knows what they set or we fetch it.
    // Provider doesn't expose name directly in a public field easily accessible synchronously
    // unless we add a getter. Let's just leave it empty or default.
    // Actually, let's ask provider for the public key as ID.
  }

  Future<void> _loadSecret(V2VProvider provider) async {
    final secretBytes = await provider.exportWalletSecret();
    setState(() {
      _secretKeyHex = secretBytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
      _showSecret = true;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<V2VProvider>(
      builder: (context, provider, child) {
        return Scaffold(
          backgroundColor: const Color(0xFF1A1A2E),
          appBar: AppBar(
            backgroundColor: const Color(0xFF16213E),
            title: const Text('Configuración V2V', style: TextStyle(color: Colors.white)),
            iconTheme: const IconThemeData(color: Colors.white),
          ),
          body: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              _buildSectionTitle('Identidad del Vehículo'),
              _buildInfoCard(
                title: 'ID Público',
                value: provider.myVehicleId ?? 'Desconocido',
                icon: Icons.fingerprint,
                isCopyable: true,
              ),
              const SizedBox(height: 16),

              _buildSectionTitle('Personalización'),
              TextField(
                controller: _nameController,
                style: const TextStyle(color: Colors.white),
                decoration: InputDecoration(
                  labelText: 'Nombre del Dispositivo',
                  labelStyle: const TextStyle(color: Colors.white70),
                  enabledBorder: OutlineInputBorder(
                    borderSide: const BorderSide(color: Colors.white24),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  focusedBorder: const OutlineInputBorder(
                    borderSide: BorderSide(color: Colors.blue),
                  ),
                  suffixIcon: IconButton(
                    icon: const Icon(Icons.save, color: Colors.blue),
                    onPressed: () {
                      if (_nameController.text.isNotEmpty) {
                        provider.updateDeviceName(_nameController.text);
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(content: Text('Nombre actualizado')),
                        );
                      }
                    },
                  ),
                ),
              ),

              const SizedBox(height: 32),
              _buildSectionTitle('Seguridad'),

              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: Colors.white.withOpacity(0.05),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: Colors.red.withOpacity(0.3)),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Copia de Seguridad',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 16,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 8),
                    const Text(
                      'Tu clave secreta es tu identidad. No la compartas con nadie.',
                      style: TextStyle(color: Colors.white70),
                    ),
                    const SizedBox(height: 16),
                    if (!_showSecret)
                      ElevatedButton.icon(
                        icon: const Icon(Icons.visibility),
                        label: const Text('Mostrar Clave Secreta'),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: Colors.orange.withOpacity(0.2),
                          foregroundColor: Colors.orange,
                        ),
                        onPressed: () => _loadSecret(provider),
                      )
                    else
                      Column(
                        children: [
                          SelectableText(
                            _secretKeyHex ?? '',
                            style: const TextStyle(
                              color: Colors.orange,
                              fontFamily: 'monospace',
                            ),
                          ),
                          const SizedBox(height: 8),
                          ElevatedButton.icon(
                            icon: const Icon(Icons.copy),
                            label: const Text('Copiar'),
                            onPressed: () {
                              Clipboard.setData(ClipboardData(text: _secretKeyHex ?? ''));
                              ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(content: Text('Copiado al portapapeles')),
                              );
                            },
                          ),
                        ],
                      ),
                  ],
                ),
              ),

              const SizedBox(height: 32),
              OutlinedButton.icon(
                icon: const Icon(Icons.delete_forever),
                label: const Text('Restablecer Identidad (Peligro)'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: Colors.red,
                  side: const BorderSide(color: Colors.red),
                ),
                onPressed: () async {
                  final confirm = await showDialog<bool>(
                    context: context,
                    builder: (context) => AlertDialog(
                      title: const Text('¿Estás seguro?'),
                      content: const Text(
                        'Esto borrará tu identidad actual y recompensas no sincronizadas para siempre. Esta acción no se puede deshacer.',
                      ),
                      actions: [
                        TextButton(
                          onPressed: () => Navigator.pop(context, false),
                          child: const Text('Cancelar'),
                        ),
                        TextButton(
                          onPressed: () => Navigator.pop(context, true),
                          child: const Text('Eliminar', style: TextStyle(color: Colors.red)),
                        ),
                      ],
                    ),
                  );

                  if (confirm == true) {
                    await provider.resetWallet();
                    if (context.mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('Monedero restablecido')),
                      );
                      Navigator.pop(context);
                    }
                  }
                },
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildSectionTitle(String title) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Text(
        title.toUpperCase(),
        style: const TextStyle(
          color: Colors.white54,
          fontSize: 12,
          fontWeight: FontWeight.bold,
          letterSpacing: 1.2,
        ),
      ),
    );
  }

  Widget _buildInfoCard({
    required String title,
    required String value,
    required IconData icon,
    bool isCopyable = false,
  }) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white.withOpacity(0.05),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          Icon(icon, color: Colors.white54),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: const TextStyle(color: Colors.white54, fontSize: 12)),
                Text(
                  value,
                  style: TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.bold,
                    fontFamily: isCopyable ? 'monospace' : null,
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
          if (isCopyable)
            IconButton(
              icon: const Icon(Icons.copy, size: 20, color: Colors.white30),
              onPressed: () {
                Clipboard.setData(ClipboardData(text: value));
              },
            ),
        ],
      ),
    );
  }
}
