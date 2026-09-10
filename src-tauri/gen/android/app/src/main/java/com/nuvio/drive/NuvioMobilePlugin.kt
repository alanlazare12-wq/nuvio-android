package com.nuvio.drive

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import androidx.activity.result.ActivityResult
import java.util.UUID
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONArray
import java.io.File
import java.security.KeyStore
import java.security.MessageDigest
import java.util.concurrent.Executors
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

@InvokeArg class SecretArgs { lateinit var data: String; var encrypt: Boolean = false }
@InvokeArg class UriArgs { lateinit var uri: String }
@InvokeArg class WriteArgs { lateinit var uri: String; lateinit var data: String }
@InvokeArg class PublishArgs {
    lateinit var source: String; lateinit var uri: String; lateinit var name: String
    lateinit var policy: String; lateinit var sha256: String; var size: Long = 0
}

@TauriPlugin
class NuvioMobilePlugin(private val host: Activity) : Plugin(host) {
    @Command fun backgroundApp(invoke: Invoke) {
        host.runOnUiThread { host.moveTaskToBack(true); invoke.resolve(JSObject()) }
    }
    // Serial exports keep conflict handling consistent; file IO never blocks the UI.
    private val io = Executors.newSingleThreadExecutor()
    private fun work(invoke: Invoke, task: () -> JSObject) {
        io.execute {
            try { invoke.resolve(task()) }
            catch (error: Exception) { invoke.reject(error.message ?: "Android no pudo completar la operación") }
        }
    }
    private fun decode(hex: String): ByteArray {
        require(hex.length % 2 == 0) { "Datos de credenciales inválidos" }
        return ByteArray(hex.length / 2) { hex.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
    }
    private fun encode(bytes: ByteArray) = bytes.joinToString("") { "%02x".format(it) }

    @Command fun protectSecret(invoke: Invoke) = work(invoke) {
        val args = invoke.parseArgs(SecretArgs::class.java)
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val alias = "com.nuvio.drive.secrets.v1"
        val key = (store.getKey(alias, null) as? SecretKey) ?: run {
            check(args.encrypt) { "No se encontró la clave de esta instalación. Vuelve a conectar Telegram." }
            KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
                init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build())
            }.generateKey()
        }
        val input = decode(args.data)
        try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            val output = if (args.encrypt) {
                cipher.init(Cipher.ENCRYPT_MODE, key)
                cipher.iv + cipher.doFinal(input)
            } else {
                require(input.size >= 28) { "El almacén de sesión está dañado" }
                cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, input.copyOfRange(0, 12)))
                cipher.doFinal(input, 12, input.size - 12)
            }
            JSObject().apply { put("data", encode(output)); output.fill(0) }
        } finally { input.fill(0) }
    }

    @Command fun pickDirectory(invoke: Invoke) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
            Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or Intent.FLAG_GRANT_PREFIX_URI_PERMISSION)
        startActivityForResult(invoke, intent, "directoryPicked")
    }

    @ActivityCallback fun directoryPicked(invoke: Invoke, result: ActivityResult) {
        try {
            val uri = result.data?.data
            if (result.resultCode != Activity.RESULT_OK || uri == null) {
                invoke.resolve(JSObject().apply { put("uri", org.json.JSONObject.NULL) }); return
            }
            val flags = result.data!!.flags and (Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
            host.contentResolver.takePersistableUriPermission(uri, flags)
            invoke.resolve(JSObject().apply { put("uri", uri.toString()) })
        } catch (error: Exception) { invoke.reject(error.message ?: "No se pudo abrir la carpeta") }
    }

    private fun stageContentUriInternal(uri: Uri): String {
        var displayName = "archivo"
        try {
            host.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val nameIdx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (nameIdx >= 0) {
                        cursor.getString(nameIdx)?.let { displayName = it }
                    }
                }
            }
        } catch (_: Exception) {}

        displayName = displayName.replace('/', '_').replace('\\', '_').trim()
        if (displayName.isBlank() || displayName == "." || displayName == "..") {
            displayName = "archivo"
        }

        val stagingFolder = File(host.cacheDir, "upload_staging").apply { mkdirs() }
        val uniqueFolder = File(stagingFolder, "${System.currentTimeMillis()}_${UUID.randomUUID().toString().take(8)}").apply { mkdirs() }
        val targetFile = File(uniqueFolder, displayName)

        host.contentResolver.openInputStream(uri)?.use { input ->
            targetFile.outputStream().use { output ->
                input.copyTo(output, 1024 * 1024)
            }
        } ?: error("Android no pudo abrir el archivo seleccionado")

        return targetFile.canonicalPath
    }

    @Command fun pickUploadFiles(invoke: Invoke) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
        }
        startActivityForResult(invoke, intent, "uploadFilesPicked")
    }

    @ActivityCallback fun uploadFilesPicked(invoke: Invoke, result: ActivityResult) {
        try {
            if (result.resultCode != Activity.RESULT_OK || result.data == null) {
                invoke.resolve(JSObject().apply { put("paths", JSONArray()) })
                return
            }
            val uris = mutableListOf<Uri>()
            val data = result.data!!
            if (data.clipData != null) {
                for (i in 0 until data.clipData!!.itemCount) {
                    uris.add(data.clipData!!.getItemAt(i).uri)
                }
            } else if (data.data != null) {
                uris.add(data.data!!)
            }
            if (uris.isEmpty()) {
                invoke.resolve(JSObject().apply { put("paths", JSONArray()) })
                return
            }
            io.execute {
                try {
                    val paths = uris.map { uri -> stageContentUriInternal(uri) }
                    invoke.resolve(JSObject().apply { put("paths", JSONArray(paths)) })
                } catch (e: Exception) {
                    invoke.reject(e.message ?: "Error al procesar archivos seleccionados")
                }
            }
        } catch (error: Exception) {
            invoke.reject(error.message ?: "No se pudieron seleccionar los archivos")
        }
    }

    @Command fun stageContentUri(invoke: Invoke) = work(invoke) {
        val args = invoke.parseArgs(UriArgs::class.java)
        val uri = Uri.parse(args.uri)
        val path = stageContentUriInternal(uri)
        JSObject().apply { put("path", path) }
    }

    private fun tree(raw: String): Uri {
        val uri = Uri.parse(raw)
        require(uri.scheme == "content" && DocumentsContract.isTreeUri(uri)) { "Selecciona una carpeta de Android" }
        return uri
    }
    private fun names(uri: Uri): Set<String> {
        val children = DocumentsContract.buildChildDocumentsUriUsingTree(uri, DocumentsContract.getTreeDocumentId(uri))
        val result = mutableSetOf<String>()
        val cursor = host.contentResolver.query(children, arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME), null, null, null)
            ?: error("Android no pudo leer la carpeta seleccionada")
        cursor.use { while (it.moveToNext()) { result.add(it.getString(0)) } }
        return result
    }
    @Command fun directoryNames(invoke: Invoke) = work(invoke) {
        val args = invoke.parseArgs(UriArgs::class.java)
        JSObject().apply { put("names", JSONArray(names(tree(args.uri)).toList())) }
    }

    @Command fun publishDownload(invoke: Invoke) = work(invoke) {
        val args = invoke.parseArgs(PublishArgs::class.java)
        require(args.name.isNotBlank() && args.name != "." && args.name != ".." && !args.name.contains('/') && !args.name.contains('\\')) { "Nombre de archivo inválido" }
        require(args.policy == "skip" || args.policy == "rename") { "Política de archivos inválida" }
        val source = File(args.source).canonicalFile
        val privateRoots = listOf(host.filesDir.canonicalFile, host.cacheDir.canonicalFile, File(host.applicationInfo.dataDir, "telegram/files").canonicalFile)
        require(privateRoots.any { source.path.startsWith(it.path + File.separator) }) { "El archivo debe estar en la caché privada de Nuvio" }
        require(source.isFile && source.length() == args.size) { "El tamaño descargado no coincide" }
        val digest = MessageDigest.getInstance("SHA-256")
        source.inputStream().buffered().use { input ->
            val buffer = ByteArray(1024 * 1024)
            while (true) { val count = input.read(buffer); if (count < 0) break; digest.update(buffer, 0, count) }
        }
        require(encode(digest.digest()) == args.sha256) { "La descarga no coincide con el original" }
        val uri = tree(args.uri)
        val existing = names(uri)
        var name = args.name
        if (name in existing) {
            require(args.policy == "rename") { "El archivo ya existe en el destino. Elige renombrar para conservar ambos." }
            val dot = args.name.lastIndexOf('.').takeIf { it > 0 } ?: args.name.length
            var index = 1
            do { name = args.name.take(dot) + " (${index++})" + args.name.substring(dot) } while (name in existing)
        }
        val parent = DocumentsContract.buildDocumentUriUsingTree(uri, DocumentsContract.getTreeDocumentId(uri))
        val created = DocumentsContract.createDocument(host.contentResolver, parent, "application/octet-stream", name)
            ?: error("No se pudo crear el archivo en la carpeta seleccionada")
        try {
            host.contentResolver.openOutputStream(created, "wt")?.use { output ->
                source.inputStream().buffered().use { input -> check(input.copyTo(output, 1024 * 1024) == args.size) }
                output.flush()
            } ?: error("Android no concedió permiso para guardar el archivo")
            // Read back the published document, including cloud/document providers.
            digest.reset()
            var actualSize = 0L
            host.contentResolver.openInputStream(created)?.buffered()?.use { input ->
                val buffer = ByteArray(1024 * 1024)
                while (true) { val count = input.read(buffer); if (count < 0) break; digest.update(buffer, 0, count); actualSize += count }
            } ?: error("No se pudo verificar el archivo guardado")
            check(actualSize == args.size && encode(digest.digest()) == args.sha256) { "La copia guardada no pasó la verificación" }
            JSObject().apply { put("uri", created.toString()) }
        } catch (error: Exception) {
            runCatching { DocumentsContract.deleteDocument(host.contentResolver, created) }
            throw error
        }
    }

    @Command fun writeDocument(invoke: Invoke) = work(invoke) {
        val args = invoke.parseArgs(WriteArgs::class.java)
        val uri = Uri.parse(args.uri)
        require(uri.scheme == "content") { "Destino Android inválido" }
        host.contentResolver.openOutputStream(uri, "wt")?.use { it.write(decode(args.data)); it.flush() }
            ?: error("No se pudo guardar el diagnóstico")
        JSObject()
    }
}
