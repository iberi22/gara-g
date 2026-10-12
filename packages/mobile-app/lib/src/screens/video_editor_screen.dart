import 'package:flutter/material.dart';

class VideoEditorScreen extends StatefulWidget {
  final String videoPath;
  const VideoEditorScreen({super.key, required this.videoPath});

  @override
  State<VideoEditorScreen> createState() => _VideoEditorScreenState();
}

class _VideoEditorScreenState extends State<VideoEditorScreen> {
  bool _hasOverlay = false;
  bool _isExporting = false;
  String _status = "Ready to edit";

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        title: const Text('Video Editor'),
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
      ),
      body: Column(
        children: [
          Expanded(
            flex: 3,
            child: Container(
              color: Colors.grey[900],
              child: Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Icon(Icons.movie, size: 100, color: Colors.white24),
                    const SizedBox(height: 16),
                    Text(
                      _hasOverlay ? "VIDEO WITH TELEMETRY OVERLAY" : "PREVIEW",
                      style: const TextStyle(color: Colors.white),
                    ),
                  ],
                ),
              ),
            ),
          ),
          Expanded(
            flex: 2,
            child: Padding(
              padding: const EdgeInsets.all(16.0),
              child: Column(
                children: [
                  Text(
                    _status,
                    style: TextStyle(
                      color: _isExporting ? Colors.greenAccent : Colors.white70,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 24),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                    children: [
                      ElevatedButton.icon(
                        key: const Key('editor_trim_button'),
                        onPressed: _isExporting ? null : () {
                          setState(() {
                            _status = "Trimming clip...";
                          });
                          Future.delayed(const Duration(seconds: 1), () {
                            if (mounted) {
                              setState(() {
                                _status = "Clip trimmed";
                              });
                            }
                          });
                        },
                        icon: const Icon(Icons.content_cut),
                        label: const Text("Trim"),
                      ),
                      Column(
                        children: [
                          const Text("Overlay", style: TextStyle(color: Colors.white, fontSize: 10)),
                          Switch(
                            key: const Key('editor_overlay_switch'),
                            value: _hasOverlay,
                            onChanged: (val) {
                              setState(() {
                                _hasOverlay = val;
                                _status = val ? "Telemetry added" : "Telemetry removed";
                              });
                            },
                          ),
                        ],
                      ),
                    ],
                  ),
                  const Spacer(),
                  SizedBox(
                    width: double.infinity,
                    height: 50,
                    child: ElevatedButton(
                      key: const Key('editor_export_button'),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: Colors.blueAccent,
                        foregroundColor: Colors.white,
                      ),
                      onPressed: _isExporting ? null : () {
                        setState(() {
                          _isExporting = true;
                          _status = "Exporting...";
                        });
                        Future.delayed(const Duration(seconds: 2), () {
                          if (mounted) {
                            setState(() {
                              _isExporting = false;
                              _status = "Export Complete!";
                            });
                            if (context.mounted) {
                              ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(content: Text("Video exported successfully")),
                              );
                            }
                          }
                        });
                      },
                      child: _isExporting
                        ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                        : const Text("EXPORT VIDEO"),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
