package com.puresky.weather

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.widget.RemoteViews
import org.json.JSONObject

/**
 * Home-screen widget. Reads snapshot written by the web UI via
 * Capacitor Preferences (SharedPreferences file "CapacitorStorage",
 * key "puresky_widget").
 *
 * Drop this file into:
 *   android/app/src/main/java/com/puresky/weather/PureSkyWidgetProvider.kt
 */
class PureSkyWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray
    ) {
        for (id in appWidgetIds) {
            updateAppWidget(context, appWidgetManager, id)
        }
    }

    companion object {
        private const val PREFS_FILE = "CapacitorStorage"
        private const val KEY_WIDGET = "puresky_widget"

        fun updateAppWidget(
            context: Context,
            appWidgetManager: AppWidgetManager,
            appWidgetId: Int
        ) {
            val views = RemoteViews(context.packageName, R.layout.puresky_widget)
            val data = readSnapshot(context)

            views.setTextViewText(R.id.widget_location, data.location)
            views.setTextViewText(R.id.widget_temp, data.temp)
            views.setTextViewText(R.id.widget_condition, data.condition)
            views.setTextViewText(R.id.widget_hilow, data.hilow)

            // Tap → open main activity
            val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
            if (launch != null) {
                launch.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                val pi = PendingIntent.getActivity(
                    context,
                    appWidgetId,
                    launch,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
                views.setOnClickPendingIntent(R.id.widget_root, pi)
            }

            appWidgetManager.updateAppWidget(appWidgetId, views)
        }

        private data class Snapshot(
            val location: String,
            val temp: String,
            val condition: String,
            val hilow: String
        )

        private fun readSnapshot(context: Context): Snapshot {
            val fallback = Snapshot("PureSky", "—°", "Open app to load", "H —°  L —°")
            return try {
                val prefs: SharedPreferences =
                    context.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE)
                val raw = prefs.getString(KEY_WIDGET, null) ?: return fallback
                val o = JSONObject(raw)
                val loc = o.optString("label", "PureSky")
                val temp = o.optString("temp", "—°")
                val cond = o.optString("condition", "—")
                val high = o.optString("high", "—")
                val low = o.optString("low", "—")
                Snapshot(loc, temp, cond, "H $high  L $low")
            } catch (_: Exception) {
                fallback
            }
        }
    }
}
