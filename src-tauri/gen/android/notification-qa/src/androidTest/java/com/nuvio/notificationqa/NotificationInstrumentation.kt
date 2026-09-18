package com.nuvio.notificationqa

import android.app.Activity
import android.app.Instrumentation
import android.app.Notification
import android.app.NotificationManager
import android.content.Intent
import android.graphics.Bitmap
import android.os.Bundle
import android.os.ParcelFileDescriptor
import com.nuvio.drive.NuvioForegroundService as Service
import java.io.File

class NotificationInstrumentation : Instrumentation() {
    private var denied = false
    private val results = mutableListOf<String>()
    override fun onCreate(arguments: Bundle?) { super.onCreate(arguments); denied = arguments?.getString("permission") == "denied"; start() }
    private fun shell(command: String): String = ParcelFileDescriptor.AutoCloseInputStream(uiAutomation.executeShellCommand(command)).bufferedReader().use { it.readText() }
    private fun foreground() {
        shell("am start -W -n com.nuvio.notificationqa/.NotificationQaActivity")
        Thread.sleep(500)
    }
    private fun send(data: Intent) { runOnMainSync { Service.dispatch(targetContext, data) }; Thread.sleep(1000) }
    private fun notice(id: Int): Notification? = targetContext.getSystemService(NotificationManager::class.java).activeNotifications.firstOrNull { it.id == id }?.notification
    private fun title(id: Int): String = notice(id)?.extras?.getCharSequence(Notification.EXTRA_TITLE)?.toString() ?: ""
    private fun upload(percent: Int? = 25): Intent = Intent(Service.ACTION_UPDATE_UPLOAD)
        .putExtra("total", 4).putExtra("completed", (percent ?: 25) * 4 / 100).putExtra("pending", 4 - (percent ?: 25) * 4 / 100).putExtra("phase", "uploading")
        .putExtra("processedBytes", 419430400L * (percent ?: 25) / 100).putExtra("totalBytes", 419430400L).putExtra("speedBps", 1048576L)
        .putExtra("etaSeconds", (100 - (percent ?: 25)) * 4L).putExtra("currentFileName", "Video-S24-Ultra.mp4")
        .apply { if (percent != null) putExtra("percent", percent) }
    private fun expect(value: Boolean, message: String) { check(value) { message }; results.add(message); android.util.Log.i("NuvioNotificationQA", message) }
    override fun onStart() {
        try {
            foreground()
            if (denied) {
                send(upload())
                expect(Service.isUploadActive, "Denied permission: foreground service still starts without crashing")
                send(Intent(Service.ACTION_STOP_UPLOAD).putExtra("paused", 4))
                expect(!Service.isWorking, "Denied permission: service stops cleanly")
            } else {
                send(upload())
                expect(notice(2000)?.extras?.getInt(Notification.EXTRA_PROGRESS) == 25, "Native progress bar starts at 25 percent")
                expect(notice(2000)?.extras?.getCharSequence(Notification.EXTRA_BIG_TEXT).toString().contains("5 min restantes"), "ETA is visible in expanded notification")
                expect(notice(2000)?.contentIntent != null, "Notification opens the application")
                shell("input keyevent 3")
                for (percent in listOf(40, 65, 90)) {
                    Thread.sleep(1100)
                    send(upload(percent))
                    expect(notice(2000)?.extras?.getInt(Notification.EXTRA_PROGRESS) == percent, "Background notification advances to $percent percent after Home")
                }
                val sync = Intent(Service.ACTION_UPDATE_SYNC).putExtra("scanned", 120).putExtra("total", 300).putExtra("percent", 36).putExtra("etaSeconds", 20L)
                send(sync)
                expect(notice(2000)?.extras?.getInt(Notification.EXTRA_PROGRESS) == 90, "Simultaneous sync does not overwrite upload progress")
                expect(notice(2000)?.extras?.getCharSequence(Notification.EXTRA_BIG_TEXT).toString().contains("120 de 300"), "Both operations are visible together")
                shell("cmd statusbar expand-notifications")
                Thread.sleep(900)
                uiAutomation.takeScreenshot()?.let { bitmap ->
                    File(targetContext.getExternalFilesDir(null), "background-progress.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
                    bitmap.recycle()
                }
                shell("cmd statusbar collapse")
                send(Intent(Service.ACTION_STOP_UPLOAD).putExtra("completed", 3).putExtra("total", 4).putExtra("failed", 1))
                expect(title(1002).contains("errores"), "Upload error is not reported as success")
                expect(Service.isSyncActive && !Service.isUploadActive && notice(2000)?.extras?.getInt(Notification.EXTRA_PROGRESS) == 36, "Sync survives upload completion and becomes the foreground progress")
                send(Intent(Service.ACTION_STOP_SYNC).putExtra("scanned", 300))
                expect(!Service.isWorking && notice(2000) == null, "Service stops when both operations finish")
                expect(title(1001).contains("completada"), "Sync completion notification persists")
                foreground()
                send(upload(null))
                expect(notice(2000)?.extras?.getBoolean(Notification.EXTRA_PROGRESS_INDETERMINATE) == true, "Unknown total uses indeterminate progress")
                send(Intent(Service.ACTION_STOP_UPLOAD).putExtra("completed", 1).putExtra("total", 4).putExtra("paused", 3))
                expect(title(1002).contains("pausa"), "Paused uploads are not reported as completed")
                foreground()
                send(upload(65))
                send(Intent(Service.ACTION_STOP_UPLOAD).putExtra("completed", 4).putExtra("total", 4))
                expect(title(1002) == "Subidas completadas", "All successful uploads show completion")
                foreground()
                send(Intent(Service.ACTION_UPDATE_SYNC).putExtra("phase", "startup"))
                expect(title(2000) == "Preparando tu nube…", "Startup has a native loading notification")
                send(Intent(Service.ACTION_STOP_SYNC).putExtra("phase", "startup"))
                expect(notice(2000) == null, "Startup progress disappears when ready")
                foreground()
                runOnMainSync {
                    Service.dispatch(targetContext, Intent(Service.ACTION_UPDATE_SYNC).putExtra("phase", "startup"))
                    Service.dispatch(targetContext, Intent(Service.ACTION_STOP_SYNC).putExtra("phase", "startup"))
                }
                Thread.sleep(700)
                expect(!Service.isWorking && notice(2000) == null, "Rapid startup completion cannot leave a stale foreground service")
                foreground()
                send(upload())
                runOnMainSync {
                    val field = Service::class.java.getDeclaredField("instance").apply { isAccessible = true }
                    (field.get(null) as Service).onTimeout(1, 1)
                }
                Thread.sleep(400)
                expect(!Service.isWorking && notice(2000) == null, "Android 15+ timeout stops foreground service without a crash")
            }
            finish(Activity.RESULT_OK, Bundle().apply { putString("stream", "\nNUVIO_NOTIFICATION_TESTS_PASSED\n" + results.joinToString("\n")) })
        } catch (error: Throwable) {
            finish(Activity.RESULT_CANCELED, Bundle().apply { putString("stream", "\nFAILED: ${error.stackTraceToString()}\n" + results.joinToString("\n")) })
        }
    }
}
