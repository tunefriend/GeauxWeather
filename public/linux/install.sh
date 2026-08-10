#!/usr/bin/env bash
# One-line install: curl -fsSL https://geauxweather.com/linux/install.sh | bash
set -euo pipefail
TMP=$(mktemp -d)
cd "$TMP"
curl -fsSL "https://geauxweather.com/linux/geauxweather-linux-tray.tar.gz" -o tray.tgz
tar -xzf tray.tgz
cd geauxweather-widget
bash install.sh
echo ""
echo "Start tray now:"
echo "  python3 ~/.local/share/geauxweather-widget/geauxweather_tray.py &"
