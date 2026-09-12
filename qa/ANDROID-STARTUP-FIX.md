# Corrección de arranque Android — 2026-09-11

El panel podía invocar `get_dashboard` antes de que `setup` registrara `Arc<AppState>`. Tauri crea las ventanas configuradas antes de ejecutar el callback de setup. Además, la creación de `TelegramService` solicita al plugin Android proteger o leer la clave de la base de datos mediante una llamada bloqueante.

La corrección registra `Startup` en el builder, antes de crear ventanas. Setup despacha la inicialización de directorios, catálogo y Telegram a `spawn_blocking`, para dejar libre el hilo de eventos. Una vez creado, registra `Arc<AppState>`, publica el resultado y lanza el worker. `get_dashboard` espera ese resultado de forma asíncrona antes de obtener el estado.

La espera tiene un límite de 30 segundos. Agotarlo permite volver a comprobar el resultado mediante Reintentar, sin iniciar otra copia del servicio. Los errores de inicialización se conservan y llegan a la pantalla con un mensaje en español. La modificación no cambia las claves existentes, el esquema del catálogo ni la sesión de Telegram.

## Verificación

- `pnpm build`: correcto (advertencia existente por tamaño del bundle).
- `cargo test --offline --manifest-path src-tauri/Cargo.toml --lib`: 53 pruebas correctas, ninguna fallida. El linker de Windows advierte que ignora una opción rpath; no impide la compilación ni las pruebas.
- Cuatro pruebas nuevas: petición antes de finalizar la inicialización, resultado conservado para peticiones posteriores, propagación de fallo, timeout seguido de reintento exitoso.
- `git diff --check`: correcto.
- No había dispositivos conectados en `adb devices`; no se ha verificado el arranque en un teléfono real.

## Herramientas solicitadas

Se intentó consultar Graphify a través de PraxisNode, pero el servicio devolvió `tunnel_client_not_seen`. Context7 no estaba expuesto entre las herramientas de la sesión. La revisión se realizó sobre el código local del proyecto y del runtime Tauri instalado. La preferencia del usuario por ambas herramientas se guardó en el archivo global de instrucciones de Codex.

## APK verificado

- Empaquetado release: correcto; Gradle BUILD SUCCESSFUL y empaquetador con salida 0.
- Archivo: release/Android/Nuvio-Android-aarch64.apk
- Versión: 1.2.0; versionCode 1002000; ARM64; Android 8 o posterior.
- Tamaño: 58,277,755 bytes.
- SHA-256: 6AF73139CD556816E42C4DB19E6F4A323C663EE8325D4E423E89DDD680467AA9
- Firma APK v2: válida, certificado CN=Nuvio, O=Nuvio, C=MX, usando la firma existente.
- Manifiesto de producción, bibliotecas ARM64, libc de Android y alineación de 16 KB (APK y ELF): comprobados por scripts/package-android.ps1.
- El empaquetador utilizó su alternativa existente de copia de bibliotecas y Gradle porque Windows no permitió crear symlinks.
- Pendiente de validación manual: instalar como actualización y confirmar que el panel abre tanto en arranque frío como con la sesión existente. No se ha instalado ni ejecutado este APK en un dispositivo desde esta tarea.