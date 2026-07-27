package com.geauxweather.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Bridge from web UI → home widget + status-bar temp + hurricane alerts.
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
            // Network on background thread
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
            String title = call.getString("title", "Hurricane alert");
            String body = call.getString("body", "");
            String tag = call.getString("tag", "hurricane");
            HurricaneAlertHelper.showAlert(getContext(), title, body, tag);
            call.resolve();
        } catch (Exception e) {
            call.reject("showHurricaneAlert failed: " + e.getMessage());
        }
    }
}
