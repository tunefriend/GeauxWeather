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
TRAY_URL="${GEAUXWEATHER_TRAY_URL:-https://geauxweather.com/linux/geauxweather-linux-tray.tar.gz?v=202609030434}"

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
  # Progress must go to stderr — stdout is captured into SCRIPT_DIR
  echo "==> Downloading tray package…" >&2
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
mkdir -p "${HOME}/.config/geauxweather-widget"

cp "${SCRIPT_DIR}/geauxweather_tray.py" "${INSTALL_DIR}/geauxweather_tray.py"
chmod +x "${INSTALL_DIR}/geauxweather_tray.py"

if [[ -f "${SCRIPT_DIR}/icons/geauxweather.png" ]]; then
  cp "${SCRIPT_DIR}/icons/geauxweather.png" "${INSTALL_DIR}/icons/geauxweather.png"
  cp "${SCRIPT_DIR}/icons/geauxweather.png" "${ICON_DIR}/geauxweather.png"
fi

# Seed config.json once (do not overwrite user prefs on reinstall)
CFG="${HOME}/.config/geauxweather-widget/config.json"
if [[ ! -f "$CFG" ]]; then
  echo "==> Creating default config (locale units + network location)…"
  GEO_JSON=""
  if need_cmd curl; then
    GEO_JSON="$(curl -fsSL --max-time 6 https://geauxweather.com/api/geo 2>/dev/null || true)"
  elif need_cmd wget; then
    GEO_JSON="$(wget -qO- --timeout=6 https://geauxweather.com/api/geo 2>/dev/null || true)"
  fi
  GEO_JSON="$GEO_JSON" CFG="$CFG" LANG_ALL="${LC_ALL:-}${LC_MESSAGES:-}${LANG:-}" python3 <<'PY'
import json, os
path = os.environ["CFG"]
lang = (os.environ.get("LANG_ALL") or "").lower()
units = "fahrenheit" if "en_us" in lang else "celsius"
cfg = {
    "lat": 30.5021,
    "lon": -90.7476,
    "label": "Location unset — use Detect my location",
    "units": units,
    "source": "fallback",
}
raw = os.environ.get("GEO_JSON") or ""
try:
    d = json.loads(raw) if raw.strip() else {}
except Exception:
    d = {}
lat, lon = d.get("lat"), d.get("lon")
if lat is not None and lon is not None:
    label = d.get("label") or d.get("city") or d.get("country") or f"{float(lat):.2f}, {float(lon):.2f}"
    cfg = {
        "lat": float(lat),
        "lon": float(lon),
        "label": str(label),
        "units": units,
        "source": "ip-geo",
    }
open(path, "w", encoding="utf-8").write(json.dumps(cfg, indent=2) + "\n")
print("    Wrote", path)
print("    Location:", cfg["label"], f"({cfg['units']})")
PY
else
  echo "==> Keeping existing config: ${CFG}"
fi

# Applications menu — one launcher (starts tray; if already running, opens website)
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

# Remove legacy duplicate app entry (older installs)
rm -f "${APP_DIR}/geauxweather-tray.desktop"

# Single autostart entry only (older installs had two and showed two icons)
rm -f "${AUTO_DIR}/geauxweather.desktop"
cat > "${AUTO_DIR}/geauxweather-tray.desktop" <<EOF
[Desktop Entry]
Name=GeauxWeather
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
echo "Config: ${HOME}/.config/geauxweather-widget/config.json"
echo ""
echo "Start the tray:"
echo "  /usr/bin/python3 ${INSTALL_DIR}/geauxweather_tray.py &"
echo ""
echo "Tray menu → Location (detect / search city) · Units (°C / °F)"
echo "Only one autostart entry is installed (duplicate legacy entries removed)."
echo ""
echo "Website: https://geauxweather.com"
