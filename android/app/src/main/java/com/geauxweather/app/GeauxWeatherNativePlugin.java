/*
 * GeauxWeather
 * Copyright (C) 2026 TuneFriend / James
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

package com.geauxweather.app;

import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

/**
 * Bridge from web UI → home widget + status-bar temp + hurricane alerts + CORS-safe HTTP.
 */
@CapacitorPlugin(name = "GeauxWeatherNative")
public class GeauxWeatherNativePlugin extends Plugin {

    @PluginMethod
    public void refreshChrome(PluginCall call) {
        try {
            GeauxWeatherWidgetProvider.refreshAll(getContext());
            WeatherNotificationHelper.update(getContext());
            call.resolve();
        } catch (Exception e) {
            call.reject("refreshChrome failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void setHurricaneAlerts(PluginCall call) {
        try {
            boolean enabled = call.getBoolean("enabled", false);
            HurricaneAlertHelper.setEnabled(getContext(), enabled);
            JSObject ret = new JSObject();
            ret.put("enabled", enabled);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("setHurricaneAlerts failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void checkHurricaneAlerts(PluginCall call) {
        try {
            boolean seedOnly = call.getBoolean("seedOnly", false);
            new Thread(() -> {
                try {
                    HurricaneAlertHelper.check(getContext(), seedOnly);
                    call.resolve();
                } catch (Exception e) {
                    call.reject("checkHurricaneAlerts failed: " + e.getMessage());
                }
            }).start();
        } catch (Exception e) {
            call.reject("checkHurricaneAlerts failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void showHurricaneAlert(PluginCall call) {
        try {
            String title = call.getString("title", "Severe weather");
            String body = call.getString("body", "");
            String tag = call.getString("tag", "severe");
            org.json.JSONObject detail = null;
            com.getcapacitor.JSObject detailObj = call.getObject("detail", null);
            if (detailObj != null) {
                detail = new org.json.JSONObject(detailObj.toString());
            }
            HurricaneAlertHelper.showAlert(getContext(), title, body, tag, detail);
            call.resolve();
        } catch (Exception e) {
            call.reject("showHurricaneAlert failed: " + e.getMessage());
        }
    }

    /**
     * CORS-free HTTP GET for NHC/NOAA (and a few other weather hosts).
     * WebView fetch is blocked by missing Access-Control-Allow-Origin on nhc.noaa.gov.
     *
     * Options: url (required), binary (bool) → bodyBase64 vs body text
     */
    @PluginMethod
    public void httpGet(PluginCall call) {
        final String urlStr = call.getString("url");
        final boolean binary = call.getBoolean("binary", false);
        if (urlStr == null || urlStr.isEmpty()) {
            call.reject("url required");
            return;
        }
        if (!isAllowedUrl(urlStr)) {
            call.reject("host not allowed");
            return;
        }

        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                URL url = new URL(urlStr);
                conn = (HttpURLConnection) url.openConnection();
                conn.setConnectTimeout(20000);
                conn.setReadTimeout(45000);
                conn.setInstanceFollowRedirects(true);
                conn.setRequestProperty("User-Agent", "GeauxWeather/1.0 (Android; FOSS; +https://github.com/tunefriend/GeauxWeather)");
                // NWS api.weather.gov prefers geo+json; others accept anything
                if (urlStr.contains("api.weather.gov")) {
                    conn.setRequestProperty("Accept", "application/geo+json,application/json");
                } else {
                    conn.setRequestProperty("Accept", "*/*");
                }

                int code = conn.getResponseCode();
                InputStream in = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
                byte[] bytes = readAll(in);

                JSObject ret = new JSObject();
                ret.put("status", code);
                if (binary) {
                    ret.put("bodyBase64", Base64.encodeToString(bytes, Base64.NO_WRAP));
                } else {
                    ret.put("body", new String(bytes, StandardCharsets.UTF_8));
                }
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("httpGet failed: " + e.getMessage());
            } finally {
                if (conn != null) conn.disconnect();
            }
        }).start();
    }

    private static boolean isAllowedUrl(String urlStr) {
        try {
            URL u = new URL(urlStr);
            if (!"https".equalsIgnoreCase(u.getProtocol())) return false;
            String host = u.getHost().toLowerCase(Locale.US);
            return host.endsWith(".noaa.gov")
                    || host.equals("noaa.gov")
                    || host.endsWith(".weather.gov")
                    || host.equals("weather.gov")
                    || host.endsWith(".rainviewer.com")
                    || host.equals("rainviewer.com")
                    || host.endsWith(".open-meteo.com")
                    || host.equals("open-meteo.com");
        } catch (Exception e) {
            return false;
        }
    }

    private static byte[] readAll(InputStream in) throws Exception {
        if (in == null) return new byte[0];
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) != -1) {
            bos.write(buf, 0, n);
        }
        in.close();
        return bos.toByteArray();
    }
}
