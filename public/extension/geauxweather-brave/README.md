# GeauxWeather — Brave / Chrome extension

Manifest V3 extension for **Brave** (and other Chromium browsers).

## Features

- Popup: current conditions, wind, humidity, UV
- **Use my location** or city search
- Toolbar **badge** with temperature
- Link to https://geauxweather.com
- No ads, no analytics

## Install in Brave (unpacked)

1. Download and unzip:  
   https://geauxweather.com/extension/geauxweather-brave.zip
2. Open `brave://extensions`
3. Enable **Developer mode** (top right)
4. Click **Load unpacked**
5. Select the unzipped `geauxweather-brave` folder

Pin the extension from the puzzle-piece menu for one-click weather.

## Permissions

- `storage` — save your city
- `geolocation` — optional “Use my location”
- Host access to Open-Meteo + Nominatim only

## Develop

```bash
# load this folder in brave://extensions → Load unpacked
cd extension/brave
```
