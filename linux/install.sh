#!/usr/bin/env bash
# Install GeauxWeather tray + launcher for Linux desktops (GNOME, KDE, XFCE,
# Cinnamon, MATE, Budgie, LXQt, and any DE with AppIndicator/StatusNotifier).
set -euo pipefail

INSTALL_DIR="${HOME}/.local/share/geauxweather-widget"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${HOME}/.local/share/applications"
AUTO_DIR="${HOME}/.config/autostart"
ICON_DIR="${HOME}/.local/share/icons/hicolor/128x128/apps"

need_cmd() { command -v "$1" >/dev/null 2>&1; }

desktop_session() {
  # e.g. "GNOME", "KDE", "XFCE", "X-Cinnamon", "MATE", "Budgie:GNOME", "LXQt"
  echo "${XDG_CURRENT_DESKTOP:-${DESKTOP_SESSION:-unknown}}"
}

is_gnome_like() {
  local d
  d="$(desktop_session | tr '[:lower:]' '[:upper:]')"
  [[ "$d" == *GNOME* || "$d" == *UNITY* || "$d" == *BUDGIE* ]]
}

install_deps_debian() {
  local missing=()
  dpkg -s python3-gi >/dev/null 2>&1 || missing+=(python3-gi)
  dpkg -s gir1.2-gtk-3.0 >/dev/null 2>&1 || missing+=(gir1.2-gtk-3.0)
  dpkg -s gir1.2-ayatanaappindicator3-0.1 >/dev/null 2>&1 || missing+=(gir1.2-ayatanaappindicator3-0.1)
  # Pillow used for drawing the temp icon (optional but recommended)
  dpkg -s python3-pil >/dev/null 2>&1 || missing+=(python3-pil)

  # GNOME hides tray icons unless the AppIndicator extension is present
  if is_gnome_like; then
    dpkg -s gnome-shell-extension-appindicator >/dev/null 2>&1 || missing+=(gnome-shell-extension-appindicator)
  fi

  if ((${#missing[@]})); then
    echo "Installing: ${missing[*]}"
    sudo apt-get update -qq
    sudo apt-get install -y "${missing[@]}"
  fi
}

echo "==> GeauxWeather Linux tray / launcher"
echo "    Desktop session: $(desktop_session)"

if ! need_cmd python3; then
  echo "Error: python3 is required." >&2
  exit 1
fi

if need_cmd apt-get; then
  install_deps_debian
else
  echo "Note: install python3-gi (PyGObject), GTK 3, and Ayatana AppIndicator GIR packages for your distro."
  echo "  e.g. Fedora: python3-gobject gtk3 libappindicator-gtk3 python3-pillow"
  echo "  e.g. Arch:   python-gobject gtk3 libayatana-appindicator python-pillow"
fi

mkdir -p "${INSTALL_DIR}/icons" "${APP_DIR}" "${AUTO_DIR}" "${ICON_DIR}"

cp "${SCRIPT_DIR}/geauxweather_tray.py" "${INSTALL_DIR}/geauxweather_tray.py"
chmod +x "${INSTALL_DIR}/geauxweather_tray.py"

if [[ -f "${SCRIPT_DIR}/icons/geauxweather.png" ]]; then
  cp "${SCRIPT_DIR}/icons/geauxweather.png" "${INSTALL_DIR}/icons/geauxweather.png"
  cp "${SCRIPT_DIR}/icons/geauxweather.png" "${ICON_DIR}/geauxweather.png"
fi

# Applications menu — starts the tray (temp in top bar). If already running, opens the website.
cat > "${APP_DIR}/geauxweather.desktop" <<EOF
[Desktop Entry]
Name=GeauxWeather
GenericName=Weather
Comment=Show temperature in the panel / tray (click again to open website)
Exec=/usr/bin/python3 ${INSTALL_DIR}/geauxweather_tray.py
Icon=${ICON_DIR}/geauxweather.png
Terminal=false
Type=Application
Categories=Network;Utility;
Keywords=weather;forecast;radar;tray;
StartupNotify=false
EOF

# Hidden alias (same command) for older install paths / docs
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

# Autostart tray at login (XDG — GNOME, KDE, XFCE, Cinnamon, MATE, etc.)
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
X-KDE-autostart-after=panel
EOF

# Refresh icon cache if available
if need_cmd gtk-update-icon-cache; then
  gtk-update-icon-cache -f -t "${HOME}/.local/share/icons/hicolor" 2>/dev/null || true
fi

# GNOME only: enable AppIndicator extension so tray icons appear in the top bar
if need_cmd gnome-extensions && is_gnome_like; then
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
echo "  1) App menu → GeauxWeather   (starts tray; if already running, opens website)"
echo "  2) Panel / tray temperature icon"
echo "  3) Autostart at login (XDG)"
echo ""
echo "Desktop tips:"
echo "  • GNOME: top bar (needs AppIndicator extension — installed on Debian/Ubuntu)"
echo "  • KDE Plasma: system tray in the panel"
echo "  • XFCE / Cinnamon / MATE / Budgie / LXQt: notification area / status tray"
echo "  After Quit, open GeauxWeather from the app menu to start the tray again."
echo ""
echo "Start tray now:"
echo "  /usr/bin/python3 ${INSTALL_DIR}/geauxweather_tray.py &"
echo ""
