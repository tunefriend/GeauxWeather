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
GEO_URL = "https://geauxweather.com/api/geo"
# Last-resort coords only if IP geo fails (US Gulf) — never left unsaved as a silent default
FALLBACK_LAT = 30.5021
FALLBACK_LON = -90.7476
FALLBACK_LABEL = "Location unset — use Detect my location"
REFRESH_SECONDS = 15 * 60
UA = "GeauxWeather-LinuxTray/1.1 (+https://geauxweather.com)"
SCRIPT_DIR = Path(__file__).resolve().parent


def config_path() -> Path:
    return Path.home() / ".config" / "geauxweather-widget" / "config.json"


def default_units_from_locale() -> str:
    """°F for en_US; °C everywhere else (AU, EU, …)."""
    lang = (
        (os.environ.get("LC_ALL") or "")
        + (os.environ.get("LC_MESSAGES") or "")
        + (os.environ.get("LANG") or "")
    ).lower()
    if "en_us" in lang:
        return "fahrenheit"
    return "celsius"


def detect_ip_location() -> dict | None:
    """Approximate location from network IP (Cloudflare via geauxweather.com)."""
    try:
        data = http_get_json(GEO_URL, timeout=6.0)
        lat, lon = data.get("lat"), data.get("lon")
        if lat is None or lon is None:
            return None
        label = data.get("label") or data.get("city") or data.get("country")
        if not label:
            label = f"{float(lat):.2f}, {float(lon):.2f}"
        return {"lat": float(lat), "lon": float(lon), "label": str(label)}
    except Exception:
        return None


def ensure_config() -> dict:
    """Load config, or create one on first run (IP geo + locale units)."""
    path = config_path()
    if path.is_file():
        try:
            cfg = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(cfg, dict) and cfg.get("lat") is not None and cfg.get("lon") is not None:
                # Backfill units for older configs
                if cfg.get("units") not in ("celsius", "fahrenheit"):
                    cfg["units"] = default_units_from_locale()
                    save_config(cfg)
                return cfg
        except (OSError, json.JSONDecodeError):
            pass

    units = default_units_from_locale()
    geo = detect_ip_location()
    if geo:
        cfg = {
            "lat": geo["lat"],
            "lon": geo["lon"],
            "label": geo["label"],
            "units": units,
            "source": "ip-geo",
        }
    else:
        cfg = {
            "lat": FALLBACK_LAT,
            "lon": FALLBACK_LON,
            "label": FALLBACK_LABEL,
            "units": units,
            "source": "fallback",
        }
    save_config(cfg)
    return cfg


def load_config() -> dict:
    return ensure_config()


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


def draw_condition_mark(img, draw, code, box, is_day: bool = True) -> None:
    """Drawn weather mark — primary tray glyph (no font dependency).

    Clear / partly cloudy use a moon at night (is_day=False) so 11pm
    never shows a sun.
    """
    from PIL import Image, ImageDraw

    x0, y0, x1, y1 = box
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    r = min(x1 - x0, y1 - y0) * 0.32
    try:
        c = int(code) if code is not None else -1
    except (TypeError, ValueError):
        c = -1

    def draw_sun() -> None:
        draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(255, 196, 72, 255))
        for ang in range(0, 360, 45):
            rad = ang * math.pi / 180.0
            x_a = cx + (r + 2) * math.cos(rad)
            y_a = cy + (r + 2) * math.sin(rad)
            x_b = cx + (r + 7) * math.cos(rad)
            y_b = cy + (r + 7) * math.sin(rad)
            draw.line((x_a, y_a, x_b, y_b), fill=(255, 196, 72, 255), width=2)

    def draw_moon(at_cx=None, at_cy=None, at_r=None) -> None:
        """Crescent moon with a real transparent cutout (works on any panel)."""
        mx = cx if at_cx is None else at_cx
        my = cy if at_cy is None else at_cy
        mr = r if at_r is None else at_r
        layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
        ld = ImageDraw.Draw(layer)
        ld.ellipse((mx - mr, my - mr, mx + mr, my + mr), fill=(230, 235, 255, 255))
        mask = Image.new("L", img.size, 0)
        md = ImageDraw.Draw(mask)
        md.ellipse((mx - mr, my - mr, mx + mr, my + mr), fill=255)
        # Offset disc punches the crescent hole
        md.ellipse(
            (mx - mr * 0.1, my - mr * 0.95, mx + mr * 1.3, my + mr * 0.95),
            fill=0,
        )
        img.paste(layer, (0, 0), mask)

    if c == 0:
        if is_day:
            draw_sun()
        else:
            draw_moon()
    elif c in (1, 2):
        # Partly cloudy — sun or moon peeking behind cloud
        if is_day:
            draw.ellipse(
                (cx - r * 0.85, cy - r * 1.05, cx + r * 0.55, cy + r * 0.35),
                fill=(255, 196, 72, 255),
            )
        else:
            draw_moon(at_cx=cx - r * 0.25, at_cy=cy - r * 0.45, at_r=r * 0.7)
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


def render_tray_icon(temp_text: str, weather_code, out_path: Path, is_day: bool = True) -> str:
    """Draw condition (Pillow shapes) + temperature — no emoji-font dependency.

    Color-emoji / PUA weather fonts often show as □ on Mint/Cinnamon trays.
    Drawn marks always work; clear night uses a moon (not a sun).
    """
    from PIL import Image, ImageDraw

    out_path.parent.mkdir(parents=True, exist_ok=True)
    w, h = 100, 36
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Primary: vector-style mark (Tony Mint case — never a tofu box)
    draw_condition_mark(img, draw, weather_code, (2, 2, 34, 34), is_day=is_day)

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


def find_icon(code=None, is_day: bool = True) -> str:
    """Theme fallback if Pillow is missing."""
    try:
        c = int(code) if code is not None else -1
    except (TypeError, ValueError):
        c = -1
    if c == 0:
        return "weather-clear" if is_day else "weather-clear-night"
    if c in (1, 2):
        return "weather-few-clouds" if is_day else "weather-few-clouds-night"
    if c == 3:
        return "weather-overcast"
    if 51 <= c <= 67 or 80 <= c <= 82:
        return "weather-showers"
    if 71 <= c <= 77:
        return "weather-snow"
    if c >= 95:
        return "weather-storm"
    return "weather-few-clouds" if is_day else "weather-few-clouds-night"



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
            "current": "temperature_2m,weather_code,apparent_temperature,is_day",
            "temperature_unit": units,
            "timezone": "auto",
        }
    )
    data = http_get_json(f"https://api.open-meteo.com/v1/forecast?{params}")
    cur = data.get("current") or {}
    is_day_raw = cur.get("is_day")
    try:
        is_day = int(is_day_raw) != 0 if is_day_raw is not None else True
    except (TypeError, ValueError):
        is_day = True
    return {
        "temp": cur.get("temperature_2m"),
        "feels": cur.get("apparent_temperature"),
        "code": cur.get("weather_code"),
        "is_day": is_day,
    }


def search_cities(query: str, count: int = 6) -> list:
    q = (query or "").strip()
    if len(q) < 2:
        return []
    params = urllib.parse.urlencode(
        {"name": q, "count": count, "language": "en", "format": "json"}
    )
    data = http_get_json(f"https://geocoding-api.open-meteo.com/v1/search?{params}")
    out = []
    for r in data.get("results") or []:
        parts = [r.get("name"), r.get("admin1"), r.get("country")]
        label = ", ".join(p for p in parts if p)
        out.append(
            {
                "lat": float(r["latitude"]),
                "lon": float(r["longitude"]),
                "label": label or r.get("name") or "Result",
            }
        )
    return out


def prompt_search_city(parent=None) -> dict | None:
    """Simple GTK dialog: type a city, pick first match (or cancel)."""
    dialog = Gtk.Dialog(title="GeauxWeather — Search city", modal=True)
    if parent is not None:
        dialog.set_transient_for(parent)
    dialog.add_buttons(
        Gtk.STOCK_CANCEL, Gtk.ResponseType.CANCEL,
        "Search", Gtk.ResponseType.OK,
    )
    dialog.set_default_response(Gtk.ResponseType.OK)
    box = dialog.get_content_area()
    box.set_spacing(8)
    box.set_border_width(12)
    entry = Gtk.Entry()
    entry.set_placeholder_text("City name (e.g. Marshall, Melbourne, Sydney)")
    entry.set_activates_default(True)
    box.add(entry)
    hint = Gtk.Label(label="Uses Open-Meteo geocoding. First match is applied.")
    hint.set_line_wrap(True)
    box.add(hint)
    dialog.show_all()
    resp = dialog.run()
    q = entry.get_text().strip()
    dialog.destroy()
    if resp != Gtk.ResponseType.OK or len(q) < 2:
        return None
    try:
        results = search_cities(q)
    except Exception:
        return None
    return results[0] if results else None


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


def website_url(cfg: dict | None = None) -> str:
    """Open the site with the tray's saved place so Marshall stays Marshall.

    Example: https://geauxweather.com/?lat=-38.20&lon=144.36&label=Marshall%2C%20VIC&units=celsius
    """
    if cfg is None:
        try:
            cfg = load_config()
        except Exception:
            cfg = {}
    try:
        lat = float(cfg.get("lat"))
        lon = float(cfg.get("lon"))
    except (TypeError, ValueError):
        return WEBSITE
    units = cfg.get("units") if cfg.get("units") in ("celsius", "fahrenheit") else default_units_from_locale()
    # Website uses metric/imperial; map tray celsius/fahrenheit
    web_units = "metric" if units == "celsius" else "imperial"
    label = str(cfg.get("label") or "").strip()
    qs = urllib.parse.urlencode(
        {
            "lat": f"{lat:.5f}",
            "lon": f"{lon:.5f}",
            "label": label,
            "units": web_units,
            "from": "linux-tray",
        }
    )
    return f"{WEBSITE}/?{qs}"


def open_website(cfg: dict | None = None) -> None:
    open_url(website_url(cfg))


def unit_suffix(units: str) -> str:
    return "°C" if units == "celsius" else "°F"


class WeatherModel:
    def __init__(self) -> None:
        self.cfg = load_config()
        self.summary = "Loading…"
        self.short = "GW"
        self.code = None
        self.is_day = True
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
                    float(self.cfg.get("lat", FALLBACK_LAT)),
                    float(self.cfg.get("lon", FALLBACK_LON)),
                    str(self.cfg.get("units", default_units_from_locale())),
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

    def set_location(self, lat: float, lon: float, label: str, source: str = "user") -> None:
        self.cfg["lat"] = float(lat)
        self.cfg["lon"] = float(lon)
        self.cfg["label"] = str(label or "Saved location")
        self.cfg["source"] = source
        save_config(self.cfg)
        self.refresh()

    def detect_location(self) -> None:
        """Re-run IP geo and save (tray menu)."""

        def work() -> None:
            geo = detect_ip_location()
            if not geo:
                GLib.idle_add(
                    self._apply,
                    None,
                    "Could not detect location — search a city or open the website",
                )
                return
            self.cfg["lat"] = geo["lat"]
            self.cfg["lon"] = geo["lon"]
            self.cfg["label"] = geo["label"]
            self.cfg["source"] = "ip-geo"
            if self.cfg.get("units") not in ("celsius", "fahrenheit"):
                self.cfg["units"] = default_units_from_locale()
            save_config(self.cfg)
            self.refresh()

        self.summary = "Detecting location…"
        self.notify()
        threading.Thread(target=work, daemon=True).start()

    def _apply(self, wx, err) -> bool:
        label = str(self.cfg.get("label") or FALLBACK_LABEL)
        units = unit_suffix(str(self.cfg.get("units", default_units_from_locale())))
        if err or not wx:
            self.short = "GW"
            self.code = None
            self.is_day = True
            self.summary = err or "Weather unavailable — open site"
        else:
            temp = wx.get("temp")
            self.code = wx.get("code")
            self.is_day = bool(wx.get("is_day", True))
            cond = code_label(self.code)
            if not self.is_day and self.code in (0, 1, 2):
                # Make the menu text honest at night
                if self.code == 0:
                    cond = "Clear night"
                elif self.code == 1:
                    cond = "Mostly clear night"
                else:
                    cond = "Partly cloudy night"
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
        open_item.connect("activate", lambda *_: open_website(model.cfg))
        self.menu.append(open_item)

        refresh = Gtk.MenuItem(label="Refresh weather")
        refresh.connect("activate", lambda *_: model.refresh())
        self.menu.append(refresh)

        loc_menu = Gtk.Menu()
        item_detect = Gtk.MenuItem(label="Detect my location (network)")
        item_detect.connect("activate", lambda *_: model.detect_location())
        loc_menu.append(item_detect)
        item_search = Gtk.MenuItem(label="Search city…")
        item_search.connect("activate", lambda *_: self._search_city())
        loc_menu.append(item_search)
        loc_root = Gtk.MenuItem(label="Location")
        loc_root.set_submenu(loc_menu)
        self.menu.append(loc_root)

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

    def _search_city(self) -> None:
        hit = prompt_search_city()
        if not hit:
            return
        self.model.set_location(hit["lat"], hit["lon"], hit["label"], source="search")

    def sync(self) -> None:
        # Single panel entry: temperature drawn on transparent icon, no label
        try:
            # Unique filename so the panel reloads the image when temp changes
            safe = "".join(ch if ch.isalnum() or ch in ".-" else "_" for ch in self.model.short)
            day_tag = "d" if self.model.is_day else "n"
            path = self._icon_dir / f"tray-{safe}-{self.model.code}-{day_tag}.png"
            rendered = render_tray_icon(
                self.model.short, self.model.code, path, is_day=self.model.is_day
            )
            self.indicator.set_icon_full(rendered, self.model.summary or "GeauxWeather")
            # Drop any leftover label from older builds
            try:
                self.indicator.set_label("", "")
            except Exception:
                pass
        except Exception:
            try:
                self.indicator.set_icon(find_icon(self.model.code, is_day=self.model.is_day))
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
        open_btn.connect("clicked", lambda *_: open_website(model.cfg))
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
        open_website()
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
                # Already in tray — open website with saved location (not a second tray)
                print(f"Already running (pid {old}); opening website")
                open_website()
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
