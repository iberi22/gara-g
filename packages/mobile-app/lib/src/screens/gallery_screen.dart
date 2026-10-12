import 'package:flutter/material.dart';
import 'video_editor_screen.dart';

class GalleryScreen extends StatelessWidget {
  const GalleryScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final List<String> mockVideos = [
      "clip_20231201_103005.mp4",
      "clip_20231201_111522.mp4",
      "protected_clip_1701423456.mp4",
    ];

    return Scaffold(
      backgroundColor: const Color(0xFF1A1A2E),
      appBar: AppBar(
        title: const Text('Sentinel Gallery'),
        backgroundColor: const Color(0xFF16213E),
        foregroundColor: Colors.white,
      ),
      body: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: mockVideos.length,
        itemBuilder: (context, index) {
          final videoName = mockVideos[index];
          return Card(
            key: Key('gallery_item_$index'),
            color: const Color(0xFF16213E),
            margin: const EdgeInsets.only(bottom: 12),
            child: ListTile(
              leading: const Icon(Icons.video_library, color: Colors.greenAccent),
              title: Text(videoName, style: const TextStyle(color: Colors.white)),
              subtitle: const Text("Duration: 0:30 • 15 MB", style: TextStyle(color: Colors.grey)),
              trailing: const Icon(Icons.chevron_right, color: Colors.white24),
              onTap: () {
                Navigator.push(
                  context,
                  MaterialPageRoute(
                    builder: (context) => VideoEditorScreen(videoPath: "/mock/path/$videoName"),
                  ),
                );
              },
            ),
          );
        },
      ),
    );
  }
}
