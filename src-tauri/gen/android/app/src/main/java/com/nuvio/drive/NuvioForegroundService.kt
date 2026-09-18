package com.nuvio.drive

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

class NuvioForegroundService : Service() {
    companion object {
        const val CHANNEL_ID = "nuvio_status_channel"
        const val FOREGROUND_NOTIFICATION_ID = 2000
        const val SYNC_NOTIFICATION_ID = 1001
        const val UPLOAD_NOTIFICATION_ID = 1002
        const val ACTION_UPDATE_SYNC = "com.nuvio.drive.ACTION_UPDATE_SYNC"
        const val ACTION_STOP_SYNC = "com.nuvio.drive.ACTION_STOP_SYNC"
        const val ACTION_UPDATE_UPLOAD = "com.nuvio.drive.ACTION_UPDATE_UPLOAD"
        const val ACTION_STOP_UPLOAD = "com.nuvio.drive.ACTION_STOP_UPLOAD"
        @Volatile private var instance: NuvioForegroundService? = null
        private var starting = false
        private val pending = mutableListOf<Intent>()
        @Volatile private var timedOut = false
        @Volatile var isSyncActive = false; private set
        @Volatile var isUploadActive = false; private set
        val isWorking: Boolean get() = isSyncActive || isUploadActive

        fun allowRestart() { timedOut = false }
        // Called on the main thread. Existing service updates never try to launch a
        // new foreground service from the background or depend on WebView timers.
        fun dispatch(context: Context, data: Intent) {
            val active = data.action == ACTION_UPDATE_SYNC || data.action == ACTION_UPDATE_UPLOAD
            if (active && timedOut) error("Android limitó el trabajo en segundo plano. Abre Nuvio para continuar.")
            if (starting) { pending.add(Intent(data)); return }
            instance?.let { it.handle(data); return }
            if (active) {
                ContextCompat.startForegroundService(context, Intent(data).setClass(context, NuvioForegroundService::class.java))
                starting = true
            }
            else postCompletion(context, data)
        }
        private fun channel(context: Context) {
            val manager = context.getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, "Estado y transferencias de Nuvio", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Progreso de sincronización y subidas en segundo plano"
                setShowBadge(false)
            })
        }
        private fun launch(context: Context): PendingIntent? {
            val intent = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
            intent.flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            return PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        }
        private fun builder(context: Context, data: Intent, upload: Boolean, active: Boolean): NotificationCompat.Builder {
            val text = NuvioNotificationContent.text(data, upload, active)
            val result = NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(if (upload) android.R.drawable.stat_sys_upload else android.R.drawable.stat_notify_sync)
                .setContentTitle(NuvioNotificationContent.title(data, upload, active))
                .setContentText(text.lineSequence().first())
                .setStyle(NotificationCompat.BigTextStyle().bigText(text))
                .setContentIntent(launch(context)).setOngoing(active).setAutoCancel(!active)
                .setOnlyAlertOnce(true)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE).setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(if (active) NotificationCompat.CATEGORY_PROGRESS else NotificationCompat.CATEGORY_STATUS)
                .setShowWhen(false)
            if (active) result.setProgress(100, data.getIntExtra("percent", 0).coerceIn(0, 99), !data.hasExtra("percent"))
            return result
        }
        private fun postCompletion(context: Context, data: Intent) {
            val upload = data.action == ACTION_STOP_UPLOAD
            val manager = context.getSystemService(NotificationManager::class.java)
            if (data.getStringExtra("phase") == "startup") return
            if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
            channel(context)
            manager.notify(if (upload) UPLOAD_NOTIFICATION_ID else SYNC_NOTIFICATION_ID, builder(context, data, upload, false).build())
        }
    }

    private var sync: Intent? = null
    private var upload: Intent? = null
    private var wakeLock: PowerManager.WakeLock? = null
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onCreate() { super.onCreate(); instance = this; channel(this) }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent == null) { stopSelf(); return START_NOT_STICKY }
        starting = false
        val queued = listOf(intent) + pending.toList()
        pending.clear()
        // Android requires startForeground even if work finished before this
        // callback. Promote the initial request before applying queued stops.
        updateState(intent)
        refreshForeground()
        for (data in queued.drop(1)) updateState(data)
        if (queued.size > 1) refreshForeground()
        for (data in queued) if (data.action == ACTION_STOP_SYNC || data.action == ACTION_STOP_UPLOAD) postCompletion(this, data)
        return START_NOT_STICKY
    }
    private fun handle(data: Intent) {
        updateState(data)
        refreshForeground()
        if (data.action == ACTION_STOP_SYNC || data.action == ACTION_STOP_UPLOAD) postCompletion(this, data)
    }
    private fun updateState(data: Intent) {
        val manager = getSystemService(NotificationManager::class.java)
        when (data.action) {
            ACTION_UPDATE_SYNC -> { sync = Intent(data); manager.cancel(SYNC_NOTIFICATION_ID) }
            ACTION_UPDATE_UPLOAD -> { upload = Intent(data); manager.cancel(UPLOAD_NOTIFICATION_ID) }
            ACTION_STOP_SYNC -> sync = null
            ACTION_STOP_UPLOAD -> upload = null
            else -> return
        }
        isSyncActive = sync != null
        isUploadActive = upload != null
    }
    private fun refreshForeground() {
        val current = upload ?: sync
        if (current == null) {
            stopForeground(STOP_FOREGROUND_REMOVE)
            releaseWakeLock()
            instance = null
            stopSelf()
        } else {
            if (wakeLock == null) wakeLock = getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Nuvio::Transfers").apply { setReferenceCounted(false) }
            if (wakeLock?.isHeld != true) wakeLock?.acquire(10 * 60 * 1000L)
            val notification = builder(this, current, upload != null, true)
            if (upload != null && sync != null) {
                val text = NuvioNotificationContent.text(upload!!, true, true) + "\n" + NuvioNotificationContent.title(sync!!, false, true) + " " + NuvioNotificationContent.text(sync!!, false, true)
                notification.setStyle(NotificationCompat.BigTextStyle().bigText(text)).setSubText("Subida y sincronización activas")
            }
            if (Build.VERSION.SDK_INT >= 29) startForeground(FOREGROUND_NOTIFICATION_ID, notification.build(), ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
            else startForeground(FOREGROUND_NOTIFICATION_ID, notification.build())
        }
    }
    override fun onTimeout(startId: Int, fgsType: Int) {
        timedOut = true
        sync = null; upload = null; isSyncActive = false; isUploadActive = false
        stopForeground(STOP_FOREGROUND_REMOVE)
        releaseWakeLock()
        instance = null
        stopSelf()
        postCompletion(this, Intent(ACTION_STOP_SYNC).putExtra("error", "Android limitó el trabajo en segundo plano. Abre Nuvio para continuar."))
    }
    private fun releaseWakeLock() { if (wakeLock?.isHeld == true) wakeLock?.release() }
    override fun onDestroy() {
        if (instance === this) { instance = null; isSyncActive = false; isUploadActive = false }
        releaseWakeLock()
        super.onDestroy()
    }
}
