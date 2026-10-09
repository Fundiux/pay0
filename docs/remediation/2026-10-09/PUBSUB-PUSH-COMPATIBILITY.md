# Compatibilidad del sobre Pub/Sub push

Estado: corrección local probada; no despliegue ni llamadas remotas desde este trabajo. La revisión central reportó dos POST aceptados por Logging, limpieza IAM correcta, un HTTP 204 del observador con métrica INVALID_ENVELOPE y recibo 404. La ventana se está cerrando centralmente.

## Hallazgo reproducible

La [documentación oficial de push](https://docs.cloud.google.com/pubsub/docs/push) muestra, tanto en el ejemplo mínimo como en el máximo, los campos `messageId` y `message_id` simultáneos, y `publishTime` y `publish_time` simultáneos. Los valores duplicados coinciden. El allowlist anterior en `src/transport.mjs` admitía solamente las formas camelCase, por lo que un sobre conforme a esos ejemplos se rechazaba antes de decodificar el LogEntry.

Es un defecto confirmado de compatibilidad y una explicación coherente del síntoma observado. **No demuestra que fuera la única causa del evento remoto**: no se capturó ni inspeccionó el cuerpo push real en este trabajo. La revisión central inspeccionará por separado la forma del log sintético fijo; no se amplió el allowlist de LogEntry por conjeturas.

Actualización central: el LogEntry sintético leído contiene únicamente insertId, jsonPayload, logName, receiveTimestamp, resource, severity y timestamp; labels de recurso y campos del payload coinciden con los admitidos. Esto reduce la hipótesis de campos adicionales del log, sin sustituir la captura del sobre push. Cierre confirmado: canario `00004-tjn` DISABLED y sink apagado.

## Cambio acotado

El decoder admite solamente los dos alias documentados adicionales. Exige al menos una forma de cada par, de tipo string. Si llegan ambas formas, exige igualdad exacta, sin preferir silenciosamente una. Conserva el límite y formato numérico de messageId, la vigencia de publishTime, límites/base64 de data, suscripción exacta, identidad OIDC y allowlist de origen/revisión/root/actor.

Se aceptan camelCase solamente, snake_case solamente o ambos con valores idénticos. Se rechazan conflictos, null/números en lugar de strings, metadatos ausentes, otros alias no documentados y fechas duplicadas textualmente distintas aunque representen el mismo instante. No modifica el input ni copia metadata de Pub/Sub al evento almacenado. No introduce logs de payloads o identificadores.

## Pruebas y recuperación

`node --test qa/scripts/remediation-sentinel-service.test.mjs qa/scripts/remediation-observation-publisher.test.mjs`: **21 tests PASS** (12 del servicio y 9 del productor). La cobertura nueva incluye cinco formas compatibles, dieciséis variantes inválidas y HTTP local con verificador de identidad simulado + detector/store reales sobre memoria: RECORDED, DUPLICATE y rechazo INVALID_ENVELOPE sin escrituras adicionales, eventCount=1.

Un 204 reconoce el mensaje según el contrato oficial de push. Por tanto, la corrección no implica que Pub/Sub vuelva a entregar automáticamente el sobre previamente rechazado; no confiar en DLQ para esa recuperación. Tras revisión, nueva imagen y preflights, root puede abrir otra ventana sintética acotada. La aceptación E2E sigue requiriendo evidencia de recibo/incidente y entrega/procesamiento; los tests locales y HTTP200 de Logging no la sustituyen. No se cambiaron políticas ACK/retry/DLQ ni se activó el sink aquí.
