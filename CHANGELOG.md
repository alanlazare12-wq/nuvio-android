# Historial de Nuvio

## 1.2.5 — 2026-09-18

- Corregido el progreso de subidas en segundo plano: la notificación persistente ya no depende del polling ni de los timers del WebView/React; un worker Rust dedicado observa directamente el estado real de las transferencias y actualiza el foreground service incluso con la app minimizada.
- El permiso `POST_NOTIFICATIONS` se solicita al iniciar o reanudar una subida en Android 13+, en lugar de esperar al final de la cola; si el usuario lo deniega, la transferencia continúa sin bloquearse.
- La notificación de subida usa exclusivamente transferencias de tipo `upload`, evitando porcentajes y totales contaminados por descargas u otras operaciones de la cola global.
- El puente Android de notificaciones usa `applicationContext` y el `main looper`, reduciendo la dependencia de una `Activity`/WebView visible mientras el servicio foreground mantiene el trabajo en segundo plano.
- Mejorado el seguimiento de fases: preparación indeterminada, prioridad estable de `uploading`/`confirming`/`retry_wait`, ETA y velocidad sólo con datos recientes, y finalización emitida una sola vez.
- Se mantienen el wake lock, el tipo `dataSync` y el manejo de `Service.onTimeout` requerido por Android 15 para trabajos largos.

## 1.2.4 — 2026-09-17

- Paridad funcional con la release Windows 1.2.4: archivos individuales de más de 2 GB se convierten en volúmenes ZIP independientes por debajo del límite de Telegram, con nombres descriptivos, manifiesto `NUVIO-SPLIT-MANIFEST.json`, formato `nuvio-split-v1` y SHA-256 por parte y del archivo completo.
- Preparación de archivos grandes completamente en streaming, con bloques de 1 MiB, validación de cada ZIP y detección de cambios del archivo fuente durante el proceso.
- Refactorización del frontend compartido: `App.tsx` delega sincronización, ciclo del dashboard, subidas, transferencias, carpetas, papelera, mantenimiento, previews y drag & drop en hooks especializados.
- Bridge de Tauri dividido por dominio (`dashboard`, `files`, `media`, `mobile`, `settings`, `telegram`, `transfers`, `uploads`) manteniendo `bridge.ts` como fachada compatible.
- Se mantienen y endurecen las capacidades exclusivas de Android: SAF, servicio foreground de sincronización/subidas, notificaciones persistentes, wake lock, manejo de insets/teclado, botón Atrás seguro y flujo de distribución para Google Play.
- Las fuentes Kotlin críticas de Android ahora viven también bajo `android/` y el generador las restaura en cada build, evitando que Tauri regenere y pierda personalizaciones móviles.
- Empaquetado Android reforzado para permisos de notificación, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_DATA_SYNC`, `WAKE_LOCK`, servicio de datos y compatibilidad de páginas de 16 KB.
- Flujo de Google Play corregido para eliminar bundles obsoletos antes de compilar y seleccionar únicamente el AAB recién generado, evitando publicar accidentalmente un artefacto antiguo.
- Validación de release: TypeScript y Vite correctos, autenticación 20/20, Rust 86/86, Clippy sin warnings de código propio y UI 31/31. El APK ARM64 1.2.4 se verificó firmado, no depurable y compatible con páginas de 16 KB.

## 1.2.0 — 2026-09-11

- Opción de compresión previa en ZIP con límite estricto de 2 GB por paquete (integrada en subida de archivos, carpetas y arrastre externo desde PC).
- Creación automática de múltiples paquetes independientes si la selección supera el presupuesto de 2 GB.
- Compresión por bloques con omisión de recompresión para formatos multimedia ya comprimidos (imágenes, vídeos, zip, etc.) para acelerar el procesamiento y ahorrar memoria en Android.
- Optimización de subida y preparación: cálculo de hash SHA-256 en una sola pasada en streaming durante la copia a caché para archivos no cifrados.
- Optimización del catálogo: inserción en SQLite por lotes de 250 documentos y eliminación del reescaneo completo redundante de Telegram al vaciarse la cola de transferencias.
- Optimización de interfaz: sondeo adaptativo (750ms en transferencias activas, 2.5s en reposo, 10s en segundo plano), cálculo de dashboard en segundo plano (`spawn_blocking`) y caché de uso de disco.


## 1.1.0 — 2026-09-10

- Selección al tocar o hacer clic en cualquier zona libre de la tarjeta o fila. Los botones y casillas mantienen sus acciones independientes.
- Arrastre desde el nombre, la miniatura o los metadatos; permite mover varios archivos seleccionados a una carpeta o a Mi unidad.
- Corrección de la cancelación del arrastre de ratón causada por `pointercancel`. El arrastre HTML se activa según el puntero utilizado, sin interferir con el gesto táctil.
- Arrastre táctil desde toda la tarjeta seleccionada, desplazamiento automático cerca de los bordes y cancelación al soltar fuera de un destino. Se libera la captura del puntero al terminar.
- Miniaturas precargadas cerca del área visible, con dos preparaciones simultáneas, caché de 48 resultados y limpieza al cerrar sesión o vaciar la caché.
- Miniaturas de Telegram y vistas de imágenes, primera página de PDF y texto. Las originales precargadas se limitan a 8 MB; los textos, a 256 KB. Los videos grandes no se descargan para generar una miniatura.
- Corrección del visor de texto: rechaza archivos de más de 2 MB antes de descargarlos.
- Paquetes Windows x64 y Android ARM64 con la misma versión y código de interfaz compartido.

## Base inicial — 2026-09-09

Se incorporó el estado existente de ambas aplicaciones al control de versiones, incluyendo las correcciones de catálogo, carpetas, descargas verificadas, integración Android Keystore/SAF y empaquetado autónomo de Windows.
