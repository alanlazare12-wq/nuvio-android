# Sincronización, filtros y concurrencia — 2026-09-11

Cambios aplicados sobre las modificaciones locales existentes, conservando las particularidades de Windows y Android.

- Progreso real de exploración del historial con recuento total opcional y tiempo restante aproximado; la aplicación del catálogo ocupa la fase final y solo un resultado satisfactorio llega al 100%.
- Serialización de sincronizaciones y estado de error/interrupción; sin inventar porcentaje cuando se desconoce el total.
- Orden natural español para archivos y carpetas; Recientes deja de truncarse a doce elementos y su contador coincide con el catálogo.
- Ocho subidas por defecto, selector de 1 a 16 y aplicación del límite en la cola en ejecución. Reducir el límite deja terminar los trabajos ya activos.
- Migración única de la antigua configuración predeterminada de cuatro; se respeta posteriormente la preferencia del usuario, incluida una sola subida.

Validación: ver resultados locales `ui-results.json`, pruebas Rust, registros de firma/alineación Android y verificación de instalación Windows. Las pruebas de interfaz usan IPC simulado; no constituyen una prueba de velocidad de red con Telegram. Sin S24 Ultra conectado, la verificación del APK no certifica su funcionamiento en ese dispositivo físico.

Resultado Android: 43 pruebas Rust y 22 pruebas de interfaz aprobadas; TypeScript, compilación de producción y Clippy aprobados. APK firmado v2, ARM64, minSdk 26, targetSdk 36, alineación y ELF de 16 KB verificados. SHA-256: f2fb1fc5006ab9fa00d048025f7d47c3a0bd317c173c6ab49bcd5a72edaedc11. No se ejecutó esta entrega en un S24 Ultra físico ni en emulador.
