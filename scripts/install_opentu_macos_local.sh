#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This installer is for macOS only." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_NAME="${OPENTU_APP_NAME:-Opentu Dev}"
INSTALL_DIR="${OPENTU_INSTALL_DIR:-$HOME/.opentu/macos-app}"
APP_PARENT_DIR="${OPENTU_APP_DIR:-$HOME/Applications}"
PORT="${OPENTU_PORT:-7200}"
DIST_SRC="$ROOT_DIR/dist/apps/web"
DIST_DST="$INSTALL_DIR/dist"
APP_PATH="$APP_PARENT_DIR/$APP_NAME.app"
RUN_BUILD="${OPENTU_SKIP_BUILD:-0}"

info() {
  printf '\033[1;34m%s\033[0m\n' "$1"
}

warn() {
  printf '\033[1;33m%s\033[0m\n' "$1" >&2
}

fail() {
  printf '\033[1;31m%s\033[0m\n' "$1" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

ensure_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    return
  fi

  need_cmd corepack
  info "Enabling pnpm with Corepack ..."
  corepack enable pnpm
  command -v pnpm >/dev/null 2>&1 || fail "pnpm is still unavailable"
}

ensure_safe_dir() {
  local dir="$1"
  case "$dir" in
    ""|"/"|"$HOME"|"$HOME/"|"/Applications"|"/System"|"/usr"|"/usr/local"|"/opt")
      fail "Refusing unsafe directory: $dir"
      ;;
  esac
}

build_web() {
  if [[ "$RUN_BUILD" == "1" ]]; then
    warn "Skipping build because OPENTU_SKIP_BUILD=1"
  else
    ensure_pnpm
    info "Building current local Opentu web app ..."
    (cd "$ROOT_DIR" && pnpm build:web)
  fi

  [[ -f "$DIST_SRC/index.html" ]] || fail "Build output missing: $DIST_SRC/index.html"
}

copy_dist() {
  ensure_safe_dir "$INSTALL_DIR"
  info "Installing built files to $INSTALL_DIR ..."
  rm -rf "$INSTALL_DIR"
  mkdir -p "$DIST_DST"
  ditto "$DIST_SRC" "$DIST_DST"
}

write_launcher() {
  need_cmd python3

  local contents="$APP_PATH/Contents"
  local macos="$contents/MacOS"
  local resources="$contents/Resources"

  mkdir -p "$macos" "$resources"

  cat > "$contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>opentu-dev</string>
  <key>CFBundleIdentifier</key>
  <string>ai.opentu.dev.local</string>
  <key>CFBundleName</key>
  <string>$APP_NAME</string>
  <key>CFBundleDisplayName</key>
  <string>$APP_NAME</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.9.9-dev</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>11.0</string>
  <key>LSUIElement</key>
  <true/>
</dict>
</plist>
EOF

  cat > "$macos/opentu-dev" <<EOF
#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="$INSTALL_DIR"
DIST_DIR="\$INSTALL_DIR/dist"
PORT="\${OPENTU_PORT:-$PORT}"
URL="http://localhost:\$PORT/"
LOG_DIR="\$HOME/.opentu/logs"
LOG_FILE="\$LOG_DIR/opentu-dev-\$PORT.log"
PID_FILE="\$LOG_DIR/opentu-dev-\$PORT.pid"

mkdir -p "\$LOG_DIR"

if curl -fsS --max-time 2 "\$URL" >/dev/null 2>&1; then
  open "\$URL"
  exit 0
fi

if [[ -f "\$PID_FILE" ]]; then
  OLD_PID="\$(cat "\$PID_FILE" 2>/dev/null || true)"
  if [[ -n "\$OLD_PID" ]] && kill -0 "\$OLD_PID" >/dev/null 2>&1; then
    kill "\$OLD_PID" >/dev/null 2>&1 || true
  fi
fi

cd "\$DIST_DIR"
nohup python3 -m http.server "\$PORT" --bind 127.0.0.1 --directory "\$DIST_DIR" >"\$LOG_FILE" 2>&1 &
echo "\$!" > "\$PID_FILE"

for _ in {1..60}; do
  if curl -fsS --max-time 2 "\$URL" >/dev/null 2>&1; then
    open "\$URL"
    exit 0
  fi
  sleep 1
done

open "\$URL"
exit 0
EOF

  chmod +x "$macos/opentu-dev"
  xattr -dr com.apple.quarantine "$APP_PATH" 2>/dev/null || true
}

print_next_steps() {
  printf '\n'
  info "Installed $APP_NAME successfully."
  printf 'App: %s\n' "$APP_PATH"
  printf 'URL: http://localhost:%s/\n' "$PORT"
  printf '\n'
  printf 'Open it with:\n'
  printf '  open "%s"\n' "$APP_PATH"
  printf '\n'
  printf 'Useful options:\n'
  printf '  OPENTU_PORT=7300 %s\n' "$0"
  printf '  OPENTU_SKIP_BUILD=1 %s\n' "$0"
}

main() {
  need_cmd ditto
  ensure_safe_dir "$INSTALL_DIR"
  mkdir -p "$APP_PARENT_DIR"
  build_web
  copy_dist
  write_launcher
  print_next_steps
}

main "$@"
