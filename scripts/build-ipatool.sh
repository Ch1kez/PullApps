#!/usr/bin/env bash
#
# build-ipatool.sh — build a patched `ipatool` that carries the fix for Apple's
# June 2026 `26HOTFIX24` App Store auth-endpoint change.
#
# WHY THIS EXISTS (temporary):
#   Apple moved the App Store auth endpoint in June 2026. Homebrew's released
#   ipatool (v2.3.0) still hits the stale endpoint and fails login with an
#   empty-200 "something went wrong" — which also breaks downloads. The fix is
#   upstream PR majd/ipatool#490 (open, not yet merged/released). We vendor it
#   as patches/ipatool-auth-endpoint.patch applied to a pinned upstream commit.
#
#   >>> Once #490 (or an equivalent fix) ships in a Homebrew release, DELETE
#   >>> this script, patches/, and the bundling step in build-app.sh, and go
#   >>> back to plain `brew install ipatool`. Tracking: majd/ipatool#437.
#
# WHAT IT DOES:
#   Clones majd/ipatool at the pinned base commit, applies the vendored patch,
#   builds, and writes the binary to:
#     - $OUT (default: build/ipatool), for build-app.sh to bundle into the .app
#     - ~/Library/Application Support/ipatool-gui/bin/ipatool (dev override that
#       app.go's findTool checks), unless SKIP_INSTALL=1
#
# Requirements: git, go (1.21+). MIT-licensed source (majd/ipatool).
set -euo pipefail

# --- pinned upstream base; the vendored patch is generated against this commit.
IPATOOL_REPO="https://github.com/majd/ipatool.git"
IPATOOL_BASE_SHA="dcddce4650d49d64aaff1b0785d76de01f5227af"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PATCH="$REPO_ROOT/patches/ipatool-auth-endpoint.patch"
OUT="${OUT:-$REPO_ROOT/build/ipatool}"
APP_SUPPORT_BIN="$HOME/Library/Application Support/ipatool-gui/bin/ipatool"

command -v go  >/dev/null || { echo "error: 'go' not found (needs Go 1.21+)" >&2; exit 1; }
command -v git >/dev/null || { echo "error: 'git' not found" >&2; exit 1; }
[ -f "$PATCH" ] || { echo "error: patch not found: $PATCH" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "==> Cloning majd/ipatool @ $IPATOOL_BASE_SHA"
git clone --quiet "$IPATOOL_REPO" "$WORK/ipatool"
git -C "$WORK/ipatool" checkout --quiet "$IPATOOL_BASE_SHA"

echo "==> Applying $(basename "$PATCH")"
git -C "$WORK/ipatool" apply "$PATCH"

echo "==> Building (GOOS/GOARCH = host)"
mkdir -p "$(dirname "$OUT")"
( cd "$WORK/ipatool" && go build -trimpath -o "$OUT" . )
echo "==> Built: $OUT"

if [ "${SKIP_INSTALL:-0}" != "1" ]; then
  mkdir -p "$(dirname "$APP_SUPPORT_BIN")"
  cp "$OUT" "$APP_SUPPORT_BIN"
  chmod +x "$APP_SUPPORT_BIN"
  echo "==> Installed dev override: $APP_SUPPORT_BIN"
fi

echo "Done."
