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
import android.widget.RemoteViews;

import org.json.JSONObject;

/**
 * Home / lock-screen widget. Reads snapshot from Capacitor Preferences
 * (SharedPreferences file "CapacitorStorage", key "geauxweather_widget").
 */
public class GeauxWeatherWidgetProvider extends AppWidgetProvider {

    private static final String PREFS_FILE = "CapacitorStorage";
    private static final String KEY_WIDGET = "geauxweather_widget";

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

        views.setTextViewText(R.id.widget_location, data.location);
        views.setTextViewText(R.id.widget_temp, data.temp);
        views.setTextViewText(R.id.widget_condition, data.condition);
        views.setTextViewText(R.id.widget_hilow, data.hilow);

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
