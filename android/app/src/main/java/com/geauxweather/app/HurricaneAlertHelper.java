package com.geauxweather.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;

/**
 * Poll NHC CurrentStorms.json and post notifications for new storms / advisories.
 * Scheduled via WorkManager when Settings → Hurricane alerts is on.
 */
public final class HurricaneAlertHelper {

    static final String CHANNEL_ID = "geauxweather_hurricane";
    static final String WORK_NAME = "geauxweather_hurricane_alerts";
    private static final String PREFS = "CapacitorStorage";
    private static final String KEY_ENABLED = "geauxweather_hurricane_alerts";
    private static final String KEY_SEEN = "geauxweather_hurricane_seen_native";
    private static final String NHC_URL = "https://www.nhc.noaa.gov/CurrentStorms.json";
    private static final int BASE_NOTIF_ID = 7000;

    private HurricaneAlertHelper() {}

    public static boolean isEnabled(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        return "on".equals(prefs.getString(KEY_ENABLED, "off"));
    }

    public static void setEnabled(Context context, boolean enabled) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        prefs.edit().putString(KEY_ENABLED, enabled ? "on" : "off").apply();
        if (enabled) {
            // Seed without notifying so enabling doesn't spam current storms
            check(context, true);
            schedule(context);
        } else {
            cancelSchedule(context);
        }
    }

    public static void schedule(Context context) {
        Constraints constraints = new Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build();
        PeriodicWorkRequest req = new PeriodicWorkRequest.Builder(
                HurricaneAlertWorker.class,
                3,
                TimeUnit.HOURS
        )
                .setConstraints(constraints)
                .build();
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                WORK_NAME,
                ExistingPeriodicWorkPolicy.UPDATE,
                req
        );
    }

    public static void cancelSchedule(Context context) {
        WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME);
    }

    /** @param seedOnly if true, update seen state without notifications */
    public static void check(Context context, boolean seedOnly) {
        if (!isEnabled(context) && !seedOnly) return;
        ensureChannel(context);

        try {
            String body = httpGet(NHC_URL);
            if (body == null || body.isEmpty()) return;

            JSONObject root = new JSONObject(body);
            JSONArray storms = root.optJSONArray("activeStorms");
            if (storms == null) storms = new JSONArray();

            SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            String seenRaw = prefs.getString(KEY_SEEN, "{}");
            JSONObject prev;
            try {
                prev = new JSONObject(seenRaw);
            } catch (Exception e) {
                prev = new JSONObject();
            }
            JSONObject next = new JSONObject();
            boolean firstRun = prev.length() == 0;

            for (int i = 0; i < storms.length(); i++) {
                JSONObject s = storms.optJSONObject(i);
                if (s == null) continue;
                String id = s.optString("id", s.optString("name", ""));
                if (id.isEmpty()) continue;

                String name = s.optString("name", id);
                String classification = s.optString("classification", "");
                String intensity = s.optString("intensity", "");
                String adv = "";
                JSONObject ft = s.optJSONObject("forecastTrack");
                if (ft != null) adv = ft.optString("advNum", "");
                if (adv.isEmpty()) {
                    JSONObject pa = s.optJSONObject("publicAdvisory");
                    if (pa != null) adv = pa.optString("advNum", "");
                }

                JSONObject fp = new JSONObject();
                fp.put("name", name);
                fp.put("classification", classification);
                fp.put("intensity", intensity);
                fp.put("adv", adv);
                next.put(id, fp);

                if (seedOnly || firstRun) continue;

                JSONObject old = prev.optJSONObject(id);
                if (old == null) {
                    post(
                            context,
                            BASE_NOTIF_ID + Math.abs(id.hashCode() % 500),
                            "New tropical cyclone",
                            classification + " " + name
                                    + (intensity.isEmpty() ? "" : " · " + intensity + " kt")
                    );
                } else {
                    String oldAdv = old.optString("adv", "");
                    if (!adv.isEmpty() && !adv.equals(oldAdv)) {
                        post(
                                context,
                                BASE_NOTIF_ID + Math.abs((id + adv).hashCode() % 500),
                                name + " — new advisory",
                                "Advisory #" + adv
                                        + (intensity.isEmpty() ? "" : " · " + intensity + " kt")
                                        + (classification.isEmpty() ? "" : " · " + classification)
                        );
                    } else {
                        try {
                            int oldKt = Integer.parseInt(old.optString("intensity", "0"));
                            int newKt = Integer.parseInt(intensity.isEmpty() ? "0" : intensity);
                            if (newKt > oldKt + 5) {
                                post(
                                        context,
                                        BASE_NOTIF_ID + Math.abs((id + intensity).hashCode() % 500),
                                        name + " strengthened",
                                        oldKt + " → " + newKt + " kt"
                                );
                            }
                        } catch (NumberFormatException ignored) {
                        }
                    }
                }
            }

            prefs.edit().putString(KEY_SEEN, next.toString()).apply();
        } catch (Exception e) {
            // offline / parse — skip
        }
    }

    public static void showAlert(Context context, String title, String body, String tag) {
        ensureChannel(context);
        int id = BASE_NOTIF_ID + Math.abs((tag != null ? tag : title).hashCode() % 500);
        post(context, id, title, body);
    }

    private static void post(Context context, int id, String title, String body) {
        Intent launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        PendingIntent pi = null;
        if (launch != null) {
            launch.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            pi = PendingIntent.getActivity(
                    context,
                    id,
                    launch,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
        }

        NotificationCompat.Builder b = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_rain)
                .setContentTitle(title != null ? title : "Hurricane alert")
                .setContentText(body != null ? body : "")
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setAutoCancel(true)
                .setOnlyAlertOnce(true);

        if (pi != null) b.setContentIntent(pi);

        try {
            NotificationManagerCompat.from(context).notify(id, b.build());
        } catch (SecurityException ignored) {
            // POST_NOTIFICATIONS not granted
        }
    }

    private static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel ch = new NotificationChannel(
                CHANNEL_ID,
                "Hurricane alerts",
                NotificationManager.IMPORTANCE_DEFAULT
        );
        ch.setDescription("New storms and NHC advisory updates");
        ch.setShowBadge(true);
        NotificationManager nm = context.getSystemService(NotificationManager.class);
        if (nm != null) nm.createNotificationChannel(ch);
    }

    private static String httpGet(String urlStr) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(urlStr).openConnection();
        conn.setConnectTimeout(20000);
        conn.setReadTimeout(25000);
        conn.setRequestProperty("User-Agent", "GeauxWeather/1.0 (Android; FOSS)");
        conn.setRequestProperty("Accept", "application/json");
        try {
            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) return null;
            BufferedReader br = new BufferedReader(
                    new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8)
            );
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = br.readLine()) != null) sb.append(line);
            br.close();
            return sb.toString();
        } finally {
            conn.disconnect();
        }
    }
}
