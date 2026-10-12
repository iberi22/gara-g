// Stub for frb_generated.dart to satisfy analyzer and tests without requiring compiled FRB binaries

class RustLib {
  static final instance = RustLib._();
  RustLib._();

  static Future<void> init() async {}

  dynamic get api => DummyApi();
}

class DummyApi {
  @override
  dynamic noSuchMethod(Invocation invocation) {
    return Future.value(null);
  }
}
