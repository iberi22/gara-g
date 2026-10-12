#!/bin/bash
# GARA-G Pilot One-Shot Build Script
set -e

echo "🚀 Starting GARA-G Pilot Build Process..."

# 1. Environment Check
echo "📦 Checking environment..."
if ! command -v flutter &> /dev/null; then
    echo "❌ Flutter not found. Please install Flutter SDK."
    exit 1
fi

if ! command -v cargo &> /dev/null; then
    echo "❌ Rust/Cargo not found. Please install Rust."
    exit 1
fi

# 2. Rust Targets for Android
echo "🦀 Adding Rust Android targets..."
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android

# 3. Generate Flutter Rust Bridge code
echo "⚙️ Generating Flutter Rust Bridge code..."
cd packages/mobile-app
if command -v flutter_rust_bridge_codegen &> /dev/null; then
    flutter_rust_bridge_codegen generate
else
    echo "⚠️ flutter_rust_bridge_codegen not found. Assuming code is already generated or using pre-build artifacts."
fi

# 4. Patch known issues (Compatibility fix for Dart 3.7+)
echo "🩹 Applying compatibility patches..."
PINENACL_PATH="/home/jules/.pub-cache/hosted/pub.dev/pinenacl-0.5.1/lib/api/api.dart"
if [ -f "$PINENACL_PATH" ]; then
    sed -i 's/UnmodifiableUint8ListView/Uint8List/g' "$PINENACL_PATH"
    sed -i 's/return Uint8List(Uint8List.fromList(data.toList()));/return Uint8List.fromList(data.toList());/g' "$PINENACL_PATH"
    echo "✅ pinenacl patched."
fi

# 5. Build Flutter APK
echo "🏗️ Building Flutter APK (Debug mode for CI/Sandbox)..."
# We use debug because release requires signing keys usually not present in CI environments
flutter build apk --debug

echo "✅ Build Complete!"
echo "📍 APK Location: packages/mobile-app/build/app/outputs/flutter-apk/app-debug.apk"
