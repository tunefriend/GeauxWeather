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
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final int REQ_POST_NOTIFICATIONS = 1001;

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
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        // Font size / Display size changed in system settings
        applySystemTextZoom();
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
            // Cap extreme scales so the UI stays usable; layout still flexes via CSS
            float zoom = Math.min(Math.max(fontScale, 0.85f), 1.6f) * 100f;
            settings.setTextZoom(Math.round(zoom));
        } catch (Exception ignored) {
            // Bridge may not be ready yet
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
