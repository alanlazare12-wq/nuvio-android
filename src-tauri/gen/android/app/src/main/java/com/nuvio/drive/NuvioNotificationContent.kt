package com.nuvio.drive

import android.content.Intent
import java.util.Locale

/** Shared by the production service and Android notification instrumentation. */
object NuvioNotificationContent {
    fun size(bytes: Long): String {
        val units = arrayOf("B", "KB", "MB", "GB", "TB")
        var value = bytes.coerceAtLeast(0).toDouble()
        var unit = 0
        while (value >= 1024 && unit < units.lastIndex) { value /= 1024; unit++ }
        return String.format(Locale.US, "%.1f %s", value, units[unit])
    }
    fun eta(seconds: Long): String = when {
        seconds < 0 -> "Calculando tiempo restante…"
        seconds < 60 -> "Aprox. ${seconds.coerceAtLeast(1)} s restantes"
        seconds < 3600 -> "Aprox. ${(seconds + 59) / 60} min restantes"
        else -> "Aprox. ${seconds / 3600} h ${(seconds % 3600 + 59) / 60} min restantes"
    }
    fun title(data: Intent, upload: Boolean, active: Boolean): String {
        if (!upload) return when {
            data.getStringExtra("phase") == "startup" -> "Preparando tu nube…"
            data.getStringExtra("error")?.isNotBlank() == true -> "Sincronización interrumpida"
            !active -> "Sincronización completada"
            data.getStringExtra("phase") == "applying" -> "Actualizando catálogo…"
            else -> "Sincronizando con Telegram…"
        }
        if (!active) return when {
            data.getIntExtra("paused", 0) > 0 -> "Subidas en pausa"
            data.getIntExtra("failed", 0) > 0 -> "Subidas finalizadas con errores"
            data.getIntExtra("cancelled", 0) > 0 -> "Subidas canceladas"
            else -> "Subidas completadas"
        }
        return when (data.getStringExtra("phase")) {
            "staging", "analyzing", "copying" -> "Preparando archivos para subir…"
            "confirming" -> "Confirmando archivos en Telegram…"
            "retry_wait" -> "Esperando para reintentar la subida…"
            "uploading" -> if (data.hasExtra("percent")) "Subiendo archivos · ${data.getIntExtra("percent", 0)}%" else "Subiendo archivos…"
            else -> "Archivos en cola de subida…"
        }
    }
    fun text(data: Intent, upload: Boolean, active: Boolean): String {
        if (!upload) {
            data.getStringExtra("error")?.takeIf { it.isNotBlank() }?.let { return it }
            if (data.getStringExtra("phase") == "startup") return "Abriendo el catálogo y preparando Telegram"
            val count = data.getIntExtra("scanned", 0)
            val total = data.getIntExtra("total", 0)
            val progress = if (total > 0) "$count de $total mensajes revisados" else "$count mensajes revisados"
            val pct = if (data.hasExtra("percent") && active) " · ${data.getIntExtra("percent", 0)}% aprox." else ""
            return if (active) "$progress$pct\n${eta(data.getLongExtra("etaSeconds", -1))}" else "$progress · Catálogo al día"
        }
        val completed = data.getIntExtra("completed", 0)
        val total = data.getIntExtra("total", 0)
        val pending = data.getIntExtra("pending", 0)
        val paused = data.getIntExtra("paused", 0)
        val failed = data.getIntExtra("failed", 0)
        val cancelled = data.getIntExtra("cancelled", 0)
        val parts = mutableListOf("$completed de $total archivos subidos")
        if (active) parts.add("$pending pendientes")
        if (paused > 0) parts.add("$paused en pausa")
        if (failed > 0) parts.add("$failed con error")
        if (cancelled > 0) parts.add("$cancelled cancelados")
        if (!active) return parts.joinToString(" · ")
        val bytes = data.getLongExtra("processedBytes", 0)
        val bytesTotal = data.getLongExtra("totalBytes", 0)
        val speed = data.getLongExtra("speedBps", 0)
        val details = mutableListOf<String>()
        if (bytesTotal > 0) details.add("${size(bytes)} de ${size(bytesTotal)}")
        if (speed > 0) details.add("${size(speed)}/s")
        details.add(eta(data.getLongExtra("etaSeconds", -1)))
        data.getStringExtra("currentFileName")?.takeIf { it.isNotBlank() }?.let { details.add(it) }
        return parts.joinToString(" · ") + "\n" + details.joinToString(" · ")
    }
}
