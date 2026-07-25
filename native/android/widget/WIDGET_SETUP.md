# PureSky Android home-screen widget

## 1. Create the Android project (on your machine)

```bash
cd puresky
npm install
npx cap add android
npx cap sync android
```

Package id must stay `com.puresky.weather` (see `capacitor.config.json`).

## 2. Copy widget resources

From this `native/android/widget/` folder:

| Source | Destination under `android/` |
|--------|------------------------------|
| `res/layout/puresky_widget.xml` | `app/src/main/res/layout/` |
| `res/xml/puresky_widget_info.xml` | `app/src/main/res/xml/` |
| `res/drawable/widget_bg.xml` | `app/src/main/res/drawable/` |
| `kotlin/PureSkyWidgetProvider.kt` | `app/src/main/java/com/puresky/weather/` |

Create dirs if missing (`res/xml`, package path).

## 3. Strings

In `app/src/main/res/values/strings.xml` add:

```xml
<string name="widget_description">Current conditions and today’s high/low</string>
<string name="widget_name">PureSky</string>
```

## 4. AndroidManifest.xml

Inside `<application>`, register the provider:

```xml
<receiver
    android:name=".PureSkyWidgetProvider"
    android:exported="true"
    android:label="@string/widget_name">
    <intent-filter>
        <action android:name="android.appwidget.action.APPWIDGET_UPDATE" />
    </intent-filter>
    <meta-data
        android:name="android.appwidget.provider"
        android:resource="@xml/puresky_widget_info" />
</receiver>
```

## 5. Web → widget data

The web UI writes JSON to Capacitor Preferences key `puresky_widget`
(and localStorage fallback). Capacitor stores that in SharedPreferences
file `CapacitorStorage` — the same file the widget reads.

Open the app once, load weather, then add the widget from the launcher.

## 6. Build & install

```bash
npx cap sync android
cd android && ./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Long-press home screen → Widgets → PureSky.

## Notes

- System `updatePeriodMillis` is 30 min (Android may batch). Opening the app refreshes the snapshot immediately; next widget pass picks it up.
- Optional: call `AppWidgetManager` from a small Capacitor plugin later for instant push after fetch.
- Works on stock Android; no Play Services required for the widget itself.
