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

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.widget.RemoteViews;

import org.json.JSONObject;

/**
 * Home / lock-screen widget. Reads snapshot + style from Capacitor Preferences
 * (SharedPreferences file "CapacitorStorage").
 *
 * Keys:
 *   geauxweather_widget       — weather snapshot JSON
 *   geauxweather_widget_style — { bgOpacity 0–100, bgColor "#rrggbb", textColor "#rrggbb" }
 */
public class GeauxWeatherWidgetProvider extends AppWidgetProvider {

    private static final String PREFS_FILE = "CapacitorStorage";
    private static final String KEY_WIDGET = "geauxweather_widget";
    private static final String KEY_STYLE = "geauxweather_widget_style";

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int id : appWidgetIds) {
            updateAppWidget(context, appWidgetManager, id);
        }
    }

    public static void refreshAll(Context context) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(context);
        ComponentName cn = new ComponentName(context, GeauxWeatherWidgetProvider.class);
        int[] ids = mgr.getAppWidgetIds(cn);
        if (ids == null || ids.length == 0) return;
        for (int id : ids) {
            updateAppWidget(context, mgr, id);
        }
    }

    static void updateAppWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.geaux_widget);
        Snapshot data = readSnapshot(context);
        Style style = readStyle(context);

        views.setTextViewText(R.id.widget_location, data.location);
        views.setTextViewText(R.id.widget_temp, data.temp);
        views.setTextViewText(R.id.widget_condition, data.condition);
        views.setTextViewText(R.id.widget_hilow, data.hilow);

        applyStyle(views, style);

        Intent launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (launch != null) {
            launch.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent pi = PendingIntent.getActivity(
                    context,
                    appWidgetId,
                    launch,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
            views.setOnClickPendingIntent(R.id.widget_root, pi);
        }

        appWidgetManager.updateAppWidget(appWidgetId, views);
    }

    private static void applyStyle(RemoteViews views, Style style) {
        int bg = withAlpha(style.bgColor, style.bgOpacity);
        // RemoteViews: setBackgroundColor on the root LinearLayout
        views.setInt(R.id.widget_root, "setBackgroundColor", bg);

        int text = style.textColor;
        int muted = Color.argb(
                0xC0,
                Color.red(text),
                Color.green(text),
                Color.blue(text)
        );
        int dim = Color.argb(
                0x99,
                Color.red(text),
                Color.green(text),
                Color.blue(text)
        );

        views.setTextColor(R.id.widget_temp, text);
        views.setTextColor(R.id.widget_condition, muted);
        views.setTextColor(R.id.widget_location, dim);
        views.setTextColor(R.id.widget_hilow, dim);
    }

    private static int withAlpha(int color, int opacity0to100) {
        int a = Math.max(0, Math.min(100, opacity0to100));
        int alpha = Math.round(a * 255f / 100f);
        return Color.argb(alpha, Color.red(color), Color.green(color), Color.blue(color));
    }

    private static int parseHexColor(String hex, int fallback) {
        if (hex == null || hex.isEmpty()) return fallback;
        try {
            String h = hex.trim();
            if (!h.startsWith("#")) h = "#" + h;
            // Support #RGB
            if (h.length() == 4) {
                char r = h.charAt(1), g = h.charAt(2), b = h.charAt(3);
                h = "#" + r + r + g + g + b + b;
            }
            return Color.parseColor(h);
        } catch (Exception e) {
            return fallback;
        }
    }

    private static class Style {
        final int bgOpacity; // 0–100
        final int bgColor;   // RGB
        final int textColor; // RGB

        Style(int bgOpacity, int bgColor, int textColor) {
            this.bgOpacity = bgOpacity;
            this.bgColor = bgColor;
            this.textColor = textColor;
        }
    }

    private static Style readStyle(Context context) {
        // Default: fully transparent, white text (1.0.7 look)
        Style fallback = new Style(0, Color.parseColor("#141A22"), Color.WHITE);
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE);
            String raw = prefs.getString(KEY_STYLE, null);
            if (raw == null) return fallback;
            JSONObject o = new JSONObject(raw);
            int opacity = o.optInt("bgOpacity", 0);
            int bg = parseHexColor(o.optString("bgColor", "#141A22"), Color.parseColor("#141A22"));
            int text = parseHexColor(o.optString("textColor", "#FFFFFF"), Color.WHITE);
            return new Style(opacity, bg, text);
        } catch (Exception e) {
            return fallback;
        }
    }

    private static class Snapshot {
        final String location;
        final String temp;
        final String condition;
        final String hilow;

        Snapshot(String location, String temp, String condition, String hilow) {
            this.location = location;
            this.temp = temp;
            this.condition = condition;
            this.hilow = hilow;
        }
    }

    private static Snapshot readSnapshot(Context context) {
        Snapshot fallback = new Snapshot("GeauxWeather", "—°", "Open app to load", "H —°  L —°");
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE);
            String raw = prefs.getString(KEY_WIDGET, null);
            if (raw == null) return fallback;
            JSONObject o = new JSONObject(raw);
            String loc = o.optString("label", "GeauxWeather");
            String temp = o.optString("temp", "—°");
            String cond = o.optString("condition", "—");
            String high = o.optString("high", "—");
            String low = o.optString("low", "—");
            return new Snapshot(loc, temp, cond, "H " + high + "  L " + low);
        } catch (Exception e) {
            return fallback;
        }
    }
}
