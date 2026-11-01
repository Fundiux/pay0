# Telegram webhook: publicación y recuperación compatibles

Estado al 21 de octubre de 2026: **PUBLICADO Y VERIFICADO**. Sólo se actualizaron las fuentes de `telegramWebhook`. No hubo operaciones financieras, mensajes reales de prueba ni audio real. El audio permanece pendiente.

## Artefactos exactos

| Uso | Revisión | SHA-256 del ZIP | Commit de su receta |
| --- | --- | --- | --- |
| Funcional, 100 % del tráfico | `telegramwebhook-00037-ged` | `fe7376b3e703dc931d0264d75f58946e450cbde3d19a5cb06fb6bccdeff3bc04` | `7c57452a9e91fc507681b9edbe87d5591481abea` |
| Pausa de recuperación, disponible | `telegramwebhook-00034-rul` | `e7439f8b0384cf7ca9ad5e6f74a6a067a17fa5eaf297b45991d01f81142dac51` | `8b9b153c6e874576e0ebae39d03c5713cca9b292` |

Imagen funcional: `us-central1-docker.pkg.dev/pay-0-system/gcf-artifacts/pay--0--system__us--central1__telegram_webhook@sha256:3a790f0fd586ddc2480fa8ec95522ecb65a2974ddf03d5dbebd52052d58b1bf6`.

Imagen de recuperación: `us-central1-docker.pkg.dev/pay-0-system/gcf-artifacts/pay--0--system__us--central1__telegram_webhook@sha256:812c5502b07b04fb06b38c3b2617fecf0504d19b876efc89dee95cdd0d2d7bde`.

La pausa conserva autenticación y rechazo de métodos, y responde 503 con `Retry-After: 30` antes de cualquier lectura de negocio, reserva o envío. No consume tokens ni modifica recibos. Recuperar significa interrumpir temporalmente el procesamiento; **no significa volver al código anterior que repetía eventos**.

Main continúa en `63ef0a1d7a45b6bdb19abad631c898d79ca45a91`. El transporte ya estaba integrado; la reserva atómica y sus guardas nuevas están en esta rama aislada. No se hizo push, PR ni integración de esta rama. Su CI remota queda pendiente, y se añadieron las pruebas nuevas al flujo de CI para esa futura integración.

## Pruebas y preservación

- 23 pruebas del transporte compilado exacto ya certificadas: se reutiliza ese mismo módulo, comprobado por hash en ambos ZIP.
- Diez comprobaciones integradas nuevas con Firestore desechable y Telegram simulado: permisos, pausa sin efectos, vinculación y duplicados, control web con rol/código, documento propio frente a uno de otra raíz, solicitud antigua retenida antes de escribir, mezcla de veinte solicitudes y entrega incierta. Storage usa un adaptador de archivo sintético; no se prueba un documento real de producción.
- Reinicio en un proceso separado: un recibo atendido no se vuelve a enviar, y un evento rechazado durante la pausa puede procesarse una sola vez al reactivar.
- 54 pruebas de controles de despliegue, recuperación, concurrencia y drenaje aprobadas. La comprobación de tipos de cada artefacto abarca 310 fuentes y no presenta diagnósticos. Política canónica de autorización aprobada.
- Cada arranque independiente cargó 346 exportaciones desde `package.main`; sólo se invocaron los rechazos de método y secreto del webhook, con red bloqueada.
- La pausa preserva 1,233 archivos originales y cambia nueve archivos fuente/compilado/mapa. La activación conserva 1,239 archivos de la pausa y cambia únicamente el módulo del webhook y su mapa/fuente. Dependencias y lock productivos sin cambios.
- Se verificaron los bytes publicados por generación de Storage, la imagen, el estado propio exacto, configuración, IAM y rechazos HTTP 405/401. No se publicaron reglas, permisos, variables ni otros exports.

## Transición realizada, sin repetir publicaciones

1. La pausa se publicó una sola vez. Operación: `operation-1792562751682-65e538a0d3778-64362df9-d89a5976`.
2. El servicio antiguo dejó de recibir tráfico. Su primer cero de métricas precedía a la pausa y se rechazó como evidencia insuficiente.
3. Se creó una ruta temporal a la revisión antigua con **0 %** del tráfico, manteniendo el **100 %** en la pausa. Sólo recibió un GET sin secreto ni evento, que respondió 405. Se observó una instancia y se retiró esa ruta una sola vez. No creó imágenes ni revisiones. La retirada se reconcilió por lectura tras un rechazo local de campos automáticos de auditoría; no se repitió el cambio aceptado.
4. Barrera de retirada: `2026-10-21T06:23:56.729895Z`. Después, la métrica de `06:31:00Z` reportó explícitamente cero instancias activas y cero inactivas. La revisión antigua estaba retirada y sin rutas ni etiquetas. La generación/configuración completa quedó fijada por hash. Las revisiones retiradas dejan de emitir métricas: un cero terminal posterior a la barrera sólo se conserva como certificado si sigue retirada y la configuración exacta permanece intacta. Ausencia de datos, ceros anteriores o cambios de estado bloquean la activación.
5. Una actualización concurrente de `ssrpay0system` bloqueó temporalmente el siguiente paso. Se esperó su finalización, sin modificarla.
6. Se renovó la comprobación de drenaje inmediatamente antes del PATCH funcional, a `06:38:38.155Z`, sin operaciones concurrentes. La versión funcional se publicó una sola vez mediante `operation-1792564718532-65e53ff48f6da-5a79301e-abf35bf5`.

Cloud Run confirmó dos revisiones reales nuevas: `00034-rul` y `00037-ged`. Los números de generación intermedios correspondieron a cambios de tráfico, no a nuevas publicaciones de imágenes. Todas las etiquetas temporales quedaron retiradas.

La interfaz avanzó por trabajo concurrente desde `ssrpay0system-00618-rim` a `00620-zuz`. `createpago-00063-vif`, `delegatehugovoiceturn-00011-nom` y `sendmytelegramtestnotification-00016-mix` conservaron sus metadatos exactos. No se restauró ni sobrescribió esa línea concurrente.

## Recuperación preparada

El plan privado `certified-traffic-recovery.json`, junto al input de activación, tiene SHA-256 `9dfc94800e3899f4095057d27c1e386ca82a26d87469db9cb0c1ffbb26e2cc2c`. Fue probado con los artefactos exactos en emulador y validado contra la API productiva con `dryRun=all`; **no se ejecutó una reversión real de producción**.

`scripts/telegram-webhook-transition-control.mjs --execute-recovery <plan-privado> <sha256>` dirige el tráfico a la imagen de pausa ya existente. No reconstruye ni repite despliegues. Exige coincidencia exacta de Function, servicio, IAM, imagen y plan, y usa `metadata.resourceVersion` para rechazar una escritura concurrente. El único cambio de spec es el tráfico. Los campos automáticos de auditoría admitidos se validan contra identidades concretas observadas, y una validación de imagen fallida no se ignora.

La API v2 rechazó el ensayo sin cambios de este servicio administrado por Functions con conflicto de revisión existente. Se usó v1, que preservó íntegramente su template y permite control mediante resourceVersion. Se bloqueó el rollback genérico a fuentes anteriores para ambos grupos del webhook.

El ejecutor escribe un diario exclusivo antes de enviar la recuperación. Ante resultado incierto, inspeccionar ese diario y el estado mediante GET: no reenviar el PUT ni reconstruir la revisión. Si cambió el estado propio, preparar otro plan desde evidencia actual; nunca forzar la versión anterior sobre trabajo concurrente.

## Límites

La reserva es a lo sumo una vez, no una garantía de entrega. Una interrupción después de reservar puede dejar trabajo incompleto; no se elimina el recibo ni se repiten automáticamente efectos inciertos. La pausa depende de los reintentos del proveedor y tampoco garantiza entrega. No se certificaron audio ni sesiones o documentos reales de usuarios. Los demás consumidores financieros de Telegram siguen requiriendo su validación propia.

Referencias de contrato: [tráfico y solicitudes en curso de Cloud Run](https://docs.cloud.google.com/run/docs/rollouts-rollbacks-traffic-migration), [v1, resourceVersion y dryRun](https://docs.cloud.google.com/run/docs/reference/rest/v1/namespaces.services/replaceService), [métricas de instancias](https://docs.cloud.google.com/monitoring/api/metrics_gcp_p_z), [reintentos de webhooks de Telegram](https://core.telegram.org/bots/api#setwebhook).

Las capturas completas, ZIP, variables, planes e inputs permanecen privados e ignorados en Git. Las evidencias públicas depuradas se entregan fuera del repositorio.
