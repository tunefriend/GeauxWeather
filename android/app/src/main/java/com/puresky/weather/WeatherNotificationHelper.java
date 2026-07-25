package com.puresky.weather;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import org.json.JSONObject;

/**
 * Ongoing status-bar notification showing current temperature.
 * Accent color: sunny yellow, cloudy white/gray, raining blue.
 */
public final class WeatherNotificationHelper {

    private static final String CHANNEL_ID = "puresky_weather_status";
    private static final int NOTIF_ID = 42;
    private static final String PREFS_FILE = "CapacitorStorage";
    private static final String KEY_WIDGET = "puresky_widget";

    // Status colors
    private static final int COLOR_SUNNY = Color.parseColor("#F5C542");
    private static final int COLOR_CLOUDY = Color.parseColor("#E8EEF6");
    private static final int COLOR_RAIN = Color.parseColor("#4A9FE0");
    private static final int COLOR_DEFAULT = Color.parseColor("#5B9FD4");

    private WeatherNotificationHelper() {}

    public static void update(Context context) {
        ensureChannel(context);

        SharedPreferences prefs = context.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE);
        String raw = prefs.getString(KEY_WIDGET, null);
        if (raw == null || raw.isEmpty()) {
            // Keep notification if we have nothing yet
            return;
        }

        try {
            JSONObject o = new JSONObject(raw);
            String temp = o.optString("temp", "—°");
            String condition = o.optString("condition", "—");
            String label = o.optString("label", "PureSky");
            int code = o.optInt("weatherCode", -1);
            if (code < 0 && o.has("weather_code")) {
                code = o.optInt("weather_code", -1);
            }

            int color = colorForCode(code, condition);
            int icon = iconForCode(code, condition);

            Intent launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
            PendingIntent pi = null;
            if (launch != null) {
                launch.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                pi = PendingIntent.getActivity(
                        context,
                        0,
                        launch,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                );
            }

            String title = temp;
            String text = stripEmoji(condition);
            if (label != null && !label.isEmpty() && !"PureSky".equals(label)) {
                text = text + " · " + label;
            }

            NotificationCompat.Builder b = new NotificationCompat.Builder(context, CHANNEL_ID)
                    .setSmallIcon(icon)
                    .setContentTitle(title)
                    .setContentText(text)
                    .setColor(color)
                    .setColorized(true)
                    .setOngoing(true)
                    .setOnlyAlertOnce(true)
                    .setSilent(true)
                    .setPriority(NotificationCompat.PRIORITY_LOW)
                    .setCategory(NotificationCompat.CATEGORY_STATUS)
                    .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                    .setShowWhen(false);

            if (pi != null) {
                b.setContentIntent(pi);
            }

            NotificationManagerCompat.from(context).notify(NOTIF_ID, b.build());
        } catch (Exception ignored) {
            // leave previous notification
        }
    }

    public static void cancel(Context context) {
        NotificationManagerCompat.from(context).cancel(NOTIF_ID);
    }

    private static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel ch = new NotificationChannel(
                CHANNEL_ID,
                "Weather status",
                NotificationManager.IMPORTANCE_LOW
        );
        ch.setDescription("Shows current temperature in the notification shade");
        ch.setShowBadge(false);
        ch.enableLights(false);
        ch.enableVibration(false);
        ch.setSound(null, null);
        NotificationManager nm = context.getSystemService(NotificationManager.class);
        if (nm != null) nm.createNotificationChannel(ch);
    }

    /** Map Open-Meteo weather codes → accent color */
    static int colorForCode(int code, String condition) {
        String c = condition != null ? condition.toLowerCase() : "";
        if (code == 0 || code == 1) return COLOR_SUNNY;
        if (code >= 51 && code <= 67) return COLOR_RAIN;
        if (code >= 80 && code <= 99) return COLOR_RAIN;
        if (code == 2 || code == 3 || code == 45 || code == 48) return COLOR_CLOUDY;
        if (c.contains("rain") || c.contains("drizzle") || c.contains("shower")
                || c.contains("storm") || c.contains("thunder")) {
            return COLOR_RAIN;
        }
        if (c.contains("clear") || c.contains("sun")) return COLOR_SUNNY;
        if (c.contains("cloud") || c.contains("overcast") || c.contains("fog")) return COLOR_CLOUDY;
        return COLOR_DEFAULT;
    }

    static int iconForCode(int code, String condition) {
        String c = condition != null ? condition.toLowerCase() : "";
        if (code == 0 || code == 1 || c.contains("clear") || c.contains("sun")) {
            return R.drawable.ic_stat_sunny;
        }
        if ((code >= 51 && code <= 99) || c.contains("rain") || c.contains("drizzle")
                || c.contains("shower") || c.contains("storm")) {
            return R.drawable.ic_stat_rain;
        }
        return R.drawable.ic_stat_cloudy;
    }

    private static String stripEmoji(String s) {
        if (s == null) return "";
        // Drop leading non-ascii symbol clutter for notification text
        return s.replaceAll("^[\\p{So}\\p{Cn}\\s]+", "").trim();
    }
}
