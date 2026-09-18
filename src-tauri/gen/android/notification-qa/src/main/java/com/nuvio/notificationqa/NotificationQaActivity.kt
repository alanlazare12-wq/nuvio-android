package com.nuvio.notificationqa

import android.app.Activity
import android.os.Bundle
import android.widget.TextView
import com.nuvio.drive.NuvioForegroundService

class NotificationQaActivity : Activity() {
    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        setContentView(TextView(this).apply { text = "Prueba del servicio real de notificaciones de Nuvio. Sin sesión ni archivos de Telegram."; textSize = 22f })
    }
    override fun onResume() { super.onResume(); NuvioForegroundService.allowRestart() }
}
