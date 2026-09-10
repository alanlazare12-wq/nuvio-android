# Nuvio 1.0.0 — verificación de distribución

Revisión iniciada el 9 de septiembre de 2026, después de incorporar los cambios de carpetas, movimientos, historial y vistas previas del usuario.

## Correcciones relevantes

- Subidas a carpetas: la transferencia y su carpeta se guardan en la misma transacción antes de que el trabajador pueda reclamarla. No se puede eliminar una carpeta que aún contiene subidas pendientes.
- Sincronización de carpetas: se aplica el estado remoto en una transacción, se reconstruyen las relaciones contra el conjunto completo y se resuelven padres ausentes o ciclos sin bloquear todo el catálogo. Los eventos con nombres inválidos se descartan.
- Movimientos tardíos: un archivo cuyo destino ya fue eliminado vuelve a la raíz; no provoca una violación de clave externa. Las operaciones de carpetas se serializan con la sincronización.
- Descargas: reserva de nombres entre lotes, comprobación de tamaño y SHA-256, publicación sin sobrescritura y defensa frente a nombres que intentan introducir rutas.
- Android: almacenamiento de credenciales con Keystore, selector de carpetas con permiso persistente, publicación de descargas mediante Storage Access Framework, comprobación de la copia mediante lectura posterior y exportación de diagnóstico a un documento del sistema.
- Android: navegación con Atrás, adaptación a teclado, barras y recortes de pantalla, y exclusión de datos privados de las copias de seguridad del sistema.
- Android: inclusión de `libtdjson.so` en todos los caminos de empaquetado. Se detectó un APK que instalaba pero cerraba al arrancar por esta biblioteca ausente.
- Android: aislamiento de los archivos C++ usados por el enlazador. Añadir toda la carpeta de bibliotecas del NDK hacía que `libc.a` reemplazara a la `libc.so` del dispositivo y provocaba SIGSEGV al arrancar. El empaquetado ahora comprueba la dependencia dinámica de `libc.so`.
- Vistas previas: el visor PDF limita la primera página a cuatro millones de píxeles y 4096 por dimensión; evita asignaciones enormes para documentos con páginas desproporcionadas.
- Interfaz: selección coherente después de ordenar, mover o enviar a papelera; resultados de medios obsoletos descartados; foco y Escape en diálogos; tema persistente y disposición adaptable.
- Windows: setup x64 con TDLib, Visual C++ y WebView2 sin conexión. El empaquetador selecciona exactamente la versión actual y no un instalador anterior que haya quedado en la carpeta de salida.

## Pruebas ya completadas

| Comprobación | Resultado | Evidencia |
| --- | --- | --- |
| Rust, reglas de catálogo, transferencias, integridad y carpetas | 37 aprobadas, 0 fallos | `rust-tests.log` |
| Clippy con advertencias tratadas como errores | Aprobado | `clippy.log` |
| Interfaz real con IPC simulado | 13 aprobadas, 0 fallos | `ui-tests.log`, `ui-results.json` |
| PDF real y trabajador de PDF.js en pantalla móvil | Aprobado, límite de memoria verificado | `ui-results.json` |
| TypeScript y compilación de producción de la interfaz | Aprobado | Registros de empaquetado |

Las pruebas de interfaz cubren carpetas, selección, papelera, favoritos, tema, diálogos, errores, vistas previas y anchos de 390, 768 y 1280 píxeles. Las respuestas de Telegram se simulan en esas pruebas; no son una prueba de transferencia real.

## Verificación de instaladores

- **Windows 11 de 64 bits (`release/Windows/Nuvio-Setup-Windows11-x64.exe`):**
  - Empaquetado completo NSIS completado con WebView2 y 15 bibliotecas DLL incluidas (TDLib, OpenSSL, C++ CRT).
  - Verificado en instalación autónoma (`qa/windows-install/nuviodrive-v1.exe`): arranca y opera de forma independiente con los servidores de desarrollo apagados.
  - Incorporación de buscador rápido por nombre de archivo en la barra de herramientas y sincronizado con la barra superior.
  - Corrección de Drag & Drop (arrastrar y soltar) entre tarjetas de archivos y carpetas:
    - Desactivado el interceptor OLE nativo de WebView2 (`dragDropEnabled: false` en `tauri.conf.json`) que bloqueaba los eventos estándar de HTML5 DOM en Windows.
    - Soporte CSS con `-webkit-user-drag: element` y bloqueo de selección de texto (`user-select: none`) en tarjetas y filas para evitar que el puntero seleccione texto al arrastrar.
    - Manejo de `pointer-events: none` en hijos de carpetas y filtrado de `event.relatedTarget` para evitar cancelaciones prematuras (`dragleave`) y efecto de prohibición (cursor 🚫).

- **Samsung Galaxy S24 Ultra / Android ARM64 (`release/Android/Nuvio-Android-aarch64.apk`):**
  - Binarios ELF (`libnuviodrive_v1_lib.so` y `libtdjson.so`) verificados para arquitectura AArch64, enlazado dinámico con `libc.so` del sistema y soporte de páginas de 16 KB.
  - Firma persistente validada con `apksigner` y alineación validada con `zipalign -c -P 16 -v 4`.
  - Corrección completa de arrastre táctil hacia carpetas (Drag & Drop en Android):
    - Desactivado `draggable={false}` en dispositivos táctiles/móviles para evitar que Chromium lance el arrastre nativo del sistema operativo (que generaba una sombra semitransparente inerte, cancelaba los eventos web y reportaba "Movimiento cancelado.").
    - Implementación de detección geométrica de carpetas de destino con fallback por rectángulos (`getBoundingClientRect`), asegurando que siempre se detecte la carpeta objetivo al soltar el dedo.
    - Almacenamiento y recuperación de coordenadas y último objetivo sobrevolado (`lastTarget`), permitiendo soltar sobre la carpeta sin falsos positivos de cancelación.
    - Retroalimentación háptica (vibración al tomar y soltar) e insignia dinámica que muestra en tiempo real "Mover a [carpeta]".
  - Botón de sincronización con Telegram restaurado en la cabecera móvil (40×40 con icono `RefreshCw` y animación de rotación durante la sincronización).
  - Buscador rápido por nombre integrado en la cabecera de la lista de archivos con borrado instantáneo (botón X) y filtrado inmediato en tiempo real.
  - Verificado visualmente en emulador Android API 36 con 16 KB pages.
  - Pruebas nativas de integración superadas con éxito en emulador de 16 KB (`NativeStorageInstrumentation`):
    - Ciclo de cifrado y descifrado seguro de sesión con Android Keystore y detección de alteraciones.
    - Selector de carpetas del sistema con permisos persistentes (SAF).
    - Copia, cálculo y verificación de descargas con SHA-256.
    - Políticas de conflicto de nombres (`skip` y `rename`).
    - Detección y rechazo de archivos fuente corruptos o incompletos.
    - Exportación de diagnósticos al sistema de archivos.


## Alcance y límites

- Equipo Android disponible: emulador Android 16, API 36, páginas de 16384 bytes, ABI x86_64 con traducción ARM64. La pantalla de QA está configurada a 1440 × 3120.
- No hay un Galaxy S24 Ultra físico conectado durante esta revisión. La arquitectura del APK es la adecuada para ese teléfono; una prueba en el emulador no sustituye la comprobación en One UI y el hardware real.
- Las pruebas de almacenamiento nativo usan archivos temporales de QA, sin cuenta de Telegram. La sesión, sincronización y transferencia real en Android requieren iniciar sesión en ese dispositivo.
- La firma del APK es una firma de distribución local persistente. El setup Windows no cuenta con certificado Authenticode de editor.
- El cifrado adicional de archivos para subir a Telegram sigue deshabilitado en las dos aplicaciones.
- Los instaladores finales se identificarán por SHA-256 en `release/SHA256SUMS.txt`.
