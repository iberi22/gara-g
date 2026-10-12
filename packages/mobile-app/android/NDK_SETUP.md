# Android NDK & Rust Setup for Gara-G

This guide explains how to set up your environment to build the native Rust components for the Gara-G mobile app.

## Prerequisites

### 1. Android NDK
The Android Native Development Kit (NDK) is required to compile Rust code for Android.

1.  Open Android Studio.
2.  Go to **Settings** (or **Preferences** on macOS) > **Languages & Frameworks** > **Android SDK**.
3.  Select the **SDK Tools** tab.
4.  Check **NDK (Side by side)** and **CMake**.
5.  Click **Apply** to install.
6.  Set the `ANDROID_NDK_HOME` environment variable to the path of your NDK installation.
    *   **Linux/macOS:** Add `export ANDROID_NDK_HOME=$HOME/Android/Sdk/ndk/<version>` to your `.bashrc` or `.zshrc`.
    *   **Windows:** Add `ANDROID_NDK_HOME` to your System Environment Variables with the value `C:\Users\<YourUser>\AppData\Local\Android\Sdk\ndk\<version>`.

### 2. Rust & Android Targets
Ensure you have Rust installed via [rustup](https://rustup.rs/).

Add the Android compilation targets:
```bash
rustup target add aarch64-linux-android
rustup target add armv7-linux-androideabi
rustup target add x86_64-linux-android
rustup target add i686-linux-android
```

### 3. cargo-ndk
Install the `cargo-ndk` tool, which simplifies compiling Rust for Android:
```bash
cargo install cargo-ndk
```

### 4. Flutter
Ensure you have the Flutter SDK installed and configured.
```bash
flutter doctor
```

## Building

Once everything is set up, you can use the one-shot build scripts in the root directory:

*   **Linux/macOS:** `./build-apk.sh`
*   **Windows:** `./build-apk.ps1`
