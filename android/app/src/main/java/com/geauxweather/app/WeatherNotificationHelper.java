package com.geauxweather.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Rect;
import android.graphics.Typeface;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.graphics.drawable.IconCompat;

import org.json.JSONObject;

/**
 * Ongoing status-bar notification with current temperature as crisp white digits.
 * (No weather color — system status bar is monochrome; colored digits looked blurry.)
 */
public final class WeatherNotificationHelper {

    private static final String CHANNEL_ID = "geauxweather_status";
    private static final int NOTIF_ID = 42;
    private static final String PREFS_FILE = "CapacitorStorage";
    private static final String KEY_WIDGET = "geauxweather_widget";

    private WeatherNotificationHelper() {}

    public static void update(Context context) {
        ensureChannel(context);

        SharedPreferences prefs = context.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE);
        String raw = prefs.getString(KEY_WIDGET, null);
        if (raw == null || raw.isEmpty()) {
            return;
        }

        try {
            JSONObject o = new JSONObject(raw);
            String temp = o.optString("temp", "—°");
            String condition = o.optString("condition", "—");
            String label = o.optString("label", "GeauxWeather");
            String digits = tempDigits(temp);

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

            String text = stripEmoji(condition);
            if (label != null && !label.isEmpty() && !"GeauxWeather".equals(label)) {
                text = text + " · " + label;
            }

            Bitmap iconBmp = renderTempIcon(digits);
            IconCompat smallIcon = IconCompat.createWithBitmap(iconBmp);

            NotificationCompat.Builder b = new NotificationCompat.Builder(context, CHANNEL_ID)
                    .setSmallIcon(smallIcon)
                    .setContentTitle(temp)
                    .setContentText(text)
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
        try {
            NotificationManagerCompat.from(context).cancel(NOTIF_ID);
        } catch (Exception ignored) {
        }
    }

    static String tempDigits(String temp) {
        if (temp == null || temp.isEmpty()) return "—";
        String t = temp.replace("°", "").replace("F", "").replace("C", "")
                .replace(" ", "").trim();
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < t.length(); i++) {
            char c = t.charAt(i);
            if (c == '-' || c == '−' || c == '+') {
                if (sb.length() == 0) sb.append(c == '−' ? '-' : c);
            } else if (Character.isDigit(c)) {
                sb.append(c);
            } else if (c == '.' || c == ',') {
                break;
            }
        }
        if (sb.length() == 0) return "—";
        String s = sb.toString();
        if (s.length() > 3) s = s.substring(0, 3);
        return s;
    }

    /** Large clean white digits — fill only (no stroke/halo). */
    static Bitmap renderTempIcon(String digits) {
        // High-res canvas so digits stay sharp after system downscales the icon
        int size = 128;
        Bitmap bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bmp);
        canvas.drawColor(Color.TRANSPARENT);

        int len = digits != null ? digits.length() : 1;
        // Near full-icon size (same ballpark as the “bigger” version)
        float textSize = size * (len >= 3 ? 0.72f : len == 1 ? 0.92f : 0.88f);

        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setColor(Color.WHITE);
        paint.setTypeface(Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD));
        paint.setTextAlign(Paint.Align.CENTER);
        paint.setSubpixelText(true);
        paint.setStyle(Paint.Style.FILL);
        paint.setTextSize(textSize);

        Rect bounds = new Rect();
        paint.getTextBounds(digits, 0, digits.length(), bounds);
        float maxW = size * 0.98f;
        float maxH = size * 0.95f;
        if (bounds.width() > maxW && bounds.width() > 0) {
            textSize = textSize * (maxW / bounds.width());
            paint.setTextSize(textSize);
            paint.getTextBounds(digits, 0, digits.length(), bounds);
        }
        if (bounds.height() > maxH && bounds.height() > 0) {
            textSize = textSize * (maxH / bounds.height());
            paint.setTextSize(textSize);
            paint.getTextBounds(digits, 0, digits.length(), bounds);
        }

        float x = size / 2f;
        float y = size / 2f - bounds.exactCenterY();
        canvas.drawText(digits, x, y, paint);
        return bmp;
    }

    private static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel ch = new NotificationChannel(
                CHANNEL_ID,
                "Weather status",
                NotificationManager.IMPORTANCE_LOW
        );
        ch.setDescription("Shows current temperature in the status bar");
        ch.setShowBadge(false);
        ch.enableLights(false);
        ch.enableVibration(false);
        ch.setSound(null, null);
        NotificationManager nm = context.getSystemService(NotificationManager.class);
        if (nm != null) nm.createNotificationChannel(ch);
    }

    private static String stripEmoji(String s) {
        if (s == null) return "";
        return s.replaceAll("^[\\p{So}\\p{Cn}\\s]+", "").trim();
    }
}
