# PureSky

Clean, fast, no-ads weather for Android.

- **Stack**: Capacitor 7 + plain HTML/CSS/JS  
- **Data**: Open-Meteo (no key) + RainViewer radar + OSM Nominatim  
- **Package**: `com.puresky.weather`  
- **License**: GPL-3.0-or-later  

## Features

- Today, hourly, and 10-day forecast  
- Maps: rain radar timeline, wind/fog overlays  
- Drop a pin on the map → nearest city name → save to Places  
- Places tab: saved locations with temp + condition  
- Long-press a place to set default; tap to open as home  
- Header refresh: GPS when available, else default city  
- Custom PureSky launcher icon  

## Web preview

Open `www/index.html` in a browser (network needed for weather + radar).

## Build APK

```bash
npm install
npm run apk
# or: bash scripts/build-apk.sh

adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

Requires Android SDK + JDK. First run may need `npx cap add android` only if `android/` is missing.

## Project layout

```
www/           web UI + brand assets
scripts/       build-apk.sh
android/       Capacitor Android project (icons, permissions)
native/        optional home-screen widget sources
```
