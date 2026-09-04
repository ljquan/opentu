#!/usr/bin/env bash
set -euo pipefail

REPO="${OPENTU_REPO:-ljquan/opentu}"
REF="${OPENTU_REF:-main}"
INSTALL_DIR="${OPENTU_INSTALL_DIR:-$HOME/.opentu/app}"
BIN_DIR="${OPENTU_BIN_DIR:-$HOME/.local/bin}"
BIN_PATH="$BIN_DIR/opentu"
MACOS_APP_DIR="${OPENTU_MACOS_APP_DIR:-}"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

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

ensure_safe_install_dir() {
  case "$INSTALL_DIR" in
    ""|"/"|"$HOME"|"$HOME/"|"/Applications"|"/usr"|"/usr/local"|"/opt")
      fail "Refusing unsafe OPENTU_INSTALL_DIR: $INSTALL_DIR"
      ;;
  esac
}

ensure_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    return
  fi

  need_cmd corepack
  info "Enabling pnpm with Corepack ..."
  corepack enable pnpm

  command -v pnpm >/dev/null 2>&1 || fail "pnpm is still unavailable after corepack enable"
}

download_source() {
  local archive="$TMP_DIR/opentu.tar.gz"
  local source_dir="$TMP_DIR/source"
  local url="https://github.com/${REPO}/archive/${REF}.tar.gz"

  need_cmd curl
  need_cmd tar

  info "Downloading Opentu source from ${REPO}@${REF} ..."
  curl -fL --retry 3 --connect-timeout 15 "$url" -o "$archive"

  mkdir -p "$source_dir"
  tar -xzf "$archive" -C "$source_dir" --strip-components=1

  [[ -f "$source_dir/package.json" ]] || fail "Downloaded archive does not look like Opentu source"
  [[ -f "$source_dir/pnpm-lock.yaml" ]] || fail "Downloaded archive is missing pnpm-lock.yaml"

  mkdir -p "$(dirname "$INSTALL_DIR")"
  rm -rf "$INSTALL_DIR"
  mkdir -p "$INSTALL_DIR"

  info "Installing source to $INSTALL_DIR ..."
  (cd "$source_dir" && tar -cf - .) | (cd "$INSTALL_DIR" && tar -xf -)
}

install_dependencies() {
  ensure_pnpm

  info "Installing dependencies ..."
  cd "$INSTALL_DIR"
  pnpm install --frozen-lockfile
}

write_launcher() {
  mkdir -p "$BIN_DIR"

  cat > "$BIN_PATH" <<EOF
#!/usr/bin/env bash
set -euo pipefail

cd "$INSTALL_DIR"

if command -v open >/dev/null 2>&1; then
  (sleep 2 && open "http://localhost:7200") >/dev/null 2>&1 &
elif command -v xdg-open >/dev/null 2>&1; then
  (sleep 2 && xdg-open "http://localhost:7200") >/dev/null 2>&1 &
fi

exec pnpm start
EOF

  chmod +x "$BIN_PATH"
}

create_macos_app() {
  [[ "$(uname -s)" == "Darwin" ]] || return

  local app_root="$MACOS_APP_DIR"
  if [[ -z "$app_root" ]]; then
    app_root="/Applications"
    [[ -w "$app_root" ]] || app_root="$HOME/Applications"
  fi

  local app_path="$app_root/Opentu.app"
  local contents="$app_path/Contents"
  local macos="$contents/MacOS"
  local resources="$contents/Resources"

  mkdir -p "$macos" "$resources"

  cat > "$contents/Info.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>opentu</string>
  <key>CFBundleIdentifier</key>
  <string>ai.opentu.launcher</string>
  <key>CFBundleName</key>
  <string>Opentu</string>
  <key>CFBundleDisplayName</key>
  <string>Opentu</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>11.0</string>
  <key>LSUIElement</key>
  <true/>
</dict>
</plist>
EOF

  cat > "$macos/opentu" <<EOF
#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$INSTALL_DIR"
LOG_DIR="\$HOME/.opentu"
LOG_FILE="\$LOG_DIR/opentu.log"
URL="http://localhost:7200"

mkdir -p "\$LOG_DIR"
cd "\$APP_DIR"

if ! curl -fsS --max-time 2 "\$URL" >/dev/null 2>&1; then
  nohup pnpm start >"\$LOG_FILE" 2>&1 &
fi

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

  chmod +x "$macos/opentu"
  xattr -dr com.apple.quarantine "$app_path" 2>/dev/null || true

  info "macOS app created at $app_path"
}

print_next_steps() {
  printf '\n'
  info "Opentu installed successfully."
  printf '\n'
  printf 'Run:\n'
  printf '  %s\n' "$BIN_PATH"
  printf '\n'

  case ":$PATH:" in
    *":$BIN_DIR:"*) ;;
    *)
      warn "$BIN_DIR is not in PATH."
      printf 'Add it to your shell profile, for example:\n'
      printf '  echo '\''export PATH="$HOME/.local/bin:$PATH"'\'' >> ~/.zshrc\n'
      printf '  source ~/.zshrc\n'
      printf '\n'
      ;;
  esac

  printf 'Then open:\n'
  printf '  http://localhost:7200\n'

  if [[ "$(uname -s)" == "Darwin" ]]; then
    printf '\n'
    printf 'macOS app:\n'
    if [[ -n "$MACOS_APP_DIR" ]]; then
      printf '  %s/Opentu.app\n' "$MACOS_APP_DIR"
    elif [[ -w "/Applications" ]]; then
      printf '  /Applications/Opentu.app\n'
    else
      printf '  %s/Applications/Opentu.app\n' "$HOME"
    fi
  fi
}

main() {
  if [[ "${OPENTU_DRY_RUN:-0}" == "1" ]]; then
    info "Dry run"
    printf 'Repo: %s\n' "$REPO"
    printf 'Ref: %s\n' "$REF"
    printf 'Install dir: %s\n' "$INSTALL_DIR"
    printf 'Launcher: %s\n' "$BIN_PATH"
    return
  fi

  ensure_safe_install_dir
  download_source
  install_dependencies
  write_launcher
  create_macos_app
  print_next_steps
}

main "$@"
