#!/usr/bin/env python3
"""GeauxWeather tray / mini-panel for Linux desktops.

Works with any DE that supports AppIndicator / StatusNotifier
(GNOME, KDE Plasma, XFCE, Cinnamon, MATE, Budgie, LXQt, …).

Preferred: Ayatana AppIndicator in the panel / status area.
Fallback: small always-on-top panel if AppIndicator GIR is missing.
"""

from __future__ import annotations

import json
import math
import os
import signal
import subprocess
import sys
import threading
import urllib.parse
import urllib.request
from pathlib import Path

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("GLib", "2.0")
gi.require_version("Gdk", "3.0")
from gi.repository import Gdk, GLib, Gtk  # noqa: E402

AppIndicator3 = None
try:
    gi.require_version("AyatanaAppIndicator3", "0.1")
    from gi.repository import AyatanaAppIndicator3 as AppIndicator3  # type: ignore
except Exception:
    try:
        gi.require_version("AppIndicator3", "0.1")
        from gi.repository import AppIndicator3  # type: ignore
    except Exception:
        AppIndicator3 = None

WEBSITE = "https://geauxweather.com"
DEFAULT_LAT = 30.5021
DEFAULT_LON = -90.7476
DEFAULT_LABEL = "Livingston, LA"
REFRESH_SECONDS = 15 * 60
UA = "GeauxWeather-LinuxTray/1.0 (+https://geauxweather.com)"
SCRIPT_DIR = Path(__file__).resolve().parent


def config_path() -> Path:
    return Path.home() / ".config" / "geauxweather-widget" / "config.json"


def load_config() -> dict:
    path = config_path()
    if path.is_file():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            pass
    units = "fahrenheit"
    lang = (os.environ.get("LANG") or "") + (os.environ.get("LC_ALL") or "")
    # Fresh installs outside en_US default to Celsius (e.g. Australia)
    if "en_US" not in lang:
        units = "celsius"
    return {
        "lat": DEFAULT_LAT,
        "lon": DEFAULT_LON,
        "label": DEFAULT_LABEL,
        "units": units,
    }


def save_config(cfg: dict) -> None:
    path = config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(cfg, indent=2) + "\n", encoding="utf-8")




def condition_emoji(code) -> str:
    """Map WMO weather_code → widely supported BMP Unicode (Mint-safe).

    Avoids color-emoji / Private-Use weather fonts that often render as □.
    """
    try:
        c = int(code) if code is not None else -1
    except (TypeError, ValueError):
        c = -1
    if c == 0:
        return "☀"
    if c in (1, 2):
        return "☁"
    if c == 3:
        return "☁"
    if 45 <= c <= 48:
        return "~"
    if 51 <= c <= 67 or 80 <= c <= 82:
        return "☂"
    if 71 <= c <= 77:
        return "❄"
    if c >= 95:
        return "⚡"
    return "☁"


def draw_condition_mark(draw, code, box) -> None:
    """Drawn weather mark — primary tray glyph (no font dependency)."""
    x0, y0, x1, y1 = box
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    r = min(x1 - x0, y1 - y0) * 0.32
    try:
        c = int(code) if code is not None else -1
    except (TypeError, ValueError):
        c = -1
    if c == 0:
        # Sun
        draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(255, 196, 72, 255))
        for ang in range(0, 360, 45):
            rad = ang * math.pi / 180.0
            x_a = cx + (r + 2) * math.cos(rad)
            y_a = cy + (r + 2) * math.sin(rad)
            x_b = cx + (r + 7) * math.cos(rad)
            y_b = cy + (r + 7) * math.sin(rad)
            draw.line((x_a, y_a, x_b, y_b), fill=(255, 196, 72, 255), width=2)
    elif c in (1, 2):
        # Partly cloudy
        draw.ellipse(
            (cx - r * 0.85, cy - r * 1.05, cx + r * 0.55, cy + r * 0.35),
            fill=(255, 196, 72, 255),
        )
        draw.ellipse(
            (cx - r * 0.2, cy - r * 0.15, cx + r * 1.05, cy + r * 0.85),
            fill=(210, 220, 235, 230),
        )
    elif c == 3 or c < 0:
        # Overcast / unknown → full cloud (never sun)
        draw.ellipse(
            (cx - r * 1.05, cy - r * 0.55, cx + r * 1.05, cy + r * 0.7),
            fill=(190, 200, 215, 235),
        )
    elif 45 <= c <= 48:
        # Fog bands
        draw.ellipse(
            (cx - r * 1.0, cy - r * 0.4, cx + r * 1.0, cy + r * 0.55),
            fill=(180, 190, 200, 180),
        )
        for dy in (-4, 2, 8):
            draw.line(
                (cx - r * 0.9, cy + dy, cx + r * 0.9, cy + dy),
                fill=(200, 210, 220, 200),
                width=2,
            )
    elif 51 <= c <= 67 or 80 <= c <= 82:
        # Rain: cloud + drops (clearer than missing emoji fonts)
        draw.ellipse(
            (cx - r * 0.95, cy - r * 0.95, cx + r * 0.95, cy + r * 0.25),
            fill=(170, 185, 205, 240),
        )
        for dx in (-7, -2, 3, 8):
            draw.line(
                (cx + dx, cy + 2, cx + dx - 2, cy + 12),
                fill=(110, 165, 255, 255),
                width=2,
            )
    elif c >= 95:
        # Thunder: cloud + bolt
        draw.ellipse(
            (cx - r * 0.95, cy - r * 0.95, cx + r * 0.95, cy + r * 0.2),
            fill=(150, 160, 180, 240),
        )
        draw.polygon(
            [
                (cx + 3, cy - 4),
                (cx - 5, cy + 5),
                (cx + 0, cy + 5),
                (cx - 4, cy + 15),
                (cx + 6, cy + 2),
                (cx + 1, cy + 2),
            ],
            fill=(255, 220, 80, 255),
        )
    elif 71 <= c <= 77:
        # Snow
        draw.ellipse(
            (cx - r, cy - r * 0.7, cx + r, cy + r * 0.4),
            fill=(220, 230, 245, 240),
        )
        for dx, dy in ((-5, 6), (0, 8), (5, 6)):
            draw.line(
                (cx + dx - 2, cy + dy, cx + dx + 2, cy + dy),
                fill=(230, 240, 255, 255),
                width=2,
            )
            draw.line(
                (cx + dx, cy + dy - 2, cx + dx, cy + dy + 2),
                fill=(230, 240, 255, 255),
                width=2,
            )
    else:
        draw.ellipse(
            (cx - r * 1.05, cy - r * 0.55, cx + r * 1.05, cy + r * 0.7),
            fill=(190, 200, 215, 235),
        )


def _load_font(size: int, simple_symbol: bool = False):
    from PIL import ImageFont

    if simple_symbol:
        # BMP weather symbols (☀☁☂❄⚡) — DejaVu/Symbola; not Noto Color Emoji
        candidates = [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            "/usr/share/fonts/truetype/ancient-scripts/Symbola_hint.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
            "/usr/share/fonts/truetype/freefont/FreeSans.ttf",
        ]
    else:
        candidates = [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
            "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
        ]
    for fp in candidates:
        if Path(fp).is_file():
            try:
                return ImageFont.truetype(fp, size)
            except OSError:
                continue
    return ImageFont.load_default()


def render_tray_icon(temp_text: str, weather_code, out_path: Path) -> str:
    """Draw condition (Pillow shapes) + temperature — no emoji-font dependency.

    Color-emoji / PUA weather fonts often show as □ on Mint/Cinnamon trays.
    Drawn marks always work; simple Unicode is only a secondary attempt.
    """
    from PIL import Image, ImageDraw

    out_path.parent.mkdir(parents=True, exist_ok=True)
    w, h = 100, 36
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Primary: vector-style mark (Tony Mint case — never a tofu box)
    draw_condition_mark(draw, weather_code, (2, 2, 34, 34))

    text = (temp_text or "—").strip()[:4]
    fs = 24 if len(text) <= 3 else 20
    font = _load_font(fs, simple_symbol=False)
    bbox = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = 40 + max(0, (w - 44 - tw) / 2) - bbox[0]
    y = (h - th) / 2 - bbox[1]
    draw.text((x + 1, y + 1), text, font=font, fill=(0, 0, 0, 160))
    draw.text((x, y), text, font=font, fill=(245, 248, 255, 255))
    img.save(out_path, "PNG")
    return str(out_path)


def render_temp_icon(temp_text: str, out_path: Path) -> str:
    """Back-compat wrapper (temp only)."""
    return render_tray_icon(temp_text, None, out_path)


def find_icon(code=None) -> str:
    """Theme fallback if Pillow is missing."""
    try:
        c = int(code) if code is not None else -1
    except (TypeError, ValueError):
        c = -1
    if c == 0:
        return "weather-clear"
    if c in (1, 2):
        return "weather-few-clouds"
    if c == 3:
        return "weather-overcast"
    if 51 <= c <= 67 or 80 <= c <= 82:
        return "weather-showers"
    if 71 <= c <= 77:
        return "weather-snow"
    if c >= 95:
        return "weather-storm"
    return "weather-few-clouds"



def http_get_json(url: str, timeout: float = 12.0) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def code_label(code) -> str:
    if code is None:
        return "—"
    c = int(code)
    if c == 0:
        return "Clear"
    if c == 1:
        return "Mostly clear"
    if c == 2:
        return "Partly cloudy"
    if c == 3:
        return "Overcast"
    if 45 <= c <= 48:
        return "Fog"
    if 51 <= c <= 67:
        return "Rain"
    if 71 <= c <= 77:
        return "Snow"
    if 80 <= c <= 82:
        return "Showers"
    if c >= 95:
        return "Thunderstorm"
    return "Cloudy"


def fetch_weather(lat: float, lon: float, units: str = "fahrenheit") -> dict:
    params = urllib.parse.urlencode(
        {
            "latitude": lat,
            "longitude": lon,
            "current": "temperature_2m,weather_code,apparent_temperature",
            "temperature_unit": units,
            "timezone": "auto",
        }
    )
    data = http_get_json(f"https://api.open-meteo.com/v1/forecast?{params}")
    cur = data.get("current") or {}
    return {
        "temp": cur.get("temperature_2m"),
        "feels": cur.get("apparent_temperature"),
        "code": cur.get("weather_code"),
    }


def open_url(url: str) -> None:
    for cmd in (("xdg-open", url), ("gio", "open", url)):
        try:
            subprocess.Popen(
                list(cmd),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
            return
        except FileNotFoundError:
            continue
    import webbrowser

    webbrowser.open(url)


def unit_suffix(units: str) -> str:
    return "°C" if units == "celsius" else "°F"


class WeatherModel:
    def __init__(self) -> None:
        self.cfg = load_config()
        self.summary = "Loading…"
        self.short = "GW"
        self.code = None
        self.listeners: list = []

    def on_change(self, cb) -> None:
        self.listeners.append(cb)

    def notify(self) -> None:
        for cb in self.listeners:
            cb()

    def refresh(self) -> None:
        def work() -> None:
            try:
                wx = fetch_weather(
                    float(self.cfg.get("lat", DEFAULT_LAT)),
                    float(self.cfg.get("lon", DEFAULT_LON)),
                    str(self.cfg.get("units", "fahrenheit")),
                )
                GLib.idle_add(self._apply, wx, None)
            except Exception as exc:
                GLib.idle_add(self._apply, None, str(exc))

        threading.Thread(target=work, daemon=True).start()

    def set_units(self, units: str) -> None:
        units = "celsius" if units == "celsius" else "fahrenheit"
        self.cfg["units"] = units
        save_config(self.cfg)
        self.refresh()

    def _apply(self, wx, err) -> bool:
        label = str(self.cfg.get("label") or DEFAULT_LABEL)
        units = unit_suffix(str(self.cfg.get("units", "fahrenheit")))
        if err or not wx:
            self.short = "GW"
            self.code = None
            self.summary = "Weather unavailable — open site"
        else:
            temp = wx.get("temp")
            self.code = wx.get("code")
            cond = code_label(self.code)
            if temp is None:
                self.short = "GW"
                self.summary = f"{label} · {cond}"
            else:
                t = int(round(float(temp)))
                self.short = f"{t}°"
                self.summary = f"{label} · {t}{units} · {cond}"
        self.notify()
        return False


class IndicatorUI:
    def __init__(self, model: WeatherModel) -> None:
        assert AppIndicator3 is not None
        self.model = model
        self._icon_dir = Path.home() / ".cache" / "geauxweather-widget"
        self._icon_dir.mkdir(parents=True, exist_ok=True)
        # Initial icon path (updated on each sync; unique name forces panel refresh)
        self._icon_path = self._icon_dir / "tray-temp.png"
        try:
            icon = render_temp_icon(model.short, self._icon_path)
        except Exception:
            icon = find_icon()

        self.indicator = AppIndicator3.Indicator.new(
            "geauxweather-widget",
            icon,
            AppIndicator3.IndicatorCategory.APPLICATION_STATUS,
        )
        try:
            self.indicator.set_icon_full(icon, "GeauxWeather")
        except Exception:
            pass
        # Never show a separate text label next to the icon (causes double / black box)
        try:
            self.indicator.set_label("", "")
        except Exception:
            pass
        self.indicator.set_status(AppIndicator3.IndicatorStatus.ACTIVE)
        self.indicator.set_title("GeauxWeather")

        # Compact tray menu (stays near the panel — not a floating center window)
        self.menu = Gtk.Menu()
        self.item_status = Gtk.MenuItem(label=model.summary)
        self.item_status.set_sensitive(False)
        self.menu.append(self.item_status)
        self.menu.append(Gtk.SeparatorMenuItem())

        open_item = Gtk.MenuItem(label="Open GeauxWeather website")
        open_item.connect("activate", lambda *_: open_url(WEBSITE))
        self.menu.append(open_item)

        refresh = Gtk.MenuItem(label="Refresh weather")
        refresh.connect("activate", lambda *_: model.refresh())
        self.menu.append(refresh)

        units_menu = Gtk.Menu()
        item_c = Gtk.MenuItem(label="Celsius (°C)")
        item_c.connect("activate", lambda *_: model.set_units("celsius"))
        units_menu.append(item_c)
        item_f = Gtk.MenuItem(label="Fahrenheit (°F)")
        item_f.connect("activate", lambda *_: model.set_units("fahrenheit"))
        units_menu.append(item_f)
        units_root = Gtk.MenuItem(label="Units")
        units_root.set_submenu(units_menu)
        self.menu.append(units_root)

        self.menu.append(Gtk.SeparatorMenuItem())
        quit_item = Gtk.MenuItem(label="Quit")
        quit_item.connect("activate", lambda *_: request_quit())
        self.menu.append(quit_item)
        self.menu.show_all()
        self.indicator.set_menu(self.menu)
        # Middle-click / secondary: open site (not a second window)
        try:
            self.indicator.set_secondary_activate_target(open_item)
        except Exception:
            pass
        model.on_change(self.sync)
        self.sync()

    def sync(self) -> None:
        # Single panel entry: temperature drawn on transparent icon, no label
        try:
            # Unique filename so the panel reloads the image when temp changes
            safe = "".join(ch if ch.isalnum() or ch in ".-" else "_" for ch in self.model.short)
            path = self._icon_dir / f"tray-{safe}-{self.model.code}.png"
            rendered = render_tray_icon(self.model.short, self.model.code, path)
            self.indicator.set_icon_full(rendered, self.model.summary or "GeauxWeather")
            # Drop any leftover label from older builds
            try:
                self.indicator.set_label("", "")
            except Exception:
                pass
        except Exception:
            try:
                self.indicator.set_icon(find_icon(self.model.code))
            except Exception:
                pass
        self.indicator.set_title(self.model.summary)
        self.item_status.set_label(self.model.summary)


class PanelUI:
    """Fallback mini-panel when AppIndicator is not available."""

    def __init__(self, model: WeatherModel) -> None:
        self.model = model
        self.win = Gtk.Window(type=Gtk.WindowType.TOPLEVEL)
        self.win.set_title("GeauxWeather")
        self.win.set_decorated(False)
        self.win.set_keep_above(True)
        self.win.set_skip_taskbar_hint(True)
        self.win.set_skip_pager_hint(True)
        self.win.set_resizable(False)
        self.win.set_border_width(10)
        self.win.set_default_size(240, 110)

        css = b"""
        window {
          background-color: rgba(18, 24, 36, 0.94);
          border-radius: 14px;
          border: 1px solid rgba(255,255,255,0.14);
        }
        label.title { color: #e8eef8; font-weight: 700; font-size: 20px; }
        label.sub { color: #9fb0c6; font-size: 12px; }
        button {
          background-image: image(#3d8bfd);
          color: white;
          border-radius: 10px;
          padding: 6px 10px;
          border: none;
        }
        """
        provider = Gtk.CssProvider()
        provider.load_from_data(css)
        Gtk.StyleContext.add_provider_for_screen(
            Gdk.Screen.get_default(),
            provider,
            Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION,
        )

        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=6)
        self.lbl_temp = Gtk.Label(label="…")
        self.lbl_temp.get_style_context().add_class("title")
        self.lbl_sub = Gtk.Label(label="GeauxWeather")
        self.lbl_sub.get_style_context().add_class("sub")
        self.lbl_sub.set_line_wrap(True)
        self.lbl_sub.set_max_width_chars(30)

        btn_row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=6)
        open_btn = Gtk.Button(label="Open site")
        open_btn.connect("clicked", lambda *_: open_url(WEBSITE))
        refresh_btn = Gtk.Button(label="↻")
        refresh_btn.connect("clicked", lambda *_: model.refresh())
        quit_btn = Gtk.Button(label="✕")
        quit_btn.connect("clicked", lambda *_: request_quit())
        btn_row.pack_start(open_btn, True, True, 0)
        btn_row.pack_start(refresh_btn, False, False, 0)
        btn_row.pack_start(quit_btn, False, False, 0)

        box.pack_start(self.lbl_temp, False, False, 0)
        box.pack_start(self.lbl_sub, False, False, 0)
        box.pack_start(btn_row, False, False, 0)
        self.win.add(box)
        self.win.connect("map-event", self._place)
        self.win.show_all()
        model.on_change(self.sync)
        self.sync()

    def _place(self, *_a) -> bool:
        screen = self.win.get_screen()
        mon = screen.get_monitor_geometry(screen.get_primary_monitor())
        w = self.win.get_allocated_width() or 240
        x = mon.x + mon.width - w - 24
        y = mon.y + 48
        self.win.move(max(mon.x + 8, x), y)
        return False

    def sync(self) -> None:
        self.lbl_temp.set_text(self.model.short)
        self.lbl_sub.set_text(self.model.summary)


_LOCK = Path.home() / ".cache" / "geauxweather-widget.lock"
_quitting = False


def clear_lock() -> None:
    try:
        _LOCK.unlink(missing_ok=True)
    except OSError:
        pass


def request_quit(*_a) -> None:
    """Quit from menu/button — always drop the lock so the app menu can start again."""
    global _quitting
    if _quitting:
        return
    _quitting = True
    clear_lock()
    Gtk.main_quit()


def main() -> int:
    if "--open" in sys.argv:
        open_url(WEBSITE)
        return 0

    _LOCK.parent.mkdir(parents=True, exist_ok=True)

    def take_lock() -> bool:
        try:
            fd = os.open(str(_LOCK), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
            os.write(fd, str(os.getpid()).encode())
            os.close(fd)
            return True
        except FileExistsError:
            try:
                old = int(_LOCK.read_text().strip())
                os.kill(old, 0)
                # Already in tray — open website instead of a second tray
                print(f"Already running (pid {old}); opening website")
                open_url(WEBSITE)
                return False
            except (ValueError, OSError, ProcessLookupError):
                # Stale lock from a crashed/old process
                clear_lock()
                return take_lock()

    if not take_lock():
        return 0

    import atexit

    atexit.register(clear_lock)
    signal.signal(signal.SIGINT, request_quit)
    signal.signal(signal.SIGTERM, request_quit)

    model = WeatherModel()
    if AppIndicator3 is not None:
        IndicatorUI(model)
        print("GeauxWeather tray: AppIndicator mode (top bar)")
    else:
        PanelUI(model)
        print(
            "GeauxWeather tray: floating panel mode\n"
            "  For a top-bar icon: sudo apt install gir1.2-ayatanaappindicator3-0.1"
        )

    model.refresh()
    GLib.timeout_add_seconds(REFRESH_SECONDS, lambda: (model.refresh() or True))
    Gtk.main()
    clear_lock()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
