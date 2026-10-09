# Sentinel: infraestructura privada y verificación efectiva

2026-10-09, estado actualizado comunicado por integracion: **E2E sintetico PASS** tras corregir aliases Pub/Sub. Observer privado `pay0-sentinel-observer-00005-dgr`: dos entregas HTTP200, metricas RECORDED=1 y DUPLICATE=1. GET exactos receipt200/incidente200; verificador OBSERVE_ONLY_SINGLE_EVENT_VERIFIED, eventCount=1, authority=NONE y TTL valido. Ventana cerrada mediante root apply PASS: canary `00006-6wv` Ready/DISABLED y sinkdisabled:true confirmados en estado Terraform. Runtime permanece OBSERVE_ONLY, sin autoridad financiera ni writer de restricciones activado. El primer intento fallido se conserva abajo como antecedente.

El proyecto aislado pay0-sentinel-observe conserva DBnamed sentinel-observation, deny-all cliente, TTL de4colecciones, indices de evidencia y transporte topic/subscription/DLQ/sink pay0-sentinel-observe-v1. El E2E acredita el evento sintetico fijo y su replay; no certifica cobertura de productores financieros ni contencion.

Presupuesto mensual300MXN creado para únicamente projects/756518473677, sin créditos, umbrales reales50/90/100 y forecast100. Destinatarios IAM predeterminados de facturación, sin mensajes de prueba ni canal inventado. Es alerta, no límite duro; no incluye canario/Logging en proyecto financiero. Min0/máximo1 a nivel servicio y revisión; costos y cuotas documentados en SENTINEL-COST-CONTROLS.md.

IAM verificado: observer Firestore financiero403 yStorage403; DBnamed Begin/Rollback200. Default aislada no existe, RPC404 no acredita denegación; PolicyTroubleshooter modela cuatropermisos defaultDENIED/namedGRANTED. Canario tokenruntime600s: Firestorefinanciero403,DBnamed403,Storage403 y POST autenticado503/PUBLISHER_DISABLED. Bindings temporales de ambos verificadores retirados y ausencia comprobada. IDtoken de canario conserva validez criptográfica hasta1h sin guardarse; invoker retirado.

Pub/Sub service agent recibe SOLO roles/iam.serviceAccountOpenIdTokenCreator sobre SA push; push solo run.invoker del observer. Sinkwriter solo pubsub.publisher del topic. Sin roles financieros, Secret Manager ni credenciales de proveedores asignados al runtime.

## Recuperación del apply

Plan inicial16altas/1update de título, sin bajas, creó observador/presupuesto/transporte. Falló únicamente grant del sink: identidad Logging no disponible para IAM. Refresh residual confirmó uncreatependiente. Diagnóstico projects/-403 yproject404 no probaba existencia. Se agregó provisión explícita google_workload_identity_service_agent para productor logging.googleapis.com del proyecto origen, sin asignar automáticamente roles devueltos. Provider7.46.1 admite recurso pero no deletion_policy: protección lifecycle.prevent_destroy.

Primer intento de provisión indicó Workload Identity API deshabilitada, sin crear identidad. Se declaró google_project_service.source_workload_identity, disable_on_destroy=false, y dependencia explícita. Plan nuevo3altas/0cambios/0bajas; apply PASS: API, identidad administrada y grant publisher. Sink permaneció apagado todo el proceso. No se eludió IAM ni se usó rol amplio.

Dos replanes fallidos son errores de herramienta/configuración, no infraestructura omitida: PowerShell serializó lista de origen como objeto (corregido con ConvertTo-Json -InputObject); deletion_policy no admitido (corregido lifecycle). Estados, planes y logs privados ignorados conservan evidencia. La creación del service agent se audita en IaC; su provider Read no certifica existencia, por lo que el grant efectivo aporta comprobación adicional.

## Primera ventana sintetica: antecedente fallido

- DRY_RUN revision00002-9fs: POST200 y cleanupPASS. Esto verifica respuesta del productor privado, no persistencia.
- CANARY revision00003-n27: dos POST200 y cleanupPASS. No se atribuye procesamiento exitoso a esos codigos HTTP.
- Observer revision00003-br8, trafico100%: una entrega observada termino HTTP204 con INVALID_ENVELOPE. Esa respuesta no acredita un incidente procesado.
- Verificador: seis pares consultados devolvieron404 para receipt/incidente; ninguna persistencia verificada en esa primera ventana. No hubo entonces E2E satisfactorio ni prueba de replay/idempotencia completada.
- Cierre de la primera ventana: root applyPASS; sinkdisabled:true y canary00004-tjn Ready/DISABLED confirmados entonces. Esa ventana quedo cerrada antes de la correccion.

Los resultados fueron reportados por integracion. Este cambio es documental: no repite POST, consultas cloud o aplicacion Terraform. Las pruebas sinteticas no ejecutaron efectos financieros ni activaron contencion.

## Correccion y segunda ventana: E2E PASS

La correccion `d911c55` admite los aliases oficiales message_id/publish_time, exigiendo igualdad exacta si tambien aparecen messageId/publishTime. El LogEntry sintetico inspeccionado no tenia campos extra incompatibles. Pasaron21tests (12servicio/9productor), build del core y staging de18archivos/80.4KiB. Cloud Build `2daebc49-c854-4798-b034-893b8005643b` termino SUCCESS; imagen observer `sha256:8968768dc71dd286d799944674b060abba5b7d47d4f244d50724fe7a70326977`, fuente `d911c55`.

- CANARY `00005-xgm`: dos POST200; ambos bindings temporales REMOVED_VERIFIED.
- Observer corregido `00005-dgr`: dos HTTP200 y metricas RECORDED=1/DUPLICATE=1, confirmando procesamiento y replay, no solo aceptacion por Logging.
- Lecturas exactas en la DB aislada: receipt200 e incidente200; OBSERVE_ONLY_SINGLE_EVENT_VERIFIED con eventCount=1, authority=NONE y TTL valido.
- Cierre applyPASS: sink apagado y canary `00006-6wv` Ready/DISABLED confirmados por estado Terraform. No hay ventana pendiente de apagar.

La segunda ventana satisface el gate E2E sintetico. No reinterpreta los204/404 iniciales como exito: aquellos mensajes fueron reconocidos sin persistencia. Siguientes lotes: definir e integrar productores backend reales bajo contratos revisados y mantener observacion sin autoridad financiera. No activar contencion ni exportar writers de restricciones por este resultado. La evidencia remota fue comunicada por integracion; esta actualizacion documental no repitio operaciones cloud.
