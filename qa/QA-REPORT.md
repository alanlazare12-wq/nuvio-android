# Revisión QA de Nuvio — 9 de septiembre de 2026

Se revisaron el catálogo local, la cola de transferencias, las rutas y reservas de descargas, la preparación de subidas, las funciones de cifrado, las vistas de archivos, el reproductor, el tema y la accesibilidad de los diálogos.

**Errores corregidos**

| Área | Fallo encontrado | Comportamiento corregido |
| --- | --- | --- |
| Descargas | Dos archivos con el mismo nombre reservaban el mismo destino antes de existir en disco. | La reserva y el alta de la descarga son una transacción. Omitir y renombrar consideran los destinos ya reservados en la cola. |
| Descargas | Un nombre remoto podía contener una ruta absoluta o `../` y salir de la carpeta seleccionada. | Se validan los nombres, separadores, caracteres inválidos y nombres reservados de Windows. |
| Catálogo | Al sincronizar un documento renombrado cambiaba la extensión, pero no su tipo ni su fecha. | Se actualizan los metadatos remotos y se conservan favorito y papelera. |
| Cola | La consulta limitaba a 250 registros y esa misma lista controlaba los totales y las acciones sobre la cola. | La lista y el resumen incluyen todos los registros. Prueba con 301 trabajos. |
| Cola | Reanudar un trabajo completado cambiaba su fase a listo aunque seguía completado. | La actualización de fase solo sucede si el estado permite reanudar. El reintento manual reinicia el contador de intentos. |
| Subidas | Las URL locales con espacios o acentos se interpretaban literalmente como `%20` y similares. | Se utiliza el analizador de URL y la comprobación de tamaño recibe la ruta normalizada. |
| Subidas | Un fallo al crear el directorio de preparación dejaba el trabajo en “Copiando”. | Se registra un error recuperable en el trabajo. |
| Subidas | Dos preparaciones simultáneas podían superar la comprobación inicial de duplicados. | Se vuelve a comprobar el hash dentro de la transacción que publica el trabajo preparado. |
| Multimedia | Cerrar y volver a abrir la misma vista previa podía provocar una colisión en caché. | Una segunda preparación reutiliza la copia ya verificada. Una copia corrupta sigue produciendo error. |
| Multimedia | El botón de cerrar quedaba deshabilitado durante la preparación. Las respuestas tardías podían modificar otra vista previa. | Se permite cerrar, se invalidan respuestas de solicitudes anteriores y se mantiene separada la preparación actual. |
| Selección | Los archivos enviados a la papelera o excluidos por un nuevo orden seguían seleccionados. | La selección se reconcilia con la lista visible cada vez que cambia. |
| Actualización | Una petición lenta del catálogo podía sobrescribir una respuesta más reciente. | Solo la solicitud vigente puede actualizar el estado de la interfaz. |
| Tema | El modo oscuro se perdía al recargar. | Se guarda la preferencia y, si no existe, se usa la del sistema. |
| Accesibilidad | Escape no cerraba los diálogos y Tab salía del diálogo. | Componente compartido con control del foco, cierre con Escape y restauración del foco. |
| Accesibilidad | Las acciones de la vista de lista y varios campos de autenticación carecían de nombres accesibles. | Se incorporan títulos, etiquetas vinculadas y estados de favorito y filtro. |
| Pantallas pequeñas | El menú lateral y el diálogo podían dejar controles fuera del área visible. | El menú y los diálogos permiten desplazarse; se verifica también 844 × 390. |
| Presentación | Los nombres sin extensión terminaban en un punto y los botones reducían demasiado el nombre en móvil. | Se formatea el nombre correctamente y las acciones ocupan su propia línea en móvil. |
| Arranque | Se ocultaba el detalle del error cuando no se podía abrir el catálogo. | El error se muestra junto con la opción de reintentar. |
| Identidad | El HTML conservaba el idioma inglés, el título del template y el icono de Vite. | Se configura español, el título Nuvio y un icono de nube. |
| Cifrado local | Un archivo truncado podía aceptarse como completo; una contraseña errónea podía dejar una salida parcial o sobrescribir una existente. | Escritura temporal y publicación sin sobrescritura. El nuevo formato autentica el final, incluidos los archivos vacíos, y detecta truncamiento y degradación del encabezado. |
| Herramientas | Clippy requería descargar TDLib otra vez pese a tener una copia local. | Se admite `NUVIO_TDLIB_DIR` en Windows y se enlazan/copían las DLL localmente. |

**Validación**

- Base inicial: TypeScript y build correctos, 14 pruebas Rust correctas.
- Reproducción: siete pruebas Rust nuevas fallaron contra el código original; se corrigieron y pasaron. La primera ejecución de las diez pruebas UI originales tuvo ocho fallos.
- Batería final de Rust: 27 pruebas, incluyendo concurrencia, destinos reservados por catálogos nuevos y anteriores, rutas inválidas, más de 250 trabajos, fallos de preparación, hashes, caché, cifrado y compatibilidad del formato anterior.
- Batería final de interfaz: 11 pruebas, con resultados en `ui-results.json`.
- Clippy se ejecuta para todos los targets del host con `-D warnings`, utilizando TDLib local.
- Se comprueba TypeScript y se genera el build de producción de la interfaz.
- Capturas inspeccionadas de escritorio y móvil; comprobación de ausencia de desbordamiento horizontal en 390, 768 y 1280 píxeles. También se verifica el diálogo y acceso a Ajustes en 844 × 390.

**Alcance y compatibilidad**

Las pruebas de interfaz usan Playwright sobre la interfaz real con un puente IPC simulado y datos ficticios. No se verificaron el inicio de sesión real en Telegram, una transferencia contra el servicio remoto, las notificaciones del sistema, los selectores nativos ni la ejecución en un dispositivo Android. El análisis de Clippy para todos los targets se refiere a biblioteca, binarios y pruebas del host Windows; no es una compilación cruzada de Android.

Las funciones de cifrado local generan `NUVIO02` y leen archivos antiguos `NUVIO01` con contenido autenticado. Los archivos antiguos vacíos que solo contienen el encabezado se rechazan porque no autentican la contraseña. Un lector antiguo no puede abrir el nuevo formato. El formato antiguo no permite detectar retrospectivamente la eliminación de bloques completos porque no contiene un final autenticado. La función de cifrado adicional para subidas a Telegram no está habilitada.

El código original de `src`, `src-tauri/src` y `package.json` se conservó en `baseline-before-qa.zip`. En ese archivo ZIP, los archivos Rust aparecen bajo `src/` y deben restaurarse en `src-tauri/src/`; es una copia de respaldo de fuentes, no un instalador. `ui-baseline-results.json` conserva la primera ejecución de interfaz. Los archivos nuevos y las instrucciones para repetir las comprobaciones están documentados en el README.

Estas comprobaciones cubren los casos enumerados; no constituyen una garantía de ausencia de errores en flujos que requieren el entorno nativo o Telegram real.

---

# Revisión QA Experta — Protección contra Selección Masiva y Sincronización Incremental (12 de septiembre de 2026)

Se realizó una auditoría completa de QA sobre las dos nuevas funciones del sistema en Android y Escritorio:

### 1. Funcionalidades evaluadas y comportamiento verificado

| Módulo | Escenario de prueba | Comportamiento verificado | Estado |
| :--- | :--- | :--- | :---: |
| **Protección Masiva (Android)** | Selección de >250 archivos vía selector nativo (`NuvioMobilePlugin.kt`) | Rechazo inmediato antes de staging en flash (`cacheDir/upload_staging`). Evita saturación de Binder (1 MB) y Android LMK watchdog (`kill -9`). | **Aprobado** |
| **Protección Masiva (Android)** | Selección de carpetas con >250 archivos en subdirectorios (`uploadDirectoryPicked`) | Validación temprana durante el recorrido de `DocumentFile`. Si supera 250, aborta y notifica al usuario sin bloquear I/O ni memoria. | **Aprobado** |
| **Protección Masiva (Desktop)** | Selección >500 archivos en selector o arrastre externo (`App.tsx`) | Validación antes de invocar IPC (`prepare_upload` / `prepare_zip_uploads`). Muestra aviso de lote seguro y sugiere compresión ZIP. | **Aprobado** |
| **Protección Masiva (Backend)** | Plan de subida de carpetas >500 archivos (`build_directory_upload_plan` en `lib.rs`) | Rechazo con `Err` descriptivo a nivel Rust si el conteo recursivo excede 500 archivos. | **Aprobado** |
| **Sincronización Incremental** | Catálogo local ya sincronizado (sin cambios remotos) | Consulta instantánea a `max_telegram_message_id()`. Paginación de `get_chat_history` se detiene en el 1.er lote (~50 ms). Reporta: "Tu catálogo ya está al día con la nube." | **Aprobado** |
| **Sincronización Incremental** | Detección de nuevos archivos subidos desde otro dispositivo | Paginación se detiene al alcanzar el mensaje `<= max_known_id`. Solo indexa el diferencial y notifica: *"X archivo(s) nuevo(s) sincronizado(s)."* | **Aprobado** |
| **Sincronización Completa** | Forzado manual por clic derecho (`onContextMenu` en botón Sync) | Envía `{ full: true }` a `sync_files`, ignorando el corte anticipado para auditoría profunda. | **Aprobado** |

### 2. Matriz de Ejecución Automatizada

1. **Pruebas Unitarias de Rust (`cargo test --manifest-path src-tauri/Cargo.toml --lib`):**
   * **60 pruebas ejecutadas, 60 aprobadas, 0 fallidas, 0 ignoradas.**
   * Nuevas pruebas verificadas:
     * `repository::tests::max_telegram_message_id_returns_correct_max_or_none`: Valida el cálculo de ID máximo sobre SQLite, consistencia tras borrado e inicialización adecuada de tablas remotas.
     * `tests::test_build_directory_upload_plan_rejects_more_than_500_files`: Valida que el backend rechace planes de directorios que excedan el límite de seguridad de 500 archivos.
2. **Análisis Estático con Clippy (`cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`):**
   * **0 advertencias, 0 errores.** Cumplimiento total de directrices Rust para todos los targets del workspace.
3. **Comprobación de Tipos TypeScript (`pnpm run check` -> `tsc --noEmit`):**
   * **0 errores.** Tipado estricto en puentes, componentes y utilidades.
4. **Compilación de Producción Frontend (`pnpm run build` -> `tsc && vite build`):**
   * **Exitoso.** 1677 módulos transformados, generación de bundles minificados sin errores.
5. **Suite de UI Automatizada Playwright (`pnpm run qa:ui`):**
   * **26 pruebas ejecutadas, 26 aprobadas, 0 fallidas.**
   * Nuevas pruebas añadidas a la suite permanente:
     * `batch-upload-limit-protection-desktop`: Comprueba que 501 archivos seleccionados bloqueen la preparación y muestren el aviso correspondiente sin llamadas espurias al backend.
     * `incremental-and-full-sync-actions`: Comprueba el flujo incremental (`full: false`) con 0 y 3 archivos, y el forzado con clic derecho (`full: true`) verificando parámetros y notificaciones.
6. **Compilación Nativa Android Kotlin (`./gradlew.bat :app:compileUniversalReleaseKotlin`):**
   * **BUILD SUCCESSFUL en 1m 54s, 83 tareas ejecutadas.**
   * Verificación sin errores de sintaxis, concurrencia o tipos en `NuvioMobilePlugin.kt`.
