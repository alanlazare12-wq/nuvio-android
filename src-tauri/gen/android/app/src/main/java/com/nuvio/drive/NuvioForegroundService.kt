package com.nuvio.drive

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat

class NuvioForegroundService : Service() {
    companion object {
        const val CHANNEL_ID = "nuvio_status_channel"
        const val FOREGROUND_NOTIFICATION_ID = 2000
        const val ACTION_START_SYNC = "com.nuvio.drive.ACTION_START_SYNC"
        const val ACTION_UPDATE_SYNC = "com.nuvio.drive.ACTION_UPDATE_SYNC"
        const val ACTION_STOP_SYNC = "com.nuvio.drive.ACTION_STOP_SYNC"
        const val ACTION_START_UPLOAD = "com.nuvio.drive.ACTION_START_UPLOAD"
        const val ACTION_UPDATE_UPLOAD = "com.nuvio.drive.ACTION_UPDATE_UPLOAD"
        const val ACTION_STOP_UPLOAD = "com.nuvio.drive.ACTION_STOP_UPLOAD"

        @Volatile
        var isSyncActive: Boolean = false
            private set

        @Volatile
        var isUploadActive: Boolean = false
            private set

        val isWorking: Boolean
            get() = isSyncActive || isUploadActive
    }

    private var wakeLock: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        ensureNotificationChannel()
        acquireWakeLock()
    }

    private fun ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val name = "Estado y transferencias de Nuvio"
            val descriptionText = "Progreso de sincronización y transferencias en segundo plano"
            val channel = NotificationChannel(CHANNEL_ID, name, NotificationManager.IMPORTANCE_LOW).apply {
                description = descriptionText
                setShowBadge(false)
            }
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
            manager?.createNotificationChannel(channel)
        }
    }

    private fun acquireWakeLock() {
        if (wakeLock == null) {
            val powerManager = getSystemService(Context.POWER_SERVICE) as? PowerManager
            wakeLock = powerManager?.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "Nuvio::SyncWakeLock"
            )?.apply {
                setReferenceCounted(false)
            }
        }
        if (wakeLock?.isHeld == false) {
            wakeLock?.acquire(45 * 60 * 1000L)
        }
    }

    private fun releaseWakeLock() {
        try {
            if (wakeLock?.isHeld == true) {
                wakeLock?.release()
            }
        } catch (_: Exception) {}
    }

    private fun getLaunchPendingIntent(): PendingIntent? {
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        } ?: return null
        return PendingIntent.getActivity(
            this,
            0,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent == null) {
            if (!isWorking) {
                stopSelf()
            }
            return START_NOT_STICKY
        }

        val action = intent.action
        val title = intent.getStringExtra("title") ?: "Nuvio Drive"
        val content = intent.getStringExtra("content") ?: "Sincronizando en segundo plano…"
        val percent = if (intent.hasExtra("percent")) intent.getIntExtra("percent", -1) else -1
        val indeterminate = intent.getBooleanExtra("indeterminate", false)

        when (action) {
            ACTION_START_SYNC, ACTION_UPDATE_SYNC -> {
                isSyncActive = true
                acquireWakeLock()
                startForegroundWithNotification(title, content, percent, indeterminate, android.R.drawable.stat_notify_sync)
            }
            ACTION_STOP_SYNC -> {
                isSyncActive = false
                if (!isWorking) {
                    stopServiceSafely()
                }
            }
            ACTION_START_UPLOAD, ACTION_UPDATE_UPLOAD -> {
                isUploadActive = true
                acquireWakeLock()
                startForegroundWithNotification(title, content, percent, indeterminate, android.R.drawable.stat_sys_upload)
            }
            ACTION_STOP_UPLOAD -> {
                isUploadActive = false
                if (!isWorking) {
                    stopServiceSafely()
                }
            }
        }

        return START_STICKY
    }

    private fun startForegroundWithNotification(
        title: String,
        content: String,
        percent: Int,
        indeterminate: Boolean,
        iconRes: Int
    ) {
        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(iconRes)
            .setContentTitle(title)
            .setContentText(content)
            .setContentIntent(getLaunchPendingIntent())
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)

        if (indeterminate) {
            builder.setProgress(100, 0, true)
        } else if (percent in 0..100) {
            builder.setProgress(100, percent, false)
        }

        val notification = builder.build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                FOREGROUND_NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            )
        } else {
            startForeground(FOREGROUND_NOTIFICATION_ID, notification)
        }
    }

    private fun stopServiceSafely() {
        releaseWakeLock()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION")
            stopForeground(true)
        }
        stopSelf()
    }

    override fun onDestroy() {
        super.onDestroy()
        isSyncActive = false
        isUploadActive = false
        releaseWakeLock()
    }
}
