# Nuvio 1.1.0 — verificación de distribución

Revisión del 9–10 de septiembre de 2026, incorporando los cambios del usuario y las mejoras de arrastre y precarga. Rama principal: `master`.

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
| Rust, reglas de catálogo, transferencias, integridad y carpetas | 38 aprobadas, 0 fallos | `rust-tests-current.log` |
| Clippy con advertencias tratadas como errores | Aprobado | `clippy-current.log` |
| Interfaz real con IPC simulado | 18 aprobadas, 0 fallos | `ui-current.log`, `ui-results.json` |
| PDF real y trabajador de PDF.js en pantalla móvil | Aprobado, límite de memoria verificado | `ui-results.json` |
| TypeScript y compilación de producción de la interfaz | Aprobado | Registros de empaquetado |

Las pruebas de interfaz cubren carpetas, selección, papelera, favoritos, tema, diálogos, errores, vistas previas y anchos de 390, 768 y 1280 píxeles. Las respuestas de Telegram se simulan en esas pruebas; no son una prueba de transferencia real.

## Mejoras de 1.1.0 comprobadas

- Ratón: selección desde el cuerpo de la tarjeta y movimiento de varios archivos. `pointercancel` del arrastre HTML ya no borra el estado del movimiento.
- Pantalla táctil: selección por toque y arrastre desde toda la tarjeta. Las pruebas envían gestos táctiles mediante Chromium, no eventos DOM simulados. Soltar fuera del destino cancela sin mover archivos.
- Miniaturas: imágenes y texto precargados antes de abrir el visor, con fallback de iconos. Las originales se limitan en Rust a 8 MB para imágenes/PDF y 256 KB para texto; no se descargan originales de video para la cuadrícula.
- Visor de texto: el límite de 2 MB se comprueba antes de llamar a la preparación/descarga nativa.
- Interfaz revisada a 390, 768 y 1280 píxeles; PDF real procesado con el trabajador de PDF.js.
- Graphify actualizado mediante AST: 685 nodos y 1766 relaciones; el mapa inicial era anterior a los cambios del usuario.

## Verificación de instaladores 1.1.0

| Paquete | Resultado |
| --- | --- |
| Windows 11 x64, NSIS 1.1.0 | Compilación, instalación silenciosa y apertura de la aplicación aprobadas. |
| Contenido instalado de Windows | 15 DLL idénticas por SHA-256; ejecutable idéntico salvo el marcador documentado de Tauri `UNK -> NSS`; incluye `index-De7XTSkx.js`, la última interfaz. |
| Android ARM64 1.1.0, código 1001000 | Firma v2 válida, certificado persistente y APK de producción no depurable. Android mínimo 26, objetivo 36. |
| ELF y alineación Android | AArch64, dependencia dinámica de libc.so, segmentos de 16 KB y zipalign de 16 KB aprobados para las dos bibliotecas. |
| Instalación Android | Aprobada. El SHA-256 del APK extraído del emulador coincide con el archivo entregado. |
| Arranque normal Android | Aprobado, inicio en frío en 1778 ms; interfaz inspeccionada visualmente y sin errores fatales del proceso en logcat. |
| Almacenamiento nativo Android | `NUVIO_NATIVE_TESTS_PASSED` sobre el APK firmado y minificado de distribución. |

La prueba nativa cubre Keystore (cifrado/descifrado y alteraciones), selección SAF y permiso persistente, publicación y relectura con SHA-256, omisión de duplicados, renombrado, rechazo de fuente corrupta, listado y exportación de diagnóstico. Usa únicamente archivos temporales en `Download/Nuvio-QA` y elimina sus propios archivos al finalizar.

Windows se abrió desde `qa/windows-install-1.1.0/nuviodrive-v1.exe` con el puerto de desarrollo 1420 sin servidor escuchando. Conservó la sesión y el catálogo existentes. La prueba visual no modificó archivos del usuario.

Evidencias locales: `windows-final-build.log`, `windows-install-verification.json`, `android-final-build.log`, `android-signature.log`, `android-alignment.log`, `android-elf.log`, `android-manifest.log`, `android-native-final.log`, `android-final-startup.log` y `android-release-1.1.0.png`. Los registros y capturas con datos del equipo se excluyen del repositorio.

### Identificación de los entregables

| Archivo | Bytes | SHA-256 |
| --- | ---: | --- |
| Nuvio-Setup-Windows11-x64.exe | 277242589 | `36c51bf959acecd952cd249e007992fc3582d9f3a5ac6faacd6cb92500fe0a57` |
| Nuvio-Android-aarch64.apk | 57081583 | `85e2f0349e38e49f6acb7bb43ed67e4d12fbcea260ea7d922358a11e97ee31da` |

## Alcance y límites

- Equipo Android disponible: emulador Android 16, API 36, páginas de 16384 bytes, ABI x86_64 con traducción ARM64. La pantalla de QA está configurada a 1440 × 3120.
- No hay un Galaxy S24 Ultra físico conectado durante esta revisión. La arquitectura del APK es la adecuada para ese teléfono; una prueba en el emulador no sustituye la comprobación en One UI y el hardware real.
- El programa de pruebas de almacenamiento nativo usa archivos temporales de QA, sin cuenta de Telegram. La sesión, sincronización y transferencia real en Android requieren iniciar sesión en ese dispositivo.
- La firma del APK es una firma de distribución local persistente. El setup Windows no cuenta con certificado Authenticode de editor.
- El cifrado adicional de archivos para subir a Telegram sigue deshabilitado en las dos aplicaciones.
- Los instaladores se identifican por SHA-256 en `release/SHA256SUMS.txt`. La verificación se aplica a esos archivos exactos. Los instaladores y las claves de firma quedan fuera del historial Git.
