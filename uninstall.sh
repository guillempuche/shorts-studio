#!/bin/sh
# Removes the shorts-studio binary that install.sh installed. It leaves your posts, settings and
# spend ledger in place (`shorts-studio config show` prints their folders).
#
#   curl -fsSL https://raw.githubusercontent.com/guillempuche/shorts-studio/main/uninstall.sh | sh
#
# SHORTS_INSTALL_DIR  where the binary was installed (default: ~/.local/bin)

set -eu

target="${SHORTS_INSTALL_DIR:-$HOME/.local/bin}/shorts-studio"
if [ -f "$target" ]; then
	rm "$target"
	echo "Removed $target. Your posts and settings were left in place."
else
	echo "No shorts-studio at $target (set SHORTS_INSTALL_DIR if you installed it elsewhere)."
fi
