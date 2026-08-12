# GeauxWeather

Clean, fast, **no-ads** weather for Android — and a live website with maps, 10-day forecast, and more.

[![Get it on F-Droid](https://img.shields.io/f-droid/v/com.geauxweather.app?logo=f-droid&label=F-Droid)](https://f-droid.org/packages/com.geauxweather.app/)
[![GitHub release](https://img.shields.io/github/v/release/tunefriend/GeauxWeather?logo=github)](https://github.com/tunefriend/GeauxWeather/releases/latest)
[![License: GPL-3.0-or-later](https://img.shields.io/badge/License-GPL--3.0--or--later-blue.svg)](LICENSE)

## Download

| Source | Link |
|--------|------|
| **F-Droid** (recommended) | [f-droid.org/packages/com.geauxweather.app](https://f-droid.org/packages/com.geauxweather.app/) |
| GitHub APK | [Latest release](https://github.com/tunefriend/GeauxWeather/releases/latest) |
| Website | [geauxweather.com](https://geauxweather.com) |

Package ID: `com.geauxweather.app` · License: **GPL-3.0-or-later** · Reproducible builds on F-Droid

## Screenshots

| Today | 10-Day | Maps |
|:---:|:---:|:---:|
| ![Today](docs/screenshots/01-today.jpg) | ![10-Day](docs/screenshots/02-10day.jpg) | ![Maps](docs/screenshots/03-maps.jpg) |

| Places | Settings |
|:---:|:---:|
| ![Places](docs/screenshots/04-places.jpg) | ![Settings](docs/screenshots/05-settings.jpg) |

## Features (Android app)

- **Today** — conditions, sunrise/sunset, hourly; weather sky backgrounds (day/night)
- **10-Day** — highs/lows and precip chance
- **Maps** — rain radar (RainViewer), wind field, fog, hurricane cone/track (NHC), tornado/severe (NWS), solar eclipse paths
- **Places** — save pins; GPS or default home location
- **Severe storm alerts** — optional location-based tornado / severe T-storm / nearby tropical
- **Widget + status bar** temperature
- No ads · no tracking · no account required

## Website

**https://geauxweather.com**

- Live weather panel, **nearby** temperature ticker, **10-day** strip
- Interactive maps (same layers as the app, including **Eclipse**)
- Install as **PWA** (Windows / desktop / Android Chrome)
- **Linux tray** (all major desktops) · **Brave/Chrome** extension
- Privacy: [geauxweather.com/privacy.html](https://geauxweather.com/privacy.html)

```bash
# Deploy site (Cloudflare Worker + assets) — see DEPLOY.md
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 22
npx wrangler deploy
```

## Stack

- **App**: Capacitor 7 + plain HTML/CSS/JS
- **Data**: Open-Meteo, RainViewer, NHC, NWS, OpenStreetMap Nominatim
- **Site**: Cloudflare Workers + static assets

## Build (Android)

```bash
npm ci
npm run apk
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

## Feedback & donate

- Email: [puresky.weather@proton.me](mailto:puresky.weather@proton.me)
- Liberapay: [liberapay.com/west66](https://liberapay.com/west66/donate)
- Mirror: [GitLab](https://gitlab.com/tunefriend/geauxweather)
