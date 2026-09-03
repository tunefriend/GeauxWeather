#!/usr/bin/env bash
set -euo pipefail

rm -rf "${HOME}/.local/share/geauxweather-widget"
rm -f "${HOME}/.local/share/applications/geauxweather.desktop"
rm -f "${HOME}/.local/share/applications/geauxweather-tray.desktop"
rm -f "${HOME}/.config/autostart/geauxweather-tray.desktop"
rm -f "${HOME}/.config/autostart/geauxweather.desktop"
rm -f "${HOME}/.local/share/icons/hicolor/128x128/apps/geauxweather.png"
rm -f "${HOME}/.cache/geauxweather-widget.lock"
# keep ~/.config/geauxweather-widget (location prefs) unless --purge
if [[ "${1:-}" == "--purge" ]]; then
  rm -rf "${HOME}/.config/geauxweather-widget"
fi
echo "GeauxWeather tray/launcher removed."
