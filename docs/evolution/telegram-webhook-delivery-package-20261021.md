# Telegram webhook: candidato retenido

Estado: **NO PUBLICAR**. Rama aislada `fix/telegram-webhook-certification-20261021`, basada en main `63ef0a1d7a45b6bdb19abad631c898d79ca45a91`. No se cambió main ni producción. El audio real continúa pendiente.

## Comparación y alcance

La captura productiva corresponde a `telegramwebhook-00033-dav`, ZIP SHA-256 `36d1f83e9fc632cb6a862328cb130bb9d8e6958958267c786d74d06998e48da3`. Los fuentes de webhook y repositorio coinciden con main; el transporte productivo todavía es anterior a `afe9ad2`. No se reutilizó el archivo de la notificación de prueba como si fuera este paquete.

La corrección reclama el evento mediante `DocumentReference.create`, reconoce la existencia previa sin volver a escribir el recibo y termina antes de cualquier acción para duplicados. Rechaza IDs ausentes, negativos, fraccionarios o de tipo incorrecto. Un recibo heredado o interrumpido tampoco se reejecuta automáticamente. Esto ofrece procesamiento a lo sumo una vez; **no garantiza entrega** si el proceso se interrumpe después de reclamarlo. No se debe eliminar un recibo para reintentar una entrega incierta.

El candidato exacto, construido desde el commit `7c57452a9e91fc507681b9edbe87d5591481abea`, tiene ZIP SHA-256 `fe7376b3e703dc931d0264d75f58946e450cbde3d19a5cb06fb6bccdeff3bc04`: nueve archivos fuente/compilado/mapa de tres módulos sustituidos, 1,233 archivos preservados. Paquete y lock productivos sin cambios; dependencias instaladas desde ese lock en una copia aislada. El preparador verifica igualdad AST completa de los compilados anteriores frente a sus fuentes antes de sustituirlos. Un archivo de entorno se excluye únicamente tras comprobar en memoria que todos sus valores existen en la configuración productiva y que no hay cargadores de entorno en el código.

## Evidencia

- Transporte compilado exacto: 23 pruebas aprobadas.
- Candidato completo, cargado por `package.main` con Firestore desechable y proveedor simulado: 11 comprobaciones aprobadas. Incluyen secreto incorrecto/método, no persistencia sin autorización, respuesta existente, reenvío secuencial, ocho copias simultáneas, entrega incierta, IDs inválidos, recibos heredados y rechazos para usuarios no vinculados. Colecciones financieras sintéticas intactas.
- Comprobación de tipos de 310 fuentes del archivo exacto: cero diagnósticos; resolución de dependencias desde la instalación de su lock productivo.
- Política de autorización canónica: aprobada. No hubo cambios de roles, reglas ni permisos.
- Producción anterior y candidato de sólo transporte reproducen tres fallos: un reenvío adicional secuencial, ocho envíos para ocho copias simultáneas y dos intentos tras repetir una entrega incierta.
- **Reversión rechazada**: en un proceso nuevo, el archivo productivo anterior recibió un evento ya reclamado y atendido por el candidato. Volvió a enviarlo: esperado cero, observado uno.

Las pruebas de reproducción terminan correctamente cuando logran demostrar el defecto esperado. Eso no convierte el paquete ni su reversión en una certificación aprobada. No se creó `artifact-verification.json` ni un marcador listo para publicar. El grupo nuevo permanece fuera de la lista permitida del controlador.

## Condiciones pendientes de publicación

1. Preparar y probar una recuperación que respete los recibos nuevos. Conservar el ZIP anterior permite reconstruirlo, pero no lo convierte en una reversión segura.
2. Certificar una transición que no permita coexistencia operativa con revisiones antiguas que ignoran las reservas. El riesgo durante el cambio se infiere del fallo de reversión reproducido; no se ha probado un despliegue gradual seguro.
3. Completar las pruebas autenticadas de vinculación, documentos y control web afectadas por la reserva, sin proveedores reales ni operaciones financieras. Los rechazos de usuarios no vinculados no certifican esos flujos autorizados.

No se amplían otros consumidores financieros de Telegram para evitar este bloqueo. La publicación concurrente de la interfaz se observó por lectura y no se modificó. La notificación de prueba anterior mantiene `sendmytelegramtestnotification-00016-mix`.

## Reproducción aislada

`scripts/prepare-telegram-webhook-overlay.mjs` recibe la captura privada con archivo fijado por generación, hashes y configuración de referencia. `PAY0_BUILD_TOOL_ROOT` apunta a una copia con JSZip y TypeScript instalados. El preparador sólo produce archivos locales; no publica.

Las pruebas integradas están en `qa/scripts/telegram-webhook-exact-emulator.cjs`; el ejecutor es `qa/scripts/run-telegram-webhook-emulators.cjs`. Requieren `PAY0_TELEGRAM_PREPARED_FILE` y `PAY0_TELEGRAM_RUNTIME_FILE`, manifiestos privados con las rutas de extracción verificadas y el archivo preparado. El manifiesto incluye `runtime`, `baseRuntime`, `dependencyRoot`, hashes del archivo y de cada fuente. El ejecutor usa un proyecto `demo-`, puertos efímeros y elimina credenciales del entorno. El código de prueba impide conexiones fuera de Firestore local y sustituye Telegram por un proveedor sintético. Ejecuta producción, candidato y producción como reversión en procesos separados para compartir únicamente los recibos del emulador. Nunca apuntar estos manifiestos a una sesión productiva.

No se suben archivos productivos, respuestas privadas, entornos ni resultados generados a Git. La evidencia depurada se entrega fuera del repositorio.
