# GeauxWeather

Clean, fast, no-ads weather for Android.

- **Package**: `com.geauxweather.app`  
- **Stack**: Capacitor 7 + plain HTML/CSS/JS  
- **Data**: Open-Meteo + RainViewer + OSM Nominatim  
- **License**: GPL-3.0-or-later  

## Screenshots

| Today | 10-Day | Maps |
|:---:|:---:|:---:|
| ![Today](docs/screenshots/01-today.jpg) | ![10-Day](docs/screenshots/02-10day.jpg) | ![Maps](docs/screenshots/03-maps.jpg) |

| Places | Settings |
|:---:|:---:|
| ![Places](docs/screenshots/04-places.jpg) | ![Settings](docs/screenshots/05-settings.jpg) |

## Build

```bash
npm ci
npm run apk
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

## Features

- **Today** — conditions, sunrise/sunset, hourly; weather sky backgrounds (day/night)  
- **10-Day** — highs/lows and precip chance  
- **Maps** — Rain (radar), Wind (arrows + particles), Fog, Hurricane (NHC cone/track), Tornado (NWS alerts)  
- **Places** — save pins; GPS or default home location  
- **Severe storm alerts** — optional location-based tornado / severe T-storm / nearby tropical (Settings)  
- **Widget + status bar** temperature  
- Feedback email · Liberapay donate · no ads / no tracking  

## Website

**https://geauxweather.com** — landing page + privacy policy (Cloudflare).

```bash
npx wrangler deploy   # see DEPLOY.md
```

## Download

- F-Droid: [com.geauxweather.app](https://f-droid.org/packages/com.geauxweather.app/)
- APK: [latest release](https://github.com/tunefriend/GeauxWeather/releases/latest)

