#!/usr/bin/env bash
# Build a debug APK for PureSky
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> npm install (if needed)"
if [[ ! -d node_modules/@capacitor/core ]]; then
  npm install
fi

echo "==> Ensure Android platform"
if [[ ! -d android ]]; then
  npx cap add android
fi

echo "==> Sync web → android"
npx cap sync android

echo "==> Gradle assembleDebug"
cd android
./gradlew assembleDebug

APK="app/build/outputs/apk/debug/app-debug.apk"
echo ""
echo "APK ready:"
echo "  $ROOT/android/$APK"
echo ""
echo "Install:"
echo "  adb install -r $ROOT/android/$APK"
