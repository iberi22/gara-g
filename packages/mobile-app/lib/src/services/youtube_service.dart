import 'dart:io';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:googleapis/youtube/v3.dart' as youtube;
import 'package:googleapis_auth/auth_io.dart';
import 'package:googleapis_auth/googleapis_auth.dart';
import 'package:http/http.dart' as http;

class YouTubeService {
  static final YouTubeService _instance = YouTubeService._internal();
  factory YouTubeService() => _instance;
  YouTubeService._internal();

  final _storage = const FlutterSecureStorage();
  String? _accessToken;

  // Keys for storage
  static const String kAccessToken = 'youtube_access_token';

  Future<void> initialize() async {
    _accessToken = await _storage.read(key: kAccessToken);
  }

  Future<void> saveSettings(String accessToken) async {
    await _storage.write(key: kAccessToken, value: accessToken);
    _accessToken = accessToken;
  }

  bool get isConfigured => _accessToken != null && _accessToken!.isNotEmpty;

  /// Uploads a video file to YouTube using the Data API v3
  /// Requires a valid OAuth 2.0 Access Token with 'https://www.googleapis.com/auth/youtube.upload' scope.
  Future<bool> uploadVideo(File videoFile) async {
    if (!isConfigured) {
      print("YouTube Service not configured.");
      return false;
    }

    try {
      final fileSize = await videoFile.length();
      print("Starting upload of ${videoFile.path} (${(fileSize / 1024 / 1024).toStringAsFixed(2)} MB) to YouTube...");

      // Create an authenticated HTTP client using the stored access token
      final authClient = authenticatedClient(
        http.Client(),
        AccessCredentials(
          AccessToken(
            'Bearer',
            _accessToken!,
            DateTime.now().add(const Duration(hours: 1)).toUtc(), // Assume valid for now
          ),
          null, // No refresh token stored here for simplicity
          ['https://www.googleapis.com/auth/youtube.upload'],
        ),
      );

      final ytApi = youtube.YouTubeApi(authClient);

      // Create video metadata
      final video = youtube.Video()
        ..snippet = (youtube.VideoSnippet()
          ..title = "Dashcam - ${DateTime.now()}"
          ..description = "Auto-uploaded from Gara-G Dashcam"
          ..tags = ["dashcam", "gara-g"]
          ..categoryId = "2") // Autos & Vehicles
        ..status = (youtube.VideoStatus()
          ..privacyStatus = "private"); // Private by default

      // Create media stream
      final media = youtube.Media(
        videoFile.openRead(),
        fileSize,
        contentType: 'video/mp4', // Adjust if needed
      );

      // Upload
      final response = await ytApi.videos.insert(
        video,
        ['snippet', 'status'],
        uploadMedia: media,
      );

      print("Upload complete! Video ID: ${response.id}");
      authClient.close();
      return true;
    } catch (e) {
      print("YouTube Upload Error: $e");
      // Handle token expiration logic here in a real app
      return false;
    }
  }
}
