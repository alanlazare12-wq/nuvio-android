package com.nuvio.drive;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.provider.DocumentsContract;
import android.util.Log;
import app.tauri.plugin.Invoke;
import app.tauri.plugin.PluginHandle;
import app.tauri.plugin.PluginManager;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;
import kotlin.Unit;
import org.json.JSONArray;
import org.json.JSONObject;

/** Framework-only runner: tests the signed, minified production APK. */
public class NativeStorageInstrumentation extends Instrumentation {
    private ObjectMapper mapper;
    @Override public void onCreate(Bundle args) { super.onCreate(args); start(); }
    @Override public void onStart() {
        Bundle result = new Bundle();
        try {
            runChecks();
            result.putString("stream", "NUVIO_NATIVE_TESTS_PASSED");
            finish(Activity.RESULT_OK, result);
        } catch (Throwable error) {
            result.putString("stream", Log.getStackTraceString(error));
            finish(Activity.RESULT_CANCELED, result);
        }
    }
    private static void require(boolean value, String message) {
        if (!value) throw new AssertionError(message);
    }
    private JSONObject call(JSONObject args, Consumer<Invoke> command, boolean success, long timeout) throws Exception {
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<String> data = new AtomicReference<>();
        long[] callback = {0};
        Invoke invoke = new Invoke(1, "qa", 1, 2, (id, json) -> {
            callback[0] = id; data.set(json); done.countDown(); return Unit.INSTANCE;
        }, args.toString(), mapper);
        command.accept(invoke);
        require(done.await(timeout, TimeUnit.SECONDS), "Native operation timed out");
        require(callback[0] == (success ? 1 : 2), "Unexpected native response: " + data.get());
        return new JSONObject(data.get());
    }
    private JSONObject call(JSONObject args, Consumer<Invoke> command) throws Exception {
        return call(args, command, true, 30);
    }
    private static String hex(byte[] bytes) {
        StringBuilder result = new StringBuilder();
        for (byte value : bytes) result.append(String.format("%02x", value));
        return result.toString();
    }
    private void runChecks() throws Exception {
        Context context = getTargetContext();
        Activity activity = startActivitySync(new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        // Use Tauri's configured mapper: R8 optimizes the application's mapper
        // initialization as a whole, so constructing a second one in tests is invalid.
        for (java.lang.reflect.Field field : PluginManager.class.getDeclaredFields()) {
            if (field.getType().equals(ObjectMapper.class)) {
                field.setAccessible(true);
                mapper = (ObjectMapper) field.get(PluginManager.INSTANCE);
                break;
            }
        }
        require(mapper != null, "Tauri JSON mapper was not initialized");
        NuvioMobilePlugin plugin = new NuvioMobilePlugin(activity);
        new PluginHandle(PluginManager.INSTANCE, "qa-native-storage", plugin, "{}", mapper);
        String secret = "736573696f6e2d64652d707275656261";
        String encrypted = call(new JSONObject().put("data", secret).put("encrypt", true), plugin::protectSecret).getString("data");
        require(!secret.equals(encrypted), "Secret was not encrypted");
        String recovered = call(new JSONObject().put("data", encrypted).put("encrypt", false), plugin::protectSecret).getString("data");
        require(secret.equals(recovered), "Keystore roundtrip failed");
        String damaged = encrypted.substring(0, encrypted.length() - 2) + (encrypted.endsWith("00") ? "ff" : "00");
        call(new JSONObject().put("data", damaged).put("encrypt", false), plugin::protectSecret, false, 30);

        Log.i("NUVIO_QA", "Select Download/Nuvio-QA in the system picker");
        String tree = call(new JSONObject(), invoke -> activity.runOnUiThread(() -> plugin.pickDirectory(invoke)), true, 180).getString("uri");
        boolean persistent = context.getContentResolver().getPersistedUriPermissions().stream().anyMatch(permission -> permission.getUri().toString().equals(tree) && permission.isWritePermission());
        require(persistent, "Write permission was not persisted");
        byte[] bytes = "Nuvio: descarga verificada, ñ y acentos.\n".getBytes(StandardCharsets.UTF_8);
        File downloads = new File(context.getApplicationInfo().dataDir, "telegram/files");
        require(downloads.isDirectory() || downloads.mkdirs(), "Cannot create QA source directory");
        File source = new File(downloads, "native-qa-" + UUID.randomUUID() + ".txt");
        Files.write(source.toPath(), bytes);
        JSONObject args = new JSONObject().put("source", source.getAbsolutePath()).put("uri", tree).put("name", source.getName()).put("policy", "skip").put("sha256", hex(MessageDigest.getInstance("SHA-256").digest(bytes))).put("size", bytes.length);
        List<Uri> created = new ArrayList<>();
        try {
            Uri first = Uri.parse(call(args, plugin::publishDownload).getString("uri"));
            created.add(first);
            try (java.io.InputStream input = context.getContentResolver().openInputStream(first)) {
                java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream();
                byte[] buffer = new byte[4096]; int count;
                while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                require(Arrays.equals(bytes, output.toByteArray()), "Published bytes differ");
            }
            call(args, plugin::publishDownload, false, 30);
            args.put("policy", "rename");
            Uri second = Uri.parse(call(args, plugin::publishDownload).getString("uri"));
            created.add(second);
            require(!first.equals(second), "Rename reused the existing document");
            Files.write(source.toPath(), "damaged".getBytes(StandardCharsets.UTF_8));
            call(args, plugin::publishDownload, false, 30);
            JSONArray names = call(new JSONObject().put("uri", tree), plugin::directoryNames).getJSONArray("names");
            boolean found = false;
            for (int index = 0; index < names.length(); index++) found |= source.getName().equals(names.getString(index));
            require(found, "Published file missing from directory listing");
            call(new JSONObject().put("uri", first.toString()).put("data", "7b226f6b223a747275657d"), plugin::writeDocument);
            try (java.io.InputStream input = context.getContentResolver().openInputStream(first)) {
                java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream();
                byte[] buffer = new byte[4096]; int count;
                while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                require("{\"ok\":true}".equals(new String(output.toByteArray(), StandardCharsets.UTF_8)), "Diagnostic content differs");
            }
            Log.i("NUVIO_QA", "PASS: Keystore roundtrip/corruption, SAF persistent grant, SHA256 copy/readback, skip, rename, corrupt source, diagnostics");
        } finally {
            source.delete();
            for (Uri document : created) DocumentsContract.deleteDocument(context.getContentResolver(), document);
        }
    }
}
