#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$SCRIPT_DIR/.."
APP_NAME="Command Center"
APP_SRC="$ROOT/dist/mac-arm64/$APP_NAME.app"
APP_DEST="/Applications/$APP_NAME.app"
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"

# Remove any previously installed LaunchAgent so the app no longer auto-launches
PLIST_DEST="$HOME/Library/LaunchAgents/com.matthewwayles.commandcenter.launcher.plist"
if [ -f "$PLIST_DEST" ]; then
  echo "→ Removing LaunchAgent…"
  launchctl unload "$PLIST_DEST" 2>/dev/null || true
  rm -f "$PLIST_DEST"
fi

if [ ! -d "$APP_SRC" ]; then
  echo "Error: $APP_SRC not found. Run 'npm run dist' first."
  exit 1
fi

if pgrep -x "$APP_NAME" >/dev/null 2>&1; then
  echo "→ Quitting running $APP_NAME instance…"
  pkill -x "$APP_NAME" 2>/dev/null || true
  sleep 2
fi

echo "→ Installing $APP_NAME.app to /Applications…"
rm -rf "$APP_DEST"
cp -R "$APP_SRC" "$APP_DEST"

echo "→ Registering with Launch Services…"
"$LSREGISTER" -f "$APP_DEST"

echo "→ Launching $APP_NAME…"
/usr/bin/open "$APP_DEST"

echo "✓ Done."
