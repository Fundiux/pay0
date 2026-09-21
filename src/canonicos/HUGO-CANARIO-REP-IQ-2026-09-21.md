# Canario B de recuperación REP en IQ

La cohorte inicial contiene **una** aplicación: `AP1C4U1E6`. Las cuatro candidatas (`AP1C4U1E6`, `AP2C4U1E6`, `AP3C4U1E6`, `AP4C4U1E6`) satisfacían el mismo conjunto de comprobaciones locales el 2026-09-21. Se eligió el primer folio por orden estable. `AP1C6U1E2` espera confirmación de aplicación IQ y queda fuera.

El lanzador vuelve a calcular el inventario completo y las cuatro vistas previas locales. Exige cinco detectados, cero procesados y cuatro candidatos listos antes de crear una única orden `LOOKUP` en `hugoComplementCanaries/iq-rep-read-ap1c4u1e6-v1`. La Function acepta únicamente esa orden y ese folio, toma el trabajo una sola vez y comprueba evidencia local, root, actor, cliente, perfil, Master, configuración y cuota B antes de autenticarse. Repite las compuertas durante la consulta y la descarga.

La ruta desplegada contiene exclusivamente llamadas de lectura IQ: autenticación necesaria `POST /users/sessions`, GET de depósitos, GET del REP y descarga del archivo si existe. No llama a `requestIqComplement` ni al POST de generación. Si no hay REP, registra `PENDING`, resultado de la consulta y `nextCheckAt`; no abre la cohorte restante. Si hay REP, valida XML timbrado, UUID de factura, parcialidad, importe, saldos, moneda y PDF pareado; guarda por aplicación, relee blobs y metadatos, compara SHA-256, valida otra vez XML/PDF y solo entonces marca `RECEIVED`. Cualquier discrepancia deja el canario `STOPPED` para revisión. La bitácora de etapas y `activityLog` guardan las decisiones sin registrar credenciales ni contenido documental.

El despliegue se limita a `functions:runHugoIqRepReadCanary`; no cambia el scheduler IQ, el trigger prospectivo ni las políticas de Firestore. El lanzador no toca IQ desde la estación local. Tras ejecutar el canario, inspeccionar su documento y las métricas del inventario antes de decidir cualquier ampliación.

## Resultado real del primer lanzamiento

Se desplegó únicamente `runHugoIqRepReadCanary` en `pay-0-system/us-central1` y se creó una orden de cohorte 1. Línea base de `/hugo`: 60 aplicaciones recorridas, 5 detectados, 0 procesados, 5 pendientes, 0 errores. La bitácora registra `LOCAL_EVIDENCE_VERIFIED`, `LOOKUP_QUOTA_RESERVED` (límite B: 25), `IQ_SESSION_OPENED` y `STOPPED` con `IQ_REP_REQUEST_STATE_REQUIRES_REVIEW`.

La autenticación IQ funcionó. La consulta del depósito encontró un registro en estado `Conciliado` y `En Operacion`, pero no indicó `rep === true` y tampoco indicó `can_request_rep === true`. Es una diferencia respecto del contrato previsto. El adaptador se detuvo antes de GET del REP, descarga o POST de generación. **No se comprobó si existe un REP adjunto**; no debe afirmarse que falta ni que está disponible. No se guardaron documentos ni se marcó `RECEIVED` o `PENDING` en el seguimiento. La orden terminó `STOPPED`, sin reintento automático. Las métricas posteriores continuaron en 60/5/0/5/0; una segunda lectura local confirmó que las otras tres candidatas conservan `PENDING_PROVIDER_CONTRACT` y `AP1C6U1E2` sigue esperando aplicación IQ.

La siguiente decisión requiere entender el significado de `can_request_rep` ausente/falso para este depósito y acordar una regla de lectura segura. No repetir este canario ni ampliar la cohorte con una inferencia sobre ese campo.
