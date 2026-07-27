package com.geauxweather.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Reschedule hurricane alert work after reboot. */
public class HurricaneBootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())
                && !"android.intent.action.QUICKBOOT_POWERON".equals(intent.getAction())) {
            return;
        }
        if (HurricaneAlertHelper.isEnabled(context)) {
            HurricaneAlertHelper.schedule(context);
        }
    }
}
