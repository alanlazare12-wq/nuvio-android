# Nuvio

Cliente de nube privada con React, TypeScript y Tauri. Usa Mensajes guardados de Telegram como almacenamiento remoto y SQLite para el catálogo local.

**Desarrollo**

```powershell
pnpm install
pnpm desktop:dev
```

La aplicación necesita el entorno nativo de Tauri para acceder al catálogo, los selectores de archivos y Telegram. `pnpm dev` inicia únicamente Vite en el puerto 1420; una pestaña convencional no dispone del puente nativo.

**Compilación y comprobaciones**

```powershell
pnpm check
pnpm build
pnpm qa:rust
pnpm lint:rust
pnpm desktop:build
```

`pnpm build` genera la interfaz en `dist`; `pnpm desktop:build` empaqueta la aplicación nativa. Los comandos de Android permanecen disponibles como `android:init`, `android:dev` y `android:build` y requieren el SDK y NDK correspondientes.

**TDLib local en Windows**

El descargador de TDLib puede acceder a la red incluso con `cargo --offline`. Para utilizar una copia local de la versión y arquitectura requeridas por `tdlib-rs`, define `NUVIO_TDLIB_DIR` con la carpeta que contiene `lib/tdjson.lib` y `bin/tdjson.dll`, junto con sus DLL auxiliares:

```powershell
$env:NUVIO_TDLIB_DIR = 'C:\ruta\a\tdlib'
pnpm qa:rust
pnpm lint:rust
```

El build copia las DLL al directorio de salida de Cargo y no necesita añadirlas globalmente al sistema. Esta opción local es para Windows; sin la variable se utiliza el descargador original. Para Android, elimina la variable antes de compilar para ese destino.

**Pruebas de interfaz**

Inicia `pnpm dev --host 127.0.0.1` y, en otra terminal, ejecuta `pnpm qa:ui`. El script requiere el paquete Playwright disponible en el proyecto o una ruta absoluta mediante `QA_PLAYWRIGHT_PATH`. En Windows usa Edge instalado; en otros sistemas usa Chromium de Playwright. Se pueden configurar `QA_BROWSER_CHANNEL` y `QA_BASE_URL`.

En este equipo se verificó con el runtime de Codex:

```powershell
$env:QA_PLAYWRIGHT_PATH = "$env:USERPROFILE/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"
pnpm qa:ui
```

Las pruebas ejecutan la interfaz real con respuestas IPC simuladas en un navegador aislado. No inician sesión ni envían archivos a Telegram. Los resultados y capturas se guardan en `qa/`.

**Integridad de archivos**

Las descargas reservan sus nombres al entrar en la cola, verifican tamaño y SHA-256 y se publican sin sobrescribir archivos existentes. Los nombres remotos no pueden introducir rutas fuera de la carpeta seleccionada.

La biblioteca de cifrado local escribe el formato `NUVIO02`, con un registro final autenticado, y mantiene lectura de `NUVIO01` con contenido autenticado. Los archivos antiguos vacíos, que solo contienen el encabezado y no pueden autenticar la contraseña, se rechazan. Los lectores antiguos no pueden leer `NUVIO02`. El formato anterior no contiene un final autenticado, por lo que no puede detectar retrospectivamente la eliminación de bloques completos. El cifrado adicional para subidas a Telegram sigue siendo una función no habilitada en la aplicación.

El detalle de esta revisión está en [qa/QA-REPORT.md](qa/QA-REPORT.md).

**Instaladores de distribución**

```powershell
pnpm windows:setup
pnpm android:setup
```

Windows genera `release/Windows/Nuvio-Setup-Windows11-x64.exe`. El setup incluye TDLib, las bibliotecas de Visual C++ y el instalador sin conexión de WebView2. Después de instalarlo, abre Nuvio desde su acceso directo; no hace falta Node.js, una terminal ni ejecutar Vite. La distribución actual no tiene un certificado Authenticode de editor.

Android genera `release/Android/Nuvio-Android-aarch64.apk`, firmado para instalaciones y actualizaciones directas. Es la arquitectura ARM64 del Galaxy S24 Ultra, con Android 8 como mínimo y SDK objetivo 36. El empaquetado comprueba la firma, el manifiesto de producción, las bibliotecas nativas, el enlazado con la libc de Android y la alineación de 16 KB del APK y de los segmentos ELF.

La clave y la contraseña de firma se conservan exclusivamente en `.release-signing/`, que está excluida de Git, del servidor de desarrollo y de los instaladores. Guarda una copia privada de esa carpeta: es necesaria para actualizar instalaciones existentes con la misma firma. No la compartas junto al APK ni la borres al limpiar compilaciones.

Las dos plataformas comparten catálogo, carpetas, búsqueda, favoritos, papelera, colas de transferencia, historial y vistas previas. Android usa el selector de carpetas del sistema para guardar descargas y conserva el permiso concedido; comprueba SHA-256 al copiar y al releer el archivo publicado. Protege las credenciales con Android Keystore y adapta la pantalla a barras del sistema, recortes y teclado. El botón Atrás cierra primero el diálogo o el menú y recorre la navegación antes de mandar la aplicación al fondo.

Las credenciales y la sesión de Telegram se configuran por dispositivo. La aplicación de Android no depende de que la versión Windows esté abierta. El cifrado adicional de archivos para subir a Telegram continúa deshabilitado en ambas plataformas.

Los resultados de la entrega y sus límites de verificación se registran en [qa/RELEASE-VERIFICATION.md](qa/RELEASE-VERIFICATION.md).
