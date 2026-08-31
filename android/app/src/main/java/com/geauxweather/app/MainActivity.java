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

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    private static final int REQ_POST_NOTIFICATIONS = 1001;
    private String pendingAlertJson = null;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(GeauxWeatherNativePlugin.class);
        super.onCreate(savedInstanceState);
        applySystemTextZoom();
        requestNotifPermissionIfNeeded();
        GeauxWeatherWidgetProvider.refreshAll(this);
        WeatherNotificationHelper.update(this);
        if (HurricaneAlertHelper.isEnabled(this)) {
            HurricaneAlertHelper.schedule(this);
            new Thread(() -> HurricaneAlertHelper.check(this, false)).start();
        }
        captureAlertIntent(getIntent());
        // WebView may not be ready yet — retry shortly
        scheduleDeliverAlert(400);
        scheduleDeliverAlert(1200);
    }

    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        captureAlertIntent(intent);
        scheduleDeliverAlert(200);
    }

    @Override
    public void onResume() {
        super.onResume();
        applySystemTextZoom();
        GeauxWeatherWidgetProvider.refreshAll(this);
        WeatherNotificationHelper.update(this);
        if (HurricaneAlertHelper.isEnabled(this)) {
            new Thread(() -> HurricaneAlertHelper.check(this, false)).start();
        }
        // Prefer intent extra; also pick up SharedPreferences pending alert
        if (pendingAlertJson == null) {
            String stored = HurricaneAlertHelper.takePendingAlertJson(this);
            if (stored != null && !stored.isEmpty()) pendingAlertJson = stored;
        }
        scheduleDeliverAlert(300);
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        applySystemTextZoom();
    }

    private void captureAlertIntent(Intent intent) {
        if (intent == null) return;
        String json = intent.getStringExtra(HurricaneAlertHelper.EXTRA_ALERT_JSON);
        if (json != null && !json.isEmpty()) {
            pendingAlertJson = json;
            // Consume so rotation / relaunch doesn't re-open forever
            intent.removeExtra(HurricaneAlertHelper.EXTRA_ALERT_JSON);
        }
    }

    private void scheduleDeliverAlert(long delayMs) {
        if (pendingAlertJson == null) return;
        final String json = pendingAlertJson;
        new android.os.Handler(getMainLooper()).postDelayed(
                () -> deliverAlertToWeb(json),
                delayMs
        );
    }

    private void deliverAlertToWeb(String json) {
        if (json == null || json.isEmpty()) return;
        try {
            if (getBridge() == null || getBridge().getWebView() == null) return;
            // Validate JSON then pass as a JS string literal
            new JSONObject(json);
            String escaped = JSONObject.quote(json);
            String js =
                    "(function(){try{"
                            + "var raw=" + escaped + ";"
                            + "var detail=typeof raw==='string'?JSON.parse(raw):raw;"
                            + "if(window.PureSkySevere&&typeof window.PureSkySevere.openFromNotification==='function'){"
                            + "window.PureSkySevere.openFromNotification(detail);"
                            + "}else{"
                            + "window.__geauxPendingSevere=detail;"
                            + "}"
                            + "}catch(e){console.warn('alert deep link',e);}})();";
            getBridge().getWebView().post(() -> {
                try {
                    getBridge().getWebView().evaluateJavascript(js, null);
                    pendingAlertJson = null;
                    // Also clear any leftover prefs copy
                    HurricaneAlertHelper.takePendingAlertJson(MainActivity.this);
                } catch (Exception ignored) {
                }
            });
        } catch (Exception ignored) {
        }
    }

    /**
     * Honor Android Settings → Display size & text (fontScale).
     * Without this, fixed layout boxes clip text (e.g. "Updated" → "Undated").
     */
    private void applySystemTextZoom() {
        try {
            if (getBridge() == null || getBridge().getWebView() == null) return;
            WebView webView = getBridge().getWebView();
            WebSettings settings = webView.getSettings();
            float fontScale = getResources().getConfiguration().fontScale;
            if (fontScale <= 0f) fontScale = 1f;
            float zoom = Math.min(Math.max(fontScale, 0.85f), 1.6f) * 100f;
            settings.setTextZoom(Math.round(zoom));
        } catch (Exception ignored) {
        }
    }

    private void requestNotifPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return;
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED) {
            return;
        }
        ActivityCompat.requestPermissions(
                this,
                new String[]{Manifest.permission.POST_NOTIFICATIONS},
                REQ_POST_NOTIFICATIONS
        );
    }
}
