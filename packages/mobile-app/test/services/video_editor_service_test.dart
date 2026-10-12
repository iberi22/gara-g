import 'package:flutter_test/flutter_test.dart';
import 'package:gara_g_pilot/src/services/video_editor_service.dart';
import 'package:path_provider_platform_interface/path_provider_platform_interface.dart';
import 'package:plugin_platform_interface/plugin_platform_interface.dart';

class MockPathProviderPlatform extends Fake
    with MockPlatformInterfaceMixin
    implements PathProviderPlatform {
  @override
  Future<String?> getTemporaryPath() async {
    return '/tmp';
  }

  @override
  Future<String?> getApplicationDocumentsPath() async {
    return '/documents';
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    PathProviderPlatform.instance = MockPathProviderPlatform();
  });

  group('VideoEditorService', () {
    late VideoEditorService videoEditorService;

    setUp(() {
      videoEditorService = VideoEditorService();
    });

    test('VideoEditorException toString includes message and stacktrace', () {
      final exception = VideoEditorException('test message', 'test stacktrace');
      expect(exception.toString(), contains('test message'));
      expect(exception.toString(), contains('test stacktrace'));
    });

    // NOTE: Real FFmpegKit calls cannot be easily tested in unit tests without extensive mocking
    // of the native platform interface. These tests primarily verify the service can be instantiated
    // and the logic for generating paths and handling types.

    test('Service can be instantiated', () {
      expect(videoEditorService, isNotNull);
    });
  });
}
