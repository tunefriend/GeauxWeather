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
import java.util.Locale;
import java.util.concurrent.TimeUnit;

/**
 * Severe storm alerts for the user's home/default location:
 * - NWS point alerts: tornado, severe thunderstorm, tropical
 * - NHC storms within ~500 mi of that location
 *
 * Settings key remains geauxweather_hurricane_alerts ("on"/"off") for compatibility.
 */
public final class HurricaneAlertHelper {

    static final String CHANNEL_ID = "geauxweather_severe";
    static final String WORK_NAME = "geauxweather_severe_alerts";
    private static final String PREFS = "CapacitorStorage";
    private static final String KEY_ENABLED = "geauxweather_hurricane_alerts";
    private static final String KEY_SEEN = "geauxweather_severe_seen_native";
    private static final String KEY_LOC = "geauxweather_location";
    private static final String KEY_DEFAULT = "geauxweather_default";
    private static final String NHC_URL = "https://www.nhc.noaa.gov/CurrentStorms.json";
    private static final int BASE_NOTIF_ID = 7000;
    /** Tropical systems farther than this from home are ignored (miles). */
    private static final double TROPICAL_RADIUS_MI = 500.0;

    private HurricaneAlertHelper() {}

    public static boolean isEnabled(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        return "on".equals(prefs.getString(KEY_ENABLED, "off"));
    }

    public static void setEnabled(Context context, boolean enabled) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        prefs.edit().putString(KEY_ENABLED, enabled ? "on" : "off").apply();
        if (enabled) {
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
                2,
                TimeUnit.HOURS
        )
                .setConstraints(constraints)
                .build();
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                WORK_NAME,
                ExistingPeriodicWorkPolicy.UPDATE,
                req
        );
        // Cancel legacy work name if present
        WorkManager.getInstance(context).cancelUniqueWork("geauxweather_hurricane_alerts");
    }

    public static void cancelSchedule(Context context) {
        WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME);
        WorkManager.getInstance(context).cancelUniqueWork("geauxweather_hurricane_alerts");
    }

    /** @param seedOnly if true, update seen state without notifications */
    public static void check(Context context, boolean seedOnly) {
        if (!isEnabled(context) && !seedOnly) return;
        ensureChannel(context);

        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        double[] loc = resolveLocation(prefs);
        if (loc == null) {
            // No home/default location yet — nothing location-specific to alert on
            return;
        }
        double lat = loc[0];
        double lon = loc[1];
        String placeLabel = resolveLocationLabel(prefs);

        JSONObject prev = loadSeen(prefs);
        JSONObject next = new JSONObject();
        boolean firstRun = prev.length() == 0;
        boolean quiet = seedOnly || firstRun;

        try {
            checkNwsPoint(context, lat, lon, placeLabel, prev, next, quiet);
        } catch (Exception ignored) {
        }
        try {
            checkNhCNearby(context, lat, lon, placeLabel, prev, next, quiet);
        } catch (Exception ignored) {
        }

        prefs.edit().putString(KEY_SEEN, next.toString()).apply();
    }

    public static void showAlert(Context context, String title, String body, String tag) {
        ensureChannel(context);
        int id = BASE_NOTIF_ID + Math.abs((tag != null ? tag : title).hashCode() % 500);
        post(context, id, title, body);
    }

    // ─── NWS local alerts ─────────────────────────────────────────────────

    private static void checkNwsPoint(
            Context context,
            double lat,
            double lon,
            String placeLabel,
            JSONObject prev,
            JSONObject next,
            boolean quiet
    ) throws Exception {
        String url = String.format(
                Locale.US,
                "https://api.weather.gov/alerts/active?status=actual&point=%.4f,%.4f",
                lat,
                lon
        );
        String body = httpGet(url, "application/geo+json,application/json");
        if (body == null || body.isEmpty()) return;

        JSONObject root = new JSONObject(body);
        JSONArray features = root.optJSONArray("features");
        if (features == null) return;

        for (int i = 0; i < features.length(); i++) {
            JSONObject f = features.optJSONObject(i);
            if (f == null) continue;
            JSONObject props = f.optJSONObject("properties");
            if (props == null) continue;
            String event = props.optString("event", "");
            if (!isSevereEvent(event)) continue;

            String alertId = props.optString("id", "");
            if (alertId.isEmpty()) {
                alertId = event + "|" + props.optString("sent", "") + "|" + props.optString("areaDesc", "");
            }
            String key = "nws:" + alertId;
            String headline = props.optString("headline", event);
            String area = props.optString("areaDesc", placeLabel);
            String severity = props.optString("severity", "");

            JSONObject fp = new JSONObject();
            fp.put("event", event);
            fp.put("headline", headline);
            next.put(key, fp);

            if (quiet) continue;
            if (prev.optJSONObject(key) != null) continue;

            String title = event;
            String text = area;
            if (!severity.isEmpty()) text = severity + " · " + text;
            if (placeLabel != null && !placeLabel.isEmpty()) {
                text = text + " · near " + placeLabel;
            }
            post(
                    context,
                    BASE_NOTIF_ID + Math.abs(key.hashCode() % 500),
                    title,
                    text
            );
        }
    }

    private static boolean isSevereEvent(String event) {
        if (event == null) return false;
        String e = event.toLowerCase(Locale.US);
        return e.contains("tornado")
                || e.contains("severe thunderstorm")
                || e.contains("hurricane")
                || e.contains("tropical storm")
                || e.contains("tropical depression")
                || e.contains("storm surge")
                || e.contains("extreme wind");
    }

    // ─── NHC tropical near location ───────────────────────────────────────

    private static void checkNhCNearby(
            Context context,
            double lat,
            double lon,
            String placeLabel,
            JSONObject prev,
            JSONObject next,
            boolean quiet
    ) throws Exception {
        String body = httpGet(NHC_URL, "application/json");
        if (body == null || body.isEmpty()) return;

        JSONObject root = new JSONObject(body);
        JSONArray storms = root.optJSONArray("activeStorms");
        if (storms == null) return;

        for (int i = 0; i < storms.length(); i++) {
            JSONObject s = storms.optJSONObject(i);
            if (s == null) continue;

            double slat = s.optDouble("latitudeNumeric", Double.NaN);
            double slon = s.optDouble("longitudeNumeric", Double.NaN);
            if (Double.isNaN(slat) || Double.isNaN(slon)) continue;

            double distMi = haversineMiles(lat, lon, slat, slon);
            if (distMi > TROPICAL_RADIUS_MI) continue;

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

            String key = "nhc:" + id;
            JSONObject fp = new JSONObject();
            fp.put("name", name);
            fp.put("classification", classification);
            fp.put("intensity", intensity);
            fp.put("adv", adv);
            fp.put("distMi", Math.round(distMi));
            next.put(key, fp);

            if (quiet) continue;

            JSONObject old = prev.optJSONObject(key);
            String near = Math.round(distMi) + " mi from " + (placeLabel != null && !placeLabel.isEmpty() ? placeLabel : "you");
            if (old == null) {
                post(
                        context,
                        BASE_NOTIF_ID + Math.abs(key.hashCode() % 500),
                        "Tropical cyclone near you",
                        classification + " " + name
                                + (intensity.isEmpty() ? "" : " · " + intensity + " kt")
                                + " · " + near
                );
            } else {
                String oldAdv = old.optString("adv", "");
                if (!adv.isEmpty() && !adv.equals(oldAdv)) {
                    post(
                            context,
                            BASE_NOTIF_ID + Math.abs((key + adv).hashCode() % 500),
                            name + " — new advisory",
                            "Advisory #" + adv
                                    + (intensity.isEmpty() ? "" : " · " + intensity + " kt")
                                    + " · " + near
                    );
                } else {
                    try {
                        int oldKt = Integer.parseInt(old.optString("intensity", "0"));
                        int newKt = Integer.parseInt(intensity.isEmpty() ? "0" : intensity);
                        if (newKt > oldKt + 5) {
                            post(
                                    context,
                                    BASE_NOTIF_ID + Math.abs((key + intensity).hashCode() % 500),
                                    name + " strengthened",
                                    oldKt + " → " + newKt + " kt · " + near
                            );
                        }
                    } catch (NumberFormatException ignored) {
                    }
                }
            }
        }
    }

    // ─── Location ─────────────────────────────────────────────────────────

    /** @return [lat, lon] or null */
    private static double[] resolveLocation(SharedPreferences prefs) {
        double[] fromHome = parseLatLon(prefs.getString(KEY_LOC, null));
        if (fromHome != null) return fromHome;
        return parseLatLon(prefs.getString(KEY_DEFAULT, null));
    }

    private static String resolveLocationLabel(SharedPreferences prefs) {
        String label = parseLabel(prefs.getString(KEY_LOC, null));
        if (label != null && !label.isEmpty()) return label;
        label = parseLabel(prefs.getString(KEY_DEFAULT, null));
        return label != null ? label : "your location";
    }

    private static double[] parseLatLon(String raw) {
        if (raw == null || raw.isEmpty()) return null;
        try {
            JSONObject o = new JSONObject(raw);
            if (!o.has("lat") || !o.has("lon")) return null;
            return new double[]{o.getDouble("lat"), o.getDouble("lon")};
        } catch (Exception e) {
            return null;
        }
    }

    private static String parseLabel(String raw) {
        if (raw == null || raw.isEmpty()) return null;
        try {
            return new JSONObject(raw).optString("label", "");
        } catch (Exception e) {
            return null;
        }
    }

    private static JSONObject loadSeen(SharedPreferences prefs) {
        // Prefer new key; fall back to old hurricane-only seen map once
        String seenRaw = prefs.getString(KEY_SEEN, null);
        if (seenRaw == null || seenRaw.isEmpty()) {
            seenRaw = prefs.getString("geauxweather_hurricane_seen_native", "{}");
        }
        try {
            return new JSONObject(seenRaw);
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    private static double haversineMiles(double lat1, double lon1, double lat2, double lon2) {
        double R = 3958.8; // Earth radius miles
        double dLat = Math.toRadians(lat2 - lat1);
        double dLon = Math.toRadians(lon2 - lon1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
                + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
                * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        double c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
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
                .setContentTitle(title != null ? title : "Severe weather")
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
        }
    }

    private static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel ch = new NotificationChannel(
                CHANNEL_ID,
                "Severe storm alerts",
                NotificationManager.IMPORTANCE_DEFAULT
        );
        ch.setDescription("Tornado, severe thunderstorm, and nearby tropical cyclone alerts for your location");
        ch.setShowBadge(true);
        NotificationManager nm = context.getSystemService(NotificationManager.class);
        if (nm != null) nm.createNotificationChannel(ch);
    }

    private static String httpGet(String urlStr, String accept) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(urlStr).openConnection();
        conn.setConnectTimeout(20000);
        conn.setReadTimeout(30000);
        conn.setRequestProperty(
                "User-Agent",
                "GeauxWeather/1.0 (Android; FOSS; +https://github.com/tunefriend/GeauxWeather)"
        );
        conn.setRequestProperty("Accept", accept != null ? accept : "*/*");
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
