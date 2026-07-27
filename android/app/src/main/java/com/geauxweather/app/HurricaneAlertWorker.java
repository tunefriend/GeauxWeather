package com.geauxweather.app;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

/** Background NHC poll for hurricane notifications. */
public class HurricaneAlertWorker extends Worker {

    public HurricaneAlertWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        try {
            if (!HurricaneAlertHelper.isEnabled(getApplicationContext())) {
                return Result.success();
            }
            HurricaneAlertHelper.check(getApplicationContext(), false);
            return Result.success();
        } catch (Exception e) {
            return Result.retry();
        }
    }
}
