#!/bin/sh
# Downloads the shorts-studio binary for macOS or Linux from GitHub Releases, checks its SHA-256
# and installs it.
#
#   curl -fsSL https://raw.githubusercontent.com/guillempuche/shorts-studio/main/install.sh | sh
#
# SHORTS_VERSION      a release tag to install, e.g. v0.2.0 (default: the latest)
# SHORTS_INSTALL_DIR  where to put the binary (default: ~/.local/bin, no sudo needed)
#
# Adapted from github.com/guillempuche/text-to-speech's installer.

set -eu

REPO="guillempuche/shorts-studio"
BINARY="shorts-studio"
INSTALL_DIR="${SHORTS_INSTALL_DIR:-$HOME/.local/bin}"

if [ -t 1 ]; then GREEN='\033[0;32m' YELLOW='\033[1;33m' RED='\033[0;31m' NC='\033[0m'; else GREEN='' YELLOW='' RED='' NC=''; fi
info() { printf "${GREEN}[info]${NC} %s\n" "$1"; }
warn() { printf "${YELLOW}[warn]${NC} %s\n" "$1"; }
fail() { printf "${RED}[error]${NC} %s\n" "$1" >&2; exit 1; }

TMP_DIR=""
trap '[ -n "$TMP_DIR" ] && rm -rf "$TMP_DIR"' EXIT

fetch() {
	if command -v curl >/dev/null 2>&1; then curl -fsSL "$1" -o "$2"
	elif command -v wget >/dev/null 2>&1; then wget -q "$1" -O "$2"
	else fail "Install curl or wget first."; fi
}

case "$(uname -s)" in
	Darwin) os=macos ;;
	Linux) os=linux ;;
	*) fail "Unsupported system $(uname -s). On Windows use install.ps1." ;;
esac
case "$(uname -m)" in
	x86_64 | amd64) arch=x64 ;;
	arm64 | aarch64) arch=arm64 ;;
	*) fail "Unsupported architecture $(uname -m)." ;;
esac
asset="$BINARY-$os-$arch"

version="${SHORTS_VERSION:-}"
if [ -z "$version" ]; then
	TMP_DIR=$(mktemp -d)
	fetch "https://api.github.com/repos/$REPO/releases/latest" "$TMP_DIR/latest.json"
	version=$(sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' "$TMP_DIR/latest.json" | head -1)
	[ -n "$version" ] || fail "Couldn't find the latest release of $REPO."
fi
[ -n "$TMP_DIR" ] || TMP_DIR=$(mktemp -d)
info "Installing $BINARY $version for $os ($arch)"

base="https://github.com/$REPO/releases/download/$version"
fetch "$base/$asset" "$TMP_DIR/$asset"
fetch "$base/checksums.txt" "$TMP_DIR/checksums.txt"

expected=$(grep " $asset\$" "$TMP_DIR/checksums.txt" | cut -d' ' -f1)
[ -n "$expected" ] || fail "checksums.txt has no entry for $asset."
if command -v sha256sum >/dev/null 2>&1; then actual=$(sha256sum "$TMP_DIR/$asset" | cut -d' ' -f1)
else actual=$(shasum -a 256 "$TMP_DIR/$asset" | cut -d' ' -f1); fi
[ "$actual" = "$expected" ] || fail "Checksum mismatch for $asset: the download is corrupt or was tampered with."
info "Checksum verified"

mkdir -p "$INSTALL_DIR"
chmod +x "$TMP_DIR/$asset"
mv "$TMP_DIR/$asset" "$INSTALL_DIR/$BINARY"
info "Installed $INSTALL_DIR/$BINARY"

case ":$PATH:" in
	*":$INSTALL_DIR:"*) ;;
	*) warn "$INSTALL_DIR isn't on your PATH. Add it to your shell profile: export PATH=\"$INSTALL_DIR:\$PATH\"" ;;
esac
echo
info "Next: $BINARY doctor   (it checks ffmpeg, which needs libass for captions, and your API keys)"
info "Docs: https://github.com/$REPO#readme"
