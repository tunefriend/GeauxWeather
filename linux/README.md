# GeauxWeather Linux tray

System tray weather + launcher for **https://geauxweather.com**.

Works on **all major Linux desktops** with a system tray / status area:
**GNOME, KDE Plasma, XFCE, Cinnamon, MATE, Budgie, LXQt**, and others that
support AppIndicator / StatusNotifierItem.

## Quick install (Debian / Ubuntu)

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

- **Panel / tray icon** with weather condition + temperature (AppIndicator)
- **Units** in the tray menu: Celsius or Fahrenheit
- Menu: open website · refresh · quit
- **App menu → GeauxWeather** starts the tray (if already running, opens the website)
- Autostart at login (standard XDG autostart)

## Desktop notes

| Desktop | Tray location | Extra setup |
|---------|---------------|-------------|
| GNOME | Top bar | AppIndicator extension (auto-installed on Debian/Ubuntu) |
| KDE Plasma | System tray | Native — none |
| XFCE | Notification area | Native — none |
| Cinnamon / MATE / Budgie / LXQt | Panel tray | Native — none |

## Requirements

- `python3`, `python3-gi` (PyGObject), GTK 3
- Ayatana AppIndicator (or AppIndicator3) GIR bindings
- `python3-pil` recommended (temperature icon drawing)
- On Debian/Ubuntu, `install.sh` installs these with apt

Other distros (examples):

```bash
# Fedora
sudo dnf install python3-gobject gtk3 libappindicator-gtk3 python3-pillow

# Arch
sudo pacman -S python-gobject gtk3 libayatana-appindicator python-pillow
```

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
  "units": "celsius"
}
```

Weather: [Open-Meteo](https://open-meteo.com/) (no API key).

## Update / reinstall

```bash
curl -fsSL https://geauxweather.com/linux/install.sh | bash
# restart tray (quit from tray menu, or):
killall geauxweather_tray.py 2>/dev/null || true
python3 ~/.local/share/geauxweather-widget/geauxweather_tray.py &
```

The installer works when piped from curl (no need to copy files into your home directory first).
