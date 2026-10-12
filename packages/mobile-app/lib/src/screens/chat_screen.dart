/// Chat Screen for V2V Communication
/// One-on-one chat with a nearby vehicle

import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/v2v_service.dart';
import '../providers/v2v_provider.dart';

class ChatScreen extends StatefulWidget {
  final NearbyVehicle vehicle;

  const ChatScreen({super.key, required this.vehicle});

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final TextEditingController _messageController = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  bool _isRecording = false;
  Timer? _recordingTimer;
  int _recordingDuration = 0;

  @override
  void initState() {
    super.initState();
    // Mark messages as read when opening chat
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<V2VProvider>().markAsRead(widget.vehicle.endpointId);
    });
  }

  @override
  void dispose() {
    _messageController.dispose();
    _scrollController.dispose();
    _recordingTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<V2VProvider>(
      builder: (context, v2vProvider, child) {
        final messages = v2vProvider.getMessages(widget.vehicle.endpointId);

        return Scaffold(
          backgroundColor: const Color(0xFF1A1A2E),
          appBar: AppBar(
            backgroundColor: const Color(0xFF16213E),
            leading: IconButton(
              icon: const Icon(Icons.arrow_back, color: Colors.white),
              onPressed: () => Navigator.pop(context),
            ),
            title: Row(
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: widget.vehicle.isConnected
                        ? Colors.greenAccent.withValues(alpha: 0.2)
                        : Colors.grey.withValues(alpha: 0.2),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Icon(
                    Icons.directions_car,
                    color: widget.vehicle.isConnected
                        ? Colors.greenAccent
                        : Colors.grey,
                    size: 24,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        widget.vehicle.deviceName,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 16,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      Text(
                        widget.vehicle.isConnected
                            ? 'Conectado'
                            : 'Desconectado',
                        style: TextStyle(
                          color: widget.vehicle.isConnected
                              ? Colors.greenAccent
                              : Colors.grey,
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            actions: [
              IconButton(
                icon: const Icon(Icons.more_vert, color: Colors.white),
                onPressed: () => _showOptionsMenu(context),
              ),
            ],
          ),
          body: Column(
            children: [
              // Quick message bar
              _buildQuickMessageBar(v2vProvider),

              // Messages list
              Expanded(
                child: messages.isEmpty
                    ? _buildEmptyChat()
                    : _buildMessagesList(messages),
              ),

              // Input area
              _buildInputArea(v2vProvider),
            ],
          ),
        );
      },
    );
  }

  Widget _buildQuickMessageBar(V2VProvider v2vProvider) {
    final quickMessages = [
      (QuickMessage.thanks, '👍', 'Gracias'),
      (QuickMessage.sorry, '🙏', 'Perdón'),
      (QuickMessage.hazardAhead, '⚠️', 'Peligro'),
      (QuickMessage.policeAhead, '👮', 'Policía'),
      (QuickMessage.trafficJam, '🚗', 'Tráfico'),
    ];

    return Container(
      height: 50,
      color: const Color(0xFF16213E),
      child: ListView.builder(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
        itemCount: quickMessages.length,
        itemBuilder: (context, index) {
          final (type, emoji, label) = quickMessages[index];
          return GestureDetector(
            onTap: () => v2vProvider.sendQuickMessage(
              widget.vehicle.endpointId,
              type,
            ),
            child: Container(
              margin: const EdgeInsets.only(right: 8),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              decoration: BoxDecoration(
                color: const Color(0xFF0F3460),
                borderRadius: BorderRadius.circular(20),
              ),
              child: Row(
                children: [
                  Text(emoji, style: const TextStyle(fontSize: 16)),
                  const SizedBox(width: 4),
                  Text(
                    label,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 12,
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _buildEmptyChat() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.chat_bubble_outline,
            size: 64,
            color: Colors.white.withValues(alpha: 0.3),
          ),
          const SizedBox(height: 16),
          Text(
            'Inicia la conversación',
            style: TextStyle(
              color: Colors.white.withValues(alpha: 0.5),
              fontSize: 16,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Envía un mensaje rápido o escribe algo',
            style: TextStyle(
              color: Colors.white.withValues(alpha: 0.3),
              fontSize: 12,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildMessagesList(List<V2VMessage> messages) {
    // Auto-scroll to bottom when new message
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOut,
        );
      }
    });

    return ListView.builder(
      controller: _scrollController,
      padding: const EdgeInsets.all(16),
      itemCount: messages.length,
      itemBuilder: (context, index) {
        final message = messages[index];
        final isMe = message.isOutgoing;
        return _buildMessageBubble(message, isMe);
      },
    );
  }

  Widget _buildMessageBubble(V2VMessage message, bool isMe) {
    return Align(
      alignment: isMe ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.only(bottom: 12),
        constraints: BoxConstraints(
          maxWidth: MediaQuery.of(context).size.width * 0.75,
        ),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: isMe ? Colors.greenAccent : const Color(0xFF16213E),
          borderRadius: BorderRadius.only(
            topLeft: const Radius.circular(16),
            topRight: const Radius.circular(16),
            bottomLeft: Radius.circular(isMe ? 16 : 4),
            bottomRight: Radius.circular(isMe ? 4 : 16),
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildMessageContent(message, isMe),
            const SizedBox(height: 4),
            Text(
              _formatTime(message.timestamp),
              style: TextStyle(
                color: isMe ? Colors.black54 : Colors.white54,
                fontSize: 10,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildMessageContent(V2VMessage message, bool isMe) {
    final payload = message.payload;

    switch (message.type) {
      case V2VMessageType.quickMessage:
        final quickIndex = payload is int ? payload : 0;
        final quickMessage = QuickMessage.values[quickIndex];
        return Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              quickMessage.displayText.split(' ').first,
              style: const TextStyle(fontSize: 24),
            ),
            const SizedBox(width: 8),
            Text(
              quickMessage.displayText.split(' ').skip(1).join(' '),
              style: TextStyle(
                color: isMe ? Colors.black87 : Colors.white,
                fontWeight: FontWeight.bold,
              ),
            ),
          ],
        );

      case V2VMessageType.voice:
        return Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.play_circle_fill,
              color: isMe ? Colors.black87 : Colors.white,
            ),
            const SizedBox(width: 8),
            Text(
              'Mensaje de voz',
              style: TextStyle(
                color: isMe ? Colors.black87 : Colors.white,
              ),
            ),
          ],
        );

      case V2VMessageType.emergency:
        return Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.emergency, color: Colors.red),
            const SizedBox(width: 8),
            Text(
              '⚠️ ${payload ?? "Emergencia"}',
              style: const TextStyle(
                color: Colors.red,
                fontWeight: FontWeight.bold,
              ),
            ),
          ],
        );

      default:
        return Text(
          payload?.toString() ?? '',
          style: TextStyle(
            color: isMe ? Colors.black87 : Colors.white,
          ),
        );
    }
  }

  Widget _buildInputArea(V2VProvider v2vProvider) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: const BoxDecoration(
        color: Color(0xFF16213E),
        borderRadius: BorderRadius.only(
          topLeft: Radius.circular(20),
          topRight: Radius.circular(20),
        ),
      ),
      child: SafeArea(
        child: Row(
          children: [
            // Voice message button
            GestureDetector(
              onLongPressStart: (_) => _startRecording(),
              onLongPressEnd: (_) => _stopRecording(v2vProvider),
              child: Container(
                width: 45,
                height: 45,
                decoration: BoxDecoration(
                  color: _isRecording
                      ? Colors.redAccent
                      : const Color(0xFF0F3460),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(
                  _isRecording ? Icons.mic : Icons.mic_none,
                  color: _isRecording ? Colors.white : Colors.grey,
                ),
              ),
            ),
            const SizedBox(width: 8),

            // Recording indicator or text input
            Expanded(
              child: _isRecording
                  ? Container(
                      height: 45,
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      decoration: BoxDecoration(
                        color: const Color(0xFF0F3460),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Row(
                        children: [
                          const Icon(Icons.mic, color: Colors.red),
                          const SizedBox(width: 8),
                          Text(
                            'Grabando... ${_recordingDuration}s',
                            style: const TextStyle(color: Colors.white),
                          ),
                        ],
                      ),
                    )
                  : Container(
                      height: 45,
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      decoration: BoxDecoration(
                        color: const Color(0xFF0F3460),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: TextField(
                        controller: _messageController,
                        style: const TextStyle(color: Colors.white),
                        decoration: const InputDecoration(
                          hintText: 'Escribe un mensaje...',
                          hintStyle: TextStyle(color: Colors.grey),
                          border: InputBorder.none,
                        ),
                        onSubmitted: (_) => _sendTextMessage(v2vProvider),
                      ),
                    ),
            ),
            const SizedBox(width: 8),

            // Send button
            GestureDetector(
              onTap: () => _sendTextMessage(v2vProvider),
              child: Container(
                width: 45,
                height: 45,
                decoration: BoxDecoration(
                  color: Colors.greenAccent,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Icon(
                  Icons.send,
                  color: Colors.white,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  void _startRecording() {
    setState(() {
      _isRecording = true;
      _recordingDuration = 0;
    });

    _recordingTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      setState(() {
        _recordingDuration++;
      });

      // Max 30 seconds
      if (_recordingDuration >= 30) {
        timer.cancel();
      }
    });

    // Start actual recording
    context.read<V2VProvider>().startVoiceRecording();
  }

  void _stopRecording(V2VProvider v2vProvider) {
    _recordingTimer?.cancel();

    if (_recordingDuration > 0) {
      v2vProvider.stopAndSendVoiceMessage(widget.vehicle.endpointId);
    }

    setState(() {
      _isRecording = false;
      _recordingDuration = 0;
    });
  }

  void _sendTextMessage(V2VProvider v2vProvider) {
    final text = _messageController.text.trim();
    if (text.isEmpty) return;

    v2vProvider.sendTextMessage(widget.vehicle.endpointId, text);
    _messageController.clear();
  }

  void _showOptionsMenu(BuildContext context) {
    showModalBottomSheet(
      context: context,
      backgroundColor: const Color(0xFF16213E),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.location_on, color: Colors.blueAccent),
              title: const Text(
                'Compartir ubicación',
                style: TextStyle(color: Colors.white),
              ),
              onTap: () {
                Navigator.pop(context);
                context.read<V2VProvider>().sendLocation(widget.vehicle.endpointId);
              },
            ),
            ListTile(
              leading: const Icon(Icons.block, color: Colors.redAccent),
              title: const Text(
                'Bloquear vehículo',
                style: TextStyle(color: Colors.white),
              ),
              onTap: () {
                Navigator.pop(context);
                // TODO: Implement blocking
              },
            ),
            ListTile(
              leading: const Icon(Icons.info_outline, color: Colors.grey),
              title: const Text(
                'Información del vehículo',
                style: TextStyle(color: Colors.white),
              ),
              onTap: () {
                Navigator.pop(context);
                _showVehicleInfo(context);
              },
            ),
          ],
        ),
      ),
    );
  }

  void _showVehicleInfo(BuildContext context) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: const Color(0xFF16213E),
        title: const Text(
          'Información del vehículo',
          style: TextStyle(color: Colors.white),
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _infoRow('ID', widget.vehicle.endpointId.substring(0, 8)),
            _infoRow('Nombre', widget.vehicle.deviceName),
            _infoRow(
              'Estado',
              widget.vehicle.isConnected ? 'Conectado' : 'Desconectado',
            ),
            if (widget.vehicle.lastKnownPosition != null) ...[
              _infoRow('Lat', widget.vehicle.lastKnownPosition!.latitude.toStringAsFixed(4)),
              _infoRow('Lng', widget.vehicle.lastKnownPosition!.longitude.toStringAsFixed(4)),
            ],
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cerrar'),
          ),
        ],
      ),
    );
  }

  Widget _infoRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Text(
            '$label: ',
            style: const TextStyle(color: Colors.grey),
          ),
          Text(
            value,
            style: const TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.bold,
            ),
          ),
        ],
      ),
    );
  }

  String _formatTime(DateTime time) {
    return '${time.hour.toString().padLeft(2, '0')}:${time.minute.toString().padLeft(2, '0')}';
  }
}
