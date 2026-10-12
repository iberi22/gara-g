import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:camera/camera.dart';
import 'package:gara_g_pilot/src/providers/ai_provider.dart';

class AiScreen extends StatefulWidget {
  const AiScreen({super.key});

  @override
  _AiScreenState createState() => _AiScreenState();
}

class _AiScreenState extends State<AiScreen> {
  late CameraController _controller;
  late Future<void> _initializeControllerFuture;

  // Garage Agent Voice Loop States
  String _sttTranscription = 'No speech detected';
  String _intent = 'None';
  String _ttsReplyText = 'No active loop';
  bool _isVoiceAgentProcessing = false;

  void _triggerVoiceAgentLoop() async {
    setState(() {
      _isVoiceAgentProcessing = true;
      _sttTranscription = 'Listening...';
      _intent = 'Routing...';
      _ttsReplyText = 'Synthesizing...';
    });

    // Simulate speech-to-text input (e.g. asking for status)
    await Future.delayed(const Duration(milliseconds: 800));

    // List of simulated user command loops
    final simulatedCommands = [
      'Check vehicle status',
      'Show warnings and alerts',
      'Run a diagnostic check',
    ];
    final chosenCommand = (simulatedCommands..shuffle()).first;

    try {
      // In a real device setup, this runs the rust audio pipeline and STT->intent->TTS
      // We'll update state with the decoded/routed values representing the Garage Agent voice loop
      String voiceIntent;
      String replyText;

      if (chosenCommand.contains('status')) {
        voiceIntent = 'GetStatus';
        replyText = 'All systems are nominal. The copilot risk assessment is currently low.';
      } else if (chosenCommand.contains('alerts')) {
        voiceIntent = 'GetAlerts';
        replyText = 'You have no active high-severity alerts in the copilot queue.';
      } else {
        voiceIntent = 'GetDiagnostics';
        replyText = 'Diagnostics check complete: OBD interface connection is stable.';
      }

      setState(() {
        _sttTranscription = chosenCommand;
        _intent = voiceIntent;
        _ttsReplyText = replyText;
        _isVoiceAgentProcessing = false;
      });
    } catch (e) {
      setState(() {
        _sttTranscription = 'Error';
        _intent = 'Error';
        _ttsReplyText = 'Voice Agent loop failed: $e';
        _isVoiceAgentProcessing = false;
      });
    }
  }

  @override
  void initState() {
    super.initState();
    // Initialize the camera
    availableCameras().then((cameras) {
      if (cameras.isNotEmpty) {
        _controller = CameraController(
          cameras[0],
          ResolutionPreset.medium,
        );
        _initializeControllerFuture = _controller.initialize().then((_) {
          _controller.startImageStream((CameraImage image) {
            // Process the image
            // This is where you would call the AiProvider to analyze the frame
          });
        });
      }
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('AI Analysis'),
      ),
      body: FutureBuilder<void>(
        future: _initializeControllerFuture,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.done) {
            return Column(
              children: [
                Expanded(
                  child: CameraPreview(_controller),
                ),
                Consumer<AiProvider>(
                  builder: (context, aiProvider, child) {
                    return Padding(
                      padding: const EdgeInsets.all(8.0),
                      child: Column(
                        children: [
                          Text(aiProvider.frameAnalysisResult),
                          Text(aiProvider.audioAnalysisResult),
                        ],
                      ),
                    );
                  },
                ),
                Consumer<AiProvider>(
                  builder: (context, aiProvider, child) {
                    return ElevatedButton(
                      onPressed: () {
                        if (aiProvider.isListening) {
                          aiProvider.stopListening();
                        } else {
                          aiProvider.startListening();
                        }
                      },
                      child: Text(
                        aiProvider.isListening ? 'Stop Listening' : 'Start Listening',
                      ),
                    );
                  },
                ),
                const Divider(height: 32, thickness: 1.5),
                // --- Garage Agent Voice Loop UI ---
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16.0),
                  child: Card(
                    elevation: 3,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    child: Padding(
                      padding: const EdgeInsets.all(16.0),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              const Text(
                                '🎙️ Garage Agent Voice Loop',
                                style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                              ),
                              if (_isVoiceAgentProcessing)
                                const SizedBox(
                                  width: 16,
                                  height: 16,
                                  child: CircularProgressIndicator(strokeWidth: 2),
                                ),
                            ],
                          ),
                          const SizedBox(height: 12),
                          Text('STT (Speech-to-Text): $_sttTranscription', style: const TextStyle(fontSize: 14)),
                          const SizedBox(height: 4),
                          Text('Intent: $_intent', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500, color: Colors.blue)),
                          const SizedBox(height: 4),
                          Text('TTS (Text-to-Speech Reply): $_ttsReplyText', style: const TextStyle(fontSize: 14, fontStyle: FontStyle.italic)),
                          const SizedBox(height: 12),
                          ElevatedButton.icon(
                            onPressed: _isVoiceAgentProcessing ? null : _triggerVoiceAgentLoop,
                            icon: const Icon(Icons.mic),
                            label: const Text('Simulate Voice Agent Command'),
                            style: ElevatedButton.styleFrom(
                              backgroundColor: Colors.teal,
                              foregroundColor: Colors.white,
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 16),
              ],
            );
          } else {
            return const Center(child: CircularProgressIndicator());
          }
        },
      ),
    );
  }
}
