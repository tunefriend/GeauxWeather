#!/usr/bin/env bash
# Install GeauxWeather tray + launcher for GNOME on Debian 13.
set -euo pipefail

INSTALL_DIR="${HOME}/.local/share/geauxweather-widget"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${HOME}/.local/share/applications"
AUTO_DIR="${HOME}/.config/autostart"
ICON_DIR="${HOME}/.local/share/icons/hicolor/128x128/apps"

need_cmd() { command -v "$1" >/dev/null 2>&1; }

install_deps_debian() {
  local missing=()
  dpkg -s python3-gi >/dev/null 2>&1 || missing+=(python3-gi)
  dpkg -s gir1.2-gtk-3.0 >/dev/null 2>&1 || missing+=(gir1.2-gtk-3.0)
  dpkg -s gir1.2-ayatanaappindicator3-0.1 >/dev/null 2>&1 || missing+=(gir1.2-ayatanaappindicator3-0.1)
  dpkg -s gnome-shell-extension-appindicator >/dev/null 2>&1 || missing+=(gnome-shell-extension-appindicator)
  if ((${#missing[@]})); then
    echo "Installing: ${missing[*]}"
    sudo apt-get update -qq
    sudo apt-get install -y "${missing[@]}"
  fi
}

echo "==> GeauxWeather Linux tray / launcher"

if ! need_cmd python3; then
  echo "Error: python3 is required." >&2
  exit 1
fi

if need_cmd apt-get; then
  install_deps_debian
else
  echo "Note: need python3-gi, GTK3, and Ayatana AppIndicator GIR packages."
fi

mkdir -p "${INSTALL_DIR}/icons" "${APP_DIR}" "${AUTO_DIR}" "${ICON_DIR}"

cp "${SCRIPT_DIR}/geauxweather_tray.py" "${INSTALL_DIR}/geauxweather_tray.py"
chmod +x "${INSTALL_DIR}/geauxweather_tray.py"

if [[ -f "${SCRIPT_DIR}/icons/geauxweather.png" ]]; then
  cp "${SCRIPT_DIR}/icons/geauxweather.png" "${INSTALL_DIR}/icons/geauxweather.png"
  cp "${SCRIPT_DIR}/icons/geauxweather.png" "${ICON_DIR}/geauxweather.png"
fi

# Applications menu — opens website directly (good for dash favorites / pin)
cat > "${APP_DIR}/geauxweather.desktop" <<EOF
[Desktop Entry]
Name=GeauxWeather
GenericName=Weather
Comment=Open GeauxWeather (live weather website)
Exec=xdg-open https://geauxweather.com
Icon=${ICON_DIR}/geauxweather.png
Terminal=false
Type=Application
Categories=Network;Utility;
Keywords=weather;forecast;radar;
StartupNotify=false
EOF

# Tray app — temperature in top bar, menu to open site
cat > "${APP_DIR}/geauxweather-tray.desktop" <<EOF
[Desktop Entry]
Name=GeauxWeather Tray
Comment=System tray weather + open GeauxWeather
Exec=/usr/bin/python3 ${INSTALL_DIR}/geauxweather_tray.py
Icon=${ICON_DIR}/geauxweather.png
Terminal=false
Type=Application
Categories=Network;Utility;
NoDisplay=true
StartupNotify=false
EOF

# Autostart tray at login (hidden from app grid)
cat > "${AUTO_DIR}/geauxweather-tray.desktop" <<EOF
[Desktop Entry]
Name=GeauxWeather Tray
Comment=System tray weather (background)
Exec=/usr/bin/python3 ${INSTALL_DIR}/geauxweather_tray.py
Icon=${ICON_DIR}/geauxweather.png
Terminal=false
Type=Application
NoDisplay=true
X-GNOME-Autostart-enabled=true
X-GNOME-Autostart-Delay=4
EOF

# Refresh icon cache if available
if need_cmd gtk-update-icon-cache; then
  gtk-update-icon-cache -f -t "${HOME}/.local/share/icons/hicolor" 2>/dev/null || true
fi

# Try enable AppIndicator extension (GNOME)
if need_cmd gnome-extensions; then
  # Common extension UUID on Debian
  for uuid in \
    ubuntu-appindicators@ubuntu.com \
    appindicatorsupport@rgcjonas.gmail.com
  do
    if gnome-extensions list 2>/dev/null | grep -qx "$uuid"; then
      gnome-extensions enable "$uuid" 2>/dev/null || true
      echo "Enabled GNOME extension: $uuid"
    fi
  done
fi

echo ""
echo "Installed to: ${INSTALL_DIR}"
echo ""
echo "What you got:"
echo "  1) Applications → GeauxWeather        (opens https://geauxweather.com)"
echo "  2) Applications → GeauxWeather Tray   (top-bar icon with temp)"
echo "  3) Tray autostarts at login"
echo ""
echo "Pin to the taskbar / dash:"
echo "  Open Activities, search GeauxWeather, right-click → Pin to Dash"
echo ""
echo "Start tray now:"
echo "  /usr/bin/python3 ${INSTALL_DIR}/geauxweather_tray.py &"
echo ""
echo "Note: The GNOME Quick Settings panel (Wired / VPN / …) only accepts"
echo "built-in tiles or a Shell extension. This tray icon lives in the"
echo "top bar status area (same place as other indicators)."
