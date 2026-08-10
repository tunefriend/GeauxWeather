# GeauxWeather Linux tray (GNOME / Debian)

System tray weather + launcher for **https://geauxweather.com**.

## Quick install (Debian / Ubuntu / GNOME)

```bash
curl -fsSL https://geauxweather.com/linux/install.sh | bash
python3 ~/.local/share/geauxweather-widget/geauxweather_tray.py &
```

Or download: https://geauxweather.com/linux/geauxweather-linux-tray.tar.gz

```bash
tar -xzf geauxweather-linux-tray.tar.gz
cd geauxweather-widget
bash install.sh
```

## What you get

- **Top-bar tray icon** with temperature (AppIndicator)
- Menu: open website · refresh · quit
- **Applications → GeauxWeather** opens the website
- Autostart at login

## Requirements

- GNOME (or any desktop with AppIndicator / StatusNotifier support)
- `python3`, `python3-gi`, GTK 3
- `gir1.2-ayatanaappindicator3-0.1` (installed by `install.sh` on Debian/Ubuntu)
- GNOME extension **AppIndicator and KStatusNotifierItem Support** (package `gnome-shell-extension-appindicator` on Debian)

## Uninstall

```bash
bash uninstall.sh
# remove config too:
bash uninstall.sh --purge
```

## Config

`~/.config/geauxweather-widget/config.json`

```json
{
  "lat": 30.5021,
  "lon": -90.7476,
  "label": "Livingston, LA",
  "units": "fahrenheit"
}
```

Weather: [Open-Meteo](https://open-meteo.com/) (no API key).
