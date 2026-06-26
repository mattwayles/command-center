#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$SCRIPT_DIR/.."
APP_NAME="Command Center"
APP_SRC="$ROOT/dist/mac-arm64/$APP_NAME.app"
APP_DEST="/Applications/$APP_NAME.app"
PLIST_NAME="com.matthewwayles.commandcenter.launcher"
PLIST_SRC="$SCRIPT_DIR/$PLIST_NAME.plist"
PLIST_DEST="$HOME/Library/LaunchAgents/$PLIST_NAME.plist"
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"

# --- Legacy cleanup: remove the old "Tasks" install (renamed to Command Center) ---
OLD_APP="/Applications/Tasks.app"
OLD_PLIST="$HOME/Library/LaunchAgents/com.matthewwayles.tasks.launcher.plist"

if pgrep -x "Tasks" >/dev/null 2>&1; then
  echo "→ Quitting old Tasks instance…"
  pkill -x "Tasks" 2>/dev/null || true
  sleep 2
fi
if [ -f "$OLD_PLIST" ]; then
  echo "→ Removing old LaunchAgent…"
  launchctl unload "$OLD_PLIST" 2>/dev/null || true
  rm -f "$OLD_PLIST"
fi
if [ -d "$OLD_APP" ]; then
  echo "→ Removing old Tasks.app…"
  rm -rf "$OLD_APP"
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

echo "→ Installing LaunchAgent…"
mkdir -p "$HOME/Library/LaunchAgents"
cp "$PLIST_SRC" "$PLIST_DEST"

# Unload first in case it was previously loaded, then reload
launchctl unload "$PLIST_DEST" 2>/dev/null || true
launchctl load "$PLIST_DEST"

echo "→ Relaunching $APP_NAME…"
/usr/bin/open -g "$APP_DEST"

echo "✓ Done. $APP_NAME will launch at login and within 60 s of every wake from sleep."
