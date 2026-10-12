import 'dart:io';
import 'dart:async';
import 'dart:math';
import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:path/path.dart' as path;
import 'package:path_provider/path_provider.dart';
import 'package:wakelock_plus/wakelock_plus.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:vibration/vibration.dart';
import 'package:provider/provider.dart';
import 'package:gara_g_pilot/src/services/youtube_service.dart';
import 'package:gara_g_pilot/src/services/dms_service.dart';
import 'package:gara_g_pilot/src/services/adas_service.dart';
import 'package:gara_g_pilot/src/services/seatbelt_service.dart';
import 'package:gara_g_pilot/src/widgets/seatbelt_indicator.dart';
import 'package:gara_g_pilot/src/providers/adas_provider.dart';
import 'package:gara_g_pilot/src/screens/gallery_screen.dart';
import 'package:gara_g_pilot/src/services/voice_safety_agent.dart';
import 'package:gara_g_pilot/src/rust/api.dart';

class DashcamScreen extends StatefulWidget {
  const DashcamScreen({super.key});

  @override
  State<DashcamScreen> createState() => _DashcamScreenState();
}

class _DashcamScreenState extends State<DashcamScreen> with WidgetsBindingObserver {
  CameraController? _controller;
  bool _isRecording = false;
  bool _isEcoMode = false;
  bool _isNightMode = false;
  bool _isHUDMode = false;
  TelemetryDisplayData? _latestTelemetry;
  StreamSubscription? _telemetrySubscription;
  String _statusMessage = "Initializing...";
  XFile? _lastVideoFile;

  // DMS State
  late DmsService _dmsService;
  late VoiceSafetyAgent _voiceAgent;
  late SeatbeltService _seatbeltService;
  DmsStatus? _latestDmsStatus;
  StreamSubscription? _dmsSubscription;

  // Seatbelt State
  SeatbeltData? _latestSeatbelt;
  StreamSubscription? _seatbeltSubscription;

  // Transmission State
  bool _isUploading = false;
  final YouTubeService _youtubeService = YouTubeService();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);

    _voiceAgent = VoiceSafetyAgent();
    _voiceAgent.initialize();
    _seatbeltService = SeatbeltService(_voiceAgent);
    _dmsService = DmsService(_voiceAgent, _seatbeltService);

    _dmsSubscription = _dmsService.statusStream.listen((status) {
      if (mounted) {
        setState(() {
          _latestDmsStatus = status;
        });
      }
    });

    // Initialize SeatbeltService monitoring
    _seatbeltService.startMonitoring();
    _seatbeltSubscription = _seatbeltService.statusStream.listen((data) {
      if (mounted) {
        setState(() {
          _latestSeatbelt = data;
        });
      }
    });

    _checkPermissionsAndInitialize();
    _enableWakelock();
    _youtubeService.initialize();
    getTemporaryDirectory().then((dir) {
      initRecorder(appDir: dir.path);
    }).catchError((_) {
      initRecorder(appDir: '/tmp');
    });
    _startTelemetryUpdates();
  }

  void _startTelemetryUpdates() {
    _telemetrySubscription = Stream.periodic(const Duration(seconds: 1))
        .asyncMap((_) => getLatestTelemetry())
        .listen((data) {
      if (mounted) {
        setState(() {
          _latestTelemetry = data;
        });
      }
    });
  }

  Future<void> _enableWakelock() async {
    await WakelockPlus.enable();
  }

  Future<void> _disableWakelock() async {
    await WakelockPlus.disable();
  }

  Future<void> _checkPermissionsAndInitialize() async {
    Map<Permission, PermissionStatus> statuses = await [
      Permission.camera,
      Permission.microphone,
    ].request();

    if (statuses[Permission.camera] != PermissionStatus.granted ||
        statuses[Permission.microphone] != PermissionStatus.granted) {
      if (mounted) {
        setState(() => _statusMessage = "Permissions denied. Please enable in settings.");
      }
      return;
    }

    _initializeCamera();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final CameraController? cameraController = _controller;

    if (cameraController == null || !cameraController.value.isInitialized) {
      return;
    }

    if (state == AppLifecycleState.inactive) {
      cameraController.dispose();
    } else if (state == AppLifecycleState.resumed) {
      _initializeCamera();
    }
  }

  Future<void> _initializeCamera() async {
    try {
      final cameras = await availableCameras();
      if (cameras.isEmpty) {
        setState(() => _statusMessage = "No camera found");
        return;
      }

      final camera = cameras.first;

      _controller = CameraController(
        camera,
        ResolutionPreset.high,
        enableAudio: true,
        imageFormatGroup: Platform.isAndroid
            ? ImageFormatGroup.yuv420
            : ImageFormatGroup.bgra8888,
      );

      await _controller!.initialize();

      _startSentinelBuffer();

      if (mounted) {
        setState(() {
          _statusMessage = "Ready";
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() => _statusMessage = "Camera Error: $e");
      }
    }
  }

  void _startSentinelBuffer() {
    if (_controller == null || !_controller!.value.isInitialized) return;

    int frameCount = 0;
    _controller!.startImageStream((CameraImage image) {
      frameCount++;
      if (frameCount % 15 == 0) {
        final BytesBuilder builder = BytesBuilder();
        for (final Plane plane in image.planes) {
          builder.add(plane.bytes);
        }
        sendVideoChunk(chunk: builder.toBytes());
      }
    });
  }

  @override
  void dispose() {
    _dmsSubscription?.cancel();
    _dmsService.dispose();
    _seatbeltSubscription?.cancel();
    _seatbeltService.dispose();
    _voiceAgent.dispose();
    _disableWakelock();
    _telemetrySubscription?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    if (_isRecording) {
      stopDashcam();
    }
    _controller?.dispose();
    super.dispose();
  }

  Future<void> _toggleRecording() async {
    if (_controller == null || !_controller!.value.isInitialized) return;

    if (_isRecording) {
      try {
        await _controller!.stopImageStream();
        stopDashcam();

        final file = await _controller!.stopVideoRecording();
        setState(() {
          _isRecording = false;
          _lastVideoFile = file;
          _statusMessage = "Saved: ${path.basename(file.path)}";
        });

        await _uploadVideo(file);
      } catch (e) {
        setState(() => _statusMessage = "Stop Error: $e");
      }
    } else {
      try {
        await _controller!.startVideoRecording();
        startDashcam();

        await _controller!.startImageStream((CameraImage image) {
          final List<int> allBytes = [];
          for (var plane in image.planes) {
            allBytes.addAll(plane.bytes);
          }
          final uint8Bytes = Uint8List.fromList(allBytes);
          sendVideoChunk(chunk: uint8Bytes);

          if (mounted) {
            context.read<AdasProvider>().updateFromFrame(uint8Bytes);
          }
        });

        setState(() {
          _isRecording = true;
          _statusMessage = "Recording (Loop Active)...";
        });
      } catch (e) {
        setState(() => _statusMessage = "Start Error: $e");
      }
    }
  }

  Future<void> _uploadVideo(XFile file) async {
    if (!_youtubeService.isConfigured) {
      setState(() => _statusMessage = "Saved (YouTube Not Configured)");
      return;
    }

    setState(() {
      _isUploading = true;
      _statusMessage = "Uploading to YouTube (Private)...";
    });

    try {
      final success = await _youtubeService.uploadVideo(File(file.path));

      if (mounted) {
        setState(() {
          _statusMessage = success ? "Uploaded to YouTube" : "Upload Failed";
          _isUploading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _statusMessage = "Upload Error";
          _isUploading = false;
        });
      }
    }
  }

  void _showSettingsDialog() {
    final urlController = TextEditingController();

    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text("YouTube Settings"),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text("Configure Private Server Upload"),
            const SizedBox(height: 10),
            TextField(
              controller: urlController,
              decoration: const InputDecoration(labelText: "Upload URL (or Channel ID)"),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text("Cancel"),
          ),
          TextButton(
            onPressed: () {
              _youtubeService.saveSettings(urlController.text);
              Navigator.pop(context);
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text("Settings Saved"))
              );
            },
            child: const Text("Save"),
          ),
        ],
      ),
    );
  }

  void _toggleEcoMode() {
    setState(() {
      _isEcoMode = !_isEcoMode;
    });
    HapticFeedback.heavyImpact();
  }

  void _toggleHUDMode() {
    setState(() {
      _isHUDMode = !_isHUDMode;
    });
    HapticFeedback.mediumImpact();
  }

  void _protectCurrentBuffer() async {
    final timestamp = DateTime.now().millisecondsSinceEpoch;
    final protectedPath = "protected_clip_$timestamp.bin";

    await saveVideoBuffer(path: protectedPath);

    if (await Vibration.hasVibrator() ?? false) {
      Vibration.vibrate(duration: 200);
    }

    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text("CLIP PROTECTED"),
          backgroundColor: Colors.redAccent,
          duration: Duration(seconds: 2),
        ),
      );
    }
  }

  Widget _buildAdaptiveDashboard() {
    final speed = _latestTelemetry?.speed ?? 0.0;
    final isHighSpeed = speed > 30.0;

    if (isHighSpeed) {
      return Container(
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
        decoration: BoxDecoration(
          color: Colors.black87,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: Colors.greenAccent, width: 2),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              speed.toStringAsFixed(0),
              style: const TextStyle(
                color: Colors.white,
                fontSize: 64,
                fontWeight: FontWeight.bold,
              ),
            ),
            const Text(
              "KM/H",
              style: TextStyle(color: Colors.greenAccent, fontSize: 18),
            ),
          ],
        ),
      );
    } else {
      return Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: Colors.black54,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            _telemetryItem(Icons.speed, "${speed.toStringAsFixed(1)} km/h"),
            const SizedBox(width: 16),
            _telemetryItem(Icons.explore, "${_latestTelemetry?.heading.toStringAsFixed(0)}°"),
            const SizedBox(width: 16),
            _telemetryItem(Icons.battery_charging_full, "${_latestTelemetry?.battery.toStringAsFixed(0)}%"),
          ],
        ),
      );
    }
  }

  Widget _telemetryItem(IconData icon, String text) {
    return Row(
      children: [
        Icon(icon, color: Colors.greenAccent, size: 16),
        const SizedBox(width: 4),
        Text(text, style: const TextStyle(color: Colors.white, fontSize: 14)),
      ],
    );
  }

  void _toggleNightMode() async {
    if (_controller == null || !_controller!.value.isInitialized) return;

    setState(() {
      _isNightMode = !_isNightMode;
    });

    try {
      if (_isNightMode) {
        await _controller!.setExposureOffset(2.0);
        await _controller!.setFocusMode(FocusMode.auto);
      } else {
        await _controller!.setExposureOffset(0.0);
      }
    } catch (e) {
      debugPrint("Error setting night mode exposure: $e");
    }
  }

  Widget _buildDmsWarning(String label, Color color) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: color.withOpacity(0.8),
        borderRadius: BorderRadius.circular(4),
      ),
      child: Text(
        label,
        style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
      ),
    );
  }

  Widget _buildAdasOverlay(AdasState adas, Size previewSize) {
    return Stack(
      children: [
        if (adas.riskLevel == AdasRiskLevel.critical ||
            adas.activeAlerts.any((a) => a.severity == AdasAlertSeverity.emergency))
          const _FCWFlashOverlay(),

        if (adas.laneState.isDepartingLeft || adas.laneState.isDepartingRight)
          _LaneWarningOverlay(laneState: adas.laneState),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_controller == null || !_controller!.value.isInitialized) {
      return Scaffold(
        backgroundColor: Colors.black,
        appBar: AppBar(title: const Text('Dashcam Sentinel')),
        body: Center(child: Text(_statusMessage, style: const TextStyle(color: Colors.white))),
      );
    }

    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(
        children: [
          GestureDetector(
            onTap: () {
              if (_isRecording) {
                _protectCurrentBuffer();
              }
            },
            child: Center(
              child: CameraPreview(_controller!),
            ),
          ),

          Consumer<AdasProvider>(
            builder: (context, adasProvider, child) {
              return _buildAdasOverlay(
                adasProvider.state,
                _controller!.value.previewSize!,
              );
            },
          ),

        if (!_isEcoMode)
            SafeArea(
              child: ColorFiltered(
                colorFilter: _isNightMode
                    ? ColorFilter.mode(Colors.red.withOpacity(0.3), BlendMode.colorBurn)
                    : const ColorFilter.mode(Colors.transparent, BlendMode.dst),
                child: Stack(
                  children: [
                    Column(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Container(
                          padding: const EdgeInsets.all(16),
                          color: Colors.black54,
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              const Text(
                                "Sentinel Mode",
                                style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold),
                              ),
                              Row(
                                children: [
                                  IconButton(
                                    icon: const Icon(Icons.settings, color: Colors.white),
                                    onPressed: _showSettingsDialog,
                                    tooltip: "YouTube Settings",
                                  ),
                                  IconButton(
                                    icon: Icon(
                                      Icons.flip,
                                      color: _isHUDMode ? Colors.greenAccent : Colors.white,
                                    ),
                                    onPressed: _toggleHUDMode,
                                    tooltip: "HUD Mode",
                                  ),
                                  IconButton(
                                    icon: Icon(
                                      Icons.nightlight_round,
                                      color: _isNightMode ? Colors.red : Colors.white,
                                    ),
                                    onPressed: _toggleNightMode,
                                    tooltip: "Night Mode",
                                  ),
                                  IconButton(
                                    icon: const Icon(Icons.shield_moon, color: Colors.blueAccent),
                                    onPressed: _toggleEcoMode,
                                    tooltip: "Eco Mode (Black Screen)",
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),

                        if (_latestTelemetry != null)
                          _buildAdaptiveDashboard(),

                        if (_statusMessage.isNotEmpty)
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                            decoration: BoxDecoration(
                              color: Colors.black54,
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                if (_isUploading)
                                  const Padding(
                                    padding: EdgeInsets.only(right: 8.0),
                                    child: SizedBox(
                                      width: 12,
                                      height: 12,
                                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                                    ),
                                  ),
                                Text(
                                  _statusMessage,
                                  style: const TextStyle(color: Colors.white),
                                ),
                              ],
                            ),
                          ),

                        Container(
                          padding: const EdgeInsets.all(24),
                          decoration: const BoxDecoration(
                            gradient: LinearGradient(
                              colors: [Colors.transparent, Colors.black87],
                              begin: Alignment.topCenter,
                              end: Alignment.bottomCenter,
                            ),
                          ),
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                            children: [
                              GestureDetector(
                                key: const Key('dashcam_record_button'),
                                onTap: _toggleRecording,
                                child: Container(
                                  height: 80,
                                  width: 80,
                                  decoration: BoxDecoration(
                                    shape: BoxShape.circle,
                                    border: Border.all(color: Colors.white, width: 4),
                                  ),
                                  child: Container(
                                    margin: const EdgeInsets.all(4),
                                    decoration: BoxDecoration(
                                      shape: _isRecording ? BoxShape.rectangle : BoxShape.circle,
                                      borderRadius: _isRecording ? BorderRadius.circular(8) : null,
                                      color: _youtubeService.isConfigured ? Colors.red : Colors.orange,
                                    ),
                                  ),
                                ),
                              ),
                              if (!_isRecording && _lastVideoFile != null)
                                IconButton(
                                  key: const Key('dashcam_gallery_button'),
                                  icon: const Icon(Icons.video_collection, color: Colors.greenAccent, size: 40),
                                  onPressed: () {
                                    Navigator.push(
                                      context,
                                      MaterialPageRoute(builder: (_) => const GalleryScreen()),
                                    );
                                  },
                                ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    if (_latestDmsStatus != null)
                      Positioned(
                        top: 100,
                        left: 20,
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            if (_latestDmsStatus!.isDrowsy)
                              _buildDmsWarning("DROWSY", Colors.red),
                            if (_latestDmsStatus!.isDistracted)
                              _buildDmsWarning("DISTRACTED", Colors.orange),
                            if (_latestDmsStatus!.isYawning)
                              _buildDmsWarning("FATIGUE", Colors.yellow),
                            if (_latestSeatbelt?.status == SeatbeltStatus.unfastened)
                              _buildDmsWarning("SEATBELT!", Colors.redAccent),
                          ],
                        ),
                      ),

                    if (_latestSeatbelt != null)
                      Positioned(
                        top: 100,
                        right: 20,
                        child: SeatbeltIndicator(
                          seatbeltStream: _seatbeltService.statusStream,
                        ),
                      ),
                  ],
                ),
              ),
            ),

        if (_isEcoMode)
            GestureDetector(
              onDoubleTap: _toggleEcoMode,
              child: Container(
                color: Colors.black,
                width: double.infinity,
                height: double.infinity,
                child: Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(
                        _isRecording ? Icons.fiber_manual_record : Icons.videocam_off,
                        color: _isRecording ? Colors.red.withOpacity(0.5) : Colors.grey.withOpacity(0.5),
                        size: 48,
                      ),
                      const SizedBox(height: 16),
                      Text(
                        _isRecording ? "Recording & Syncing..." : "Eco Mode Active",
                        style: TextStyle(color: Colors.grey.withOpacity(0.5)),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        "Double tap to wake",
                        style: TextStyle(color: Colors.grey.withOpacity(0.3), fontSize: 12),
                      ),
                    ],
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _FCWFlashOverlay extends StatefulWidget {
  const _FCWFlashOverlay({super.key});

  @override
  State<_FCWFlashOverlay> createState() => _FCWFlashOverlayState();
}

class _FCWFlashOverlayState extends State<_FCWFlashOverlay>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 300),
    )..repeat(reverse: true);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        return Container(
          decoration: BoxDecoration(
            border: Border.all(
              color: Colors.red.withOpacity(_controller.value * 0.8),
              width: 10,
            ),
          ),
        );
      },
    );
  }
}

class _LaneWarningOverlay extends StatelessWidget {
  final LaneState laneState;

  const _LaneWarningOverlay({required this.laneState});

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        if (laneState.isDepartingLeft)
          Positioned(
            left: 0,
            top: 0,
            bottom: 0,
            width: 40,
            child: Container(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [Colors.orange.withOpacity(0.6), Colors.transparent],
                  begin: Alignment.centerLeft,
                  end: Alignment.centerRight,
                ),
              ),
              child: const Icon(Icons.arrow_back, color: Colors.white, size: 40),
            ),
          ),
        if (laneState.isDepartingRight)
          Positioned(
            right: 0,
            top: 0,
            bottom: 0,
            width: 40,
            child: Container(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [Colors.transparent, Colors.orange.withOpacity(0.6)],
                  begin: Alignment.centerLeft,
                  end: Alignment.centerRight,
                ),
              ),
              child: const Icon(Icons.arrow_forward, color: Colors.white, size: 40),
            ),
          ),
      ],
    );
  }
}
