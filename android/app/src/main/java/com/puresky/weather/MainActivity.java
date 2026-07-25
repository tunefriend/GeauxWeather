package com.puresky.weather;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final int REQ_POST_NOTIFICATIONS = 1001;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PureSkyNativePlugin.class);
        super.onCreate(savedInstanceState);
        requestNotifPermissionIfNeeded();
        PureSkyWidgetProvider.refreshAll(this);
        WeatherNotificationHelper.update(this);
    }

    @Override
    public void onResume() {
        super.onResume();
        PureSkyWidgetProvider.refreshAll(this);
        WeatherNotificationHelper.update(this);
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
