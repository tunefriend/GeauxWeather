package com.geauxweather.app;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Bridge from web UI → home widget + status-bar temp notification.
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
}
