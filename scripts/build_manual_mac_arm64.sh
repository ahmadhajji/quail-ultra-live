#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="Quail Ultra"
APP_ID="com.ahmadhajji.quailultra"
ICON_SOURCE="$ROOT_DIR/branding/quail-ultra-icon-source.png"
ICONSET_DIR="$ROOT_DIR/dist/quail-ultra.iconset"
APP_VERSION="$(node -p "require('$ROOT_DIR/package.json').version")"
APP_DIR="$ROOT_DIR/dist/manual-mac-arm64/$APP_NAME.app"
RESOURCES_DIR="$APP_DIR/Contents/Resources"
PLIST_PATH="$APP_DIR/Contents/Info.plist"
ZIP_PATH="$ROOT_DIR/dist/$APP_NAME-$APP_VERSION-arm64.zip"
DMG_STAGE_DIR="$ROOT_DIR/dist/manual-mac-arm64/dmg-stage"
DMG_PATH="$ROOT_DIR/dist/$APP_NAME-$APP_VERSION-arm64.dmg"
ZIP_STAGE_DIR="$ROOT_DIR/dist/manual-mac-arm64/zip-stage"
PACKAGE_README_SOURCE="$ROOT_DIR/RELEASE_PACKAGE_README.txt"
PACKAGE_README_NAME="$APP_NAME Read Me.txt"

python3 "$ROOT_DIR/scripts/prepare_quail_ultra_icon.py"

rm -rf "$ROOT_DIR/dist/manual-mac-arm64"
mkdir -p "$ROOT_DIR/dist/manual-mac-arm64"
rm -rf "$ICONSET_DIR"
mkdir -p "$ICONSET_DIR"

sips -z 16 16 "$ICON_SOURCE" --out "$ICONSET_DIR/icon_16x16.png" >/dev/null
sips -z 32 32 "$ICON_SOURCE" --out "$ICONSET_DIR/icon_16x16@2x.png" >/dev/null
sips -z 32 32 "$ICON_SOURCE" --out "$ICONSET_DIR/icon_32x32.png" >/dev/null
sips -z 64 64 "$ICON_SOURCE" --out "$ICONSET_DIR/icon_32x32@2x.png" >/dev/null
sips -z 128 128 "$ICON_SOURCE" --out "$ICONSET_DIR/icon_128x128.png" >/dev/null
sips -z 256 256 "$ICON_SOURCE" --out "$ICONSET_DIR/icon_128x128@2x.png" >/dev/null
sips -z 256 256 "$ICON_SOURCE" --out "$ICONSET_DIR/icon_256x256.png" >/dev/null
sips -z 512 512 "$ICON_SOURCE" --out "$ICONSET_DIR/icon_256x256@2x.png" >/dev/null
sips -z 512 512 "$ICON_SOURCE" --out "$ICONSET_DIR/icon_512x512.png" >/dev/null
cp "$ICON_SOURCE" "$ICONSET_DIR/icon_512x512@2x.png"

iconutil -c icns "$ICONSET_DIR" -o "$ROOT_DIR/branding/quail-ultra.icns"

cp -R "$ROOT_DIR/node_modules/electron/dist/Electron.app" "$APP_DIR"

mkdir -p "$RESOURCES_DIR/app"
rsync -a \
  --delete \
  --exclude '/.git' \
  --exclude '/dist' \
  --exclude '/node_modules/electron/dist' \
  --exclude '/node_modules/.cache' \
  --exclude '/branding/quail-ultra.icns' \
  --exclude '/branding/quail-ultra.ico' \
  "$ROOT_DIR/" \
  "$RESOURCES_DIR/app/"

cp "$ROOT_DIR/branding/quail-ultra.icns" "$RESOURCES_DIR/quail-ultra.icns"

mv "$APP_DIR/Contents/MacOS/Electron" "$APP_DIR/Contents/MacOS/$APP_NAME"

/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName $APP_NAME" "$PLIST_PATH"
/usr/libexec/PlistBuddy -c "Set :CFBundleName $APP_NAME" "$PLIST_PATH"
/usr/libexec/PlistBuddy -c "Set :CFBundleExecutable $APP_NAME" "$PLIST_PATH"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $APP_ID" "$PLIST_PATH"
/usr/libexec/PlistBuddy -c "Set :CFBundleIconFile quail-ultra" "$PLIST_PATH"

rm -rf "$ZIP_STAGE_DIR"
mkdir -p "$ZIP_STAGE_DIR"
cp -R "$APP_DIR" "$ZIP_STAGE_DIR/"
cp "$PACKAGE_README_SOURCE" "$ZIP_STAGE_DIR/$PACKAGE_README_NAME"
rm -f "$ZIP_PATH"
ditto -c -k --sequesterRsrc --keepParent "$ZIP_STAGE_DIR" "$ZIP_PATH"

rm -rf "$DMG_STAGE_DIR"
mkdir -p "$DMG_STAGE_DIR"
cp -R "$APP_DIR" "$DMG_STAGE_DIR/"
cp "$PACKAGE_README_SOURCE" "$DMG_STAGE_DIR/$PACKAGE_README_NAME"
ln -s /Applications "$DMG_STAGE_DIR/Applications"
rm -f "$DMG_PATH"
hdiutil create \
  -volname "$APP_NAME" \
  -srcfolder "$DMG_STAGE_DIR" \
  -ov \
  -format UDZO \
  "$DMG_PATH" >/dev/null

echo "Built $APP_DIR"
echo "Built $ZIP_PATH"
echo "Built $DMG_PATH"
