#!/usr/bin/env bash
# Builds "Orbit Lab.app" into build/. Needs Node (for the web bundle) and the Xcode command line tools.
# Usage: bash scripts/build-mac.sh [--open]
set -euo pipefail
cd "$(dirname "$0")/.."

APP="build/Orbit Lab.app"
echo "› Bundling the web app"
node scripts/build-web.mjs

echo "› Compiling the Mac shell"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/web/dist"
swiftc -O -swift-version 5 -target "$(uname -m)-apple-macos13.0" \
  -framework AppKit -framework WebKit \
  mac/Sources/main.swift mac/Sources/AppDelegate.swift \
  -o "$APP/Contents/MacOS/Orbit Lab"

cp mac/Info.plist "$APP/Contents/Info.plist"
cp web/index.html web/styles.css "$APP/Contents/Resources/web/"
cp web/dist/app.js "$APP/Contents/Resources/web/dist/"

echo "› Drawing the icon"
ICONSET="build/AppIcon.iconset"
rm -rf "$ICONSET" && mkdir -p "$ICONSET"
swift mac/MakeIcon.swift build/icon-1024.png
for s in 16 32 128 256 512; do
  sips -z $s $s build/icon-1024.png --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  sips -z $((s * 2)) $((s * 2)) build/icon-1024.png --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"

# Ad-hoc signature so macOS will launch it locally.
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || true

echo "✓ Built $APP"
if [[ "${1:-}" == "--open" ]]; then open "$APP"; fi
