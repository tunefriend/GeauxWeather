# PureSky

Clean, fast, no-ads weather for Android.

- **Stack**: Capacitor 7 + plain HTML/CSS/JS  
- **Data**: Open-Meteo (no API key) + RainViewer radar + OSM Nominatim  
- **Package**: `com.puresky.weather`  
- **License**: [GPL-3.0-or-later](LICENSE)  

## Download

- **GitHub releases**: https://github.com/tunefriend/puresky/releases  
- **GitLab**: https://gitlab.com/tunefriend/puresky  
- F-Droid: pending inclusion MR to [fdroiddata](https://gitlab.com/fdroid/fdroiddata)

## Features

- Today, hourly, and 10-day forecast  
- Maps: rain radar timeline, wind/fog overlays  
- Drop a pin → nearest city name → save to Places  
- Places tab with temp + condition; long-press sets default  
- Header refresh: GPS when available, else default city  
- No ads, no tracking, no proprietary location SDKs  

## Build APK

```bash
npm ci
npm run apk
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

Requires Android SDK + JDK 17+.

## Privacy

Location is used only on-device to fetch weather for your chosen place. Forecast data comes from Open-Meteo; map tiles from OpenStreetMap / RainViewer; reverse geocoding from Nominatim. No analytics SDKs.

## Project layout

```
www/           web UI + brand assets
android/       Capacitor Android project
fastlane/      F-Droid / store metadata
scripts/       build-apk.sh
```
