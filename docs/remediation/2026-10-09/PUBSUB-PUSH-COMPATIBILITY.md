# Compatibilidad del sobre Pub/Sub push

Estado: corrección `d911c55` desplegada por revisión central y **E2E sintético PASS**. Observer `00005-dgr` procesó el evento y replay con RECORDED=1/DUPLICATE=1; recibo e incidente verificados. Cierre actual confirmado: canario `00006-6wv` Ready/DISABLED y sink apagado. El agente de esta corrección no hizo despliegues ni llamadas remotas. Se conserva a continuación el antecedente del primer intento: dos POST aceptados por Logging, HTTP204/INVALID_ENVELOPE del observador y recibo404.

## Hallazgo reproducible

La [documentación oficial de push](https://docs.cloud.google.com/pubsub/docs/push) muestra, tanto en el ejemplo mínimo como en el máximo, los campos `messageId` y `message_id` simultáneos, y `publishTime` y `publish_time` simultáneos. Los valores duplicados coinciden. El allowlist anterior en `src/transport.mjs` admitía solamente las formas camelCase, por lo que un sobre conforme a esos ejemplos se rechazaba antes de decodificar el LogEntry.

Es un defecto confirmado de compatibilidad y una explicación coherente del síntoma observado. No se capturó ni inspeccionó el cuerpo push de la primera entrega; por ello no se reconstruye retrospectivamente cada campo de aquel fallo. La inspección central del log sintético y el E2E exitoso tras desplegar la corrección respaldan la recuperación. No se amplió el allowlist de LogEntry por conjeturas.

Inspección central previa al fix: el LogEntry sintético leído contenía únicamente insertId, jsonPayload, logName, receiveTimestamp, resource, severity y timestamp; labels de recurso y campos del payload coincidían con los admitidos. Esto redujo la hipótesis de campos adicionales del log, sin sustituir la captura del sobre push. El cierre de esa primera ventana fue canario `00004-tjn` DISABLED y sink apagado.

## Cambio acotado

El decoder admite solamente los dos alias documentados adicionales. Exige al menos una forma de cada par, de tipo string. Si llegan ambas formas, exige igualdad exacta, sin preferir silenciosamente una. Conserva el límite y formato numérico de messageId, la vigencia de publishTime, límites/base64 de data, suscripción exacta, identidad OIDC y allowlist de origen/revisión/root/actor.

Se aceptan camelCase solamente, snake_case solamente o ambos con valores idénticos. Se rechazan conflictos, null/números en lugar de strings, metadatos ausentes, otros alias no documentados y fechas duplicadas textualmente distintas aunque representen el mismo instante. No modifica el input ni copia metadata de Pub/Sub al evento almacenado. No introduce logs de payloads o identificadores.

## Pruebas y recuperación

`node --test qa/scripts/remediation-sentinel-service.test.mjs qa/scripts/remediation-observation-publisher.test.mjs`: **21 tests PASS** (12 del servicio y 9 del productor). La cobertura nueva incluye cinco formas compatibles, dieciséis variantes inválidas y HTTP local con verificador de identidad simulado + detector/store reales sobre memoria: RECORDED, DUPLICATE y rechazo INVALID_ENVELOPE sin escrituras adicionales, eventCount=1.

Un 204 reconoce el mensaje según el contrato oficial de push. La corrección no implica que Pub/Sub vuelva a entregar automáticamente el sobre previamente rechazado; no confiar en DLQ para esa recuperación. Se mantuvieron las políticas ACK/retry/DLQ y la revisión central abrió una nueva ventana sintética controlada.

Build `2daebc49-c854-4798-b034-893b8005643b` SUCCESS, fuente `d911c55`,18archivos/80.4KiB; imagen observer `sha256:8968768dc71dd286d799944674b060abba5b7d47d4f244d50724fe7a70326977`. CANARY `00005-xgm`: dosPOST200 y ambos bindings REMOVED_VERIFIED. Observer `00005-dgr`: dosHTTP200, RECORDED=1 y DUPLICATE=1. GET exactos receipt200/incidente200; OBSERVE_ONLY_SINGLE_EVENT_VERIFIED con eventCount=1, authority=NONE y TTL válido. Así se verificó persistencia y replay, además de aceptación Logging.

Cierre central applyPASS: sinkdisabled:true y canario `00006-6wv` Ready/DISABLED confirmados en Terraform. Este éxito sintético no certifica productores financieros ni autoriza contención; el primer fallo permanece como antecedente y no se redefine como éxito.
