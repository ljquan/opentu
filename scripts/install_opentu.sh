#!/usr/bin/env bash
set -euo pipefail

REPO="${OPENTU_REPO:-ljquan/opentu}"
TAG="${OPENTU_TAG:-latest}"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Darwin)
    case "$ARCH" in
      arm64|aarch64) FILE="Opentu-macos-aarch64.dmg" ;;
      x86_64)        FILE="Opentu-macos-x86_64.dmg" ;;
      *)             echo "Unsupported macOS arch: $ARCH" >&2; exit 1 ;;
    esac
    ;;
  Linux)
    case "$ARCH" in
      x86_64|amd64)  FILE="Opentu-linux-x86_64.AppImage" ;;
      aarch64|arm64) FILE="Opentu-linux-aarch64.AppImage" ;;
      *)             echo "Unsupported Linux arch: $ARCH" >&2; exit 1 ;;
    esac
    ;;
  *)
    echo "Unsupported OS: $OS" >&2
    exit 1
    ;;
esac

if [[ "$TAG" == "latest" ]]; then
  DOWNLOAD_URL="https://github.com/${REPO}/releases/latest/download/${FILE}"
else
  DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${TAG}/${FILE}"
fi

echo "Downloading $FILE ..."
curl -fL "$DOWNLOAD_URL" -o "$TMP_DIR/$FILE"

case "$(echo "$FILE" | tr '[:upper:]' '[:lower:]')" in
  *.dmg)
    MOUNT_DIR="$(mktemp -d)"
    hdiutil attach "$TMP_DIR/$FILE" -mountpoint "$MOUNT_DIR" -nobrowse -quiet
    app_path="$(find "$MOUNT_DIR" -name '*.app' -maxdepth 1 | head -n 1)"
    if [[ -z "${app_path:-}" ]]; then
      hdiutil detach "$MOUNT_DIR" -quiet || true
      echo "No .app found in DMG" >&2
      exit 1
    fi
    dest_dir="/Applications"
    [[ ! -w "$dest_dir" ]] && dest_dir="$HOME/Applications"
    mkdir -p "$dest_dir"
    app_name="$(basename "$app_path")"
    rm -rf "$dest_dir/$app_name"
    ditto "$app_path" "$dest_dir/$app_name"
    hdiutil detach "$MOUNT_DIR" -quiet || true
    xattr -dr com.apple.quarantine "$dest_dir/$app_name" 2>/dev/null || true
    echo "Installed to $dest_dir/$app_name"
    ;;
  *.appimage)
    install_root="$HOME/.local/share/opentu"
    bin_root="$HOME/.local/bin"
    install_path="$install_root/opentu.AppImage"
    mkdir -p "$install_root" "$bin_root"
    mv "$TMP_DIR/$FILE" "$install_path"
    chmod +x "$install_path"
    ln -sf "$install_path" "$bin_root/opentu"
    echo "Installed to $install_path"
    echo "Symlink created at $bin_root/opentu"
    ;;
esac