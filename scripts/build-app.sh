#!/usr/bin/env bash
#
# build-app.sh — produce a self-contained PullApps.app.
#
# Steps:
#   1. Build the patched ipatool (see build-ipatool.sh for the why) into build/ipatool.
#   2. wails build — produces build/bin/PullApps.app.
#   3. Copy the patched ipatool into the app bundle at
#      Contents/Resources/bin/ipatool. app.go's findTool checks that path, so a
#      copied/distributed .app runs without Homebrew or Go installed.
#
# Usage: scripts/build-app.sh [extra wails build args...]
#
# NOTE (temporary): the bundling exists only to ship the June 2026 auth fix
# ahead of upstream. Once majd/ipatool#490 lands in a Homebrew release, drop the
# ipatool build + the copy step and just `wails build`. Tracking: majd/ipatool#437.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

IPATOOL_BIN="$REPO_ROOT/build/ipatool"
APP="$REPO_ROOT/build/bin/PullApps.app"

command -v wails >/dev/null || { echo "error: 'wails' not found (go install github.com/wailsapp/wails/v2/cmd/wails@latest)" >&2; exit 1; }

echo "==> [1/3] Building patched ipatool"
# Don't also clobber the dev override here; we only need the bundle copy.
OUT="$IPATOOL_BIN" SKIP_INSTALL=1 "$REPO_ROOT/scripts/build-ipatool.sh"

echo "==> [2/3] wails build"
wails build "$@"

echo "==> [3/3] Bundling ipatool into the .app"
[ -d "$APP" ] || { echo "error: app not found at $APP" >&2; exit 1; }
RES_BIN="$APP/Contents/Resources/bin"
mkdir -p "$RES_BIN"
cp "$IPATOOL_BIN" "$RES_BIN/ipatool"
chmod +x "$RES_BIN/ipatool"
echo "==> Bundled: $RES_BIN/ipatool"

echo "Done: $APP"
