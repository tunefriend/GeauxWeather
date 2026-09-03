#!/usr/bin/env bash
# Install GeauxWeather tray + launcher for Linux desktops (GNOME, KDE, XFCE,
# Cinnamon, MATE, Budgie, LXQt, and any DE with AppIndicator/StatusNotifier).
#
# Works both as:
#   curl -fsSL https://geauxweather.com/linux/install.sh | bash
#   bash install.sh   (from an extracted tarball / git checkout)
set -euo pipefail

INSTALL_DIR="${HOME}/.local/share/geauxweather-widget"
APP_DIR="${HOME}/.local/share/applications"
AUTO_DIR="${HOME}/.config/autostart"
ICON_DIR="${HOME}/.local/share/icons/hicolor/128x128/apps"
TRAY_URL="${GEAUXWEATHER_TRAY_URL:-https://geauxweather.com/linux/geauxweather-linux-tray.tar.gz}"

need_cmd() { command -v "$1" >/dev/null 2>&1; }

# Resolve SCRIPT_DIR even when piped through `curl | bash` (BASH_SOURCE unset).
resolve_script_dir() {
  local src="${BASH_SOURCE[0]:-}"
  if [[ -n "$src" && "$src" != "bash" && "$src" != "-" && -f "$src" ]]; then
    cd "$(dirname "$src")" && pwd
    return
  fi
  # Piped / remote install — download the tray package
  local tmp
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/geauxweather-install.XXXXXX")"
  echo "==> Downloading tray package…"
  if need_cmd curl; then
    curl -fsSL "$TRAY_URL" -o "${tmp}/tray.tgz"
  elif need_cmd wget; then
    wget -qO "${tmp}/tray.tgz" "$TRAY_URL"
  else
    echo "Error: need curl or wget to download the tray package." >&2
    exit 1
  fi
  tar -xzf "${tmp}/tray.tgz" -C "$tmp"
  if [[ -d "${tmp}/geauxweather-widget" ]]; then
    echo "${tmp}/geauxweather-widget"
  else
    # tarball may extract files flat
    echo "$tmp"
  fi
}

SCRIPT_DIR="$(resolve_script_dir)"

if [[ ! -f "${SCRIPT_DIR}/geauxweather_tray.py" ]]; then
  echo "Error: geauxweather_tray.py not found in ${SCRIPT_DIR}" >&2
  echo "Try: curl -fsSL https://geauxweather.com/linux/install.sh | bash" >&2
  exit 1
fi

desktop_session() {
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
  dpkg -s python3-pil >/dev/null 2>&1 || missing+=(python3-pil)
  # Tray weather marks are drawn with Pillow (no emoji / icon font required).

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
echo "    Source: ${SCRIPT_DIR}"

if ! need_cmd python3; then
  echo "Error: python3 is required." >&2
  exit 1
fi

if need_cmd apt-get; then
  install_deps_debian
else
  echo "Note: install python3-gi (PyGObject), GTK 3, Ayatana AppIndicator, and Pillow for your distro."
  echo "  e.g. Fedora: python3-gobject gtk3 libappindicator-gtk3 python3-pillow google-noto-emoji-fonts"
  echo "  e.g. Arch:   python-gobject gtk3 libayatana-appindicator python-pillow noto-fonts-emoji"
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
Comment=Show temperature + condition in the panel / tray
Exec=/usr/bin/python3 ${INSTALL_DIR}/geauxweather_tray.py
Icon=${ICON_DIR}/geauxweather.png
Terminal=false
Type=Application
Categories=Utility;Network;
Keywords=weather;forecast;radar;tray;
StartupNotify=false
EOF

cat > "${APP_DIR}/geauxweather-tray.desktop" <<EOF
[Desktop Entry]
Name=GeauxWeather Tray
Comment=System tray weather + open GeauxWeather
Exec=/usr/bin/python3 ${INSTALL_DIR}/geauxweather_tray.py
Icon=${ICON_DIR}/geauxweather.png
Terminal=false
Type=Application
NoDisplay=true
EOF

cat > "${AUTO_DIR}/geauxweather-tray.desktop" <<EOF
[Desktop Entry]
Name=GeauxWeather Tray
Comment=System tray weather (background)
Exec=/usr/bin/python3 ${INSTALL_DIR}/geauxweather_tray.py
Icon=${ICON_DIR}/geauxweather.png
Terminal=false
Type=Application
X-GNOME-Autostart-enabled=true
EOF

if need_cmd gtk-update-icon-cache; then
  gtk-update-icon-cache -f -t "${HOME}/.local/share/icons/hicolor" 2>/dev/null || true
fi

if is_gnome_like && need_cmd gnome-extensions; then
  gnome-extensions enable appindicatorsupport@rgcjonas.gmail.com 2>/dev/null || true
fi

echo ""
echo "Installed to ${INSTALL_DIR}"
echo ""
echo "Start the tray:"
echo "  /usr/bin/python3 ${INSTALL_DIR}/geauxweather_tray.py &"
echo ""
echo "Or open GeauxWeather from your app menu (starts the tray)."
echo "Tray menu → Units for °C / °F. Icon shows condition + temperature."
echo ""
echo "Website: https://geauxweather.com"
