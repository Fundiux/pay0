# Sentinel: infraestructura privada y verificación efectiva

2026-10-09, estado actualizado comunicado por integracion: observer privado pay0-sentinel-observer-00003-br8 con trafico100%. Ventana sintetica cerrada mediante root apply PASS: canary00004-tjn Ready, modo DISABLED y sinkdisabled:true confirmados en estado Terraform. E2E NO PASS: dos POST CANARY aceptados no produjeron receipt ni incidente verificable. Runtime permanece OBSERVE_ONLY, sin autoridad financiera ni writer de restricciones activado.

El proyecto aislado pay0-sentinel-observe conserva DBnamed sentinel-observation, deny-all cliente, TTL de4colecciones, indices de evidencia y transporte topic/subscription/DLQ/sink pay0-sentinel-observe-v1. La infraestructura desplegada no demuestra procesamiento exitoso de eventos.

Presupuesto mensual300MXN creado para únicamente projects/756518473677, sin créditos, umbrales reales50/90/100 y forecast100. Destinatarios IAM predeterminados de facturación, sin mensajes de prueba ni canal inventado. Es alerta, no límite duro; no incluye canario/Logging en proyecto financiero. Min0/máximo1 a nivel servicio y revisión; costos y cuotas documentados en SENTINEL-COST-CONTROLS.md.

IAM verificado: observer Firestore financiero403 yStorage403; DBnamed Begin/Rollback200. Default aislada no existe, RPC404 no acredita denegación; PolicyTroubleshooter modela cuatropermisos defaultDENIED/namedGRANTED. Canario tokenruntime600s: Firestorefinanciero403,DBnamed403,Storage403 y POST autenticado503/PUBLISHER_DISABLED. Bindings temporales de ambos verificadores retirados y ausencia comprobada. IDtoken de canario conserva validez criptográfica hasta1h sin guardarse; invoker retirado.

Pub/Sub service agent recibe SOLO roles/iam.serviceAccountOpenIdTokenCreator sobre SA push; push solo run.invoker del observer. Sinkwriter solo pubsub.publisher del topic. Sin roles financieros, Secret Manager ni credenciales de proveedores asignados al runtime.

## Recuperación del apply

Plan inicial16altas/1update de título, sin bajas, creó observador/presupuesto/transporte. Falló únicamente grant del sink: identidad Logging no disponible para IAM. Refresh residual confirmó uncreatependiente. Diagnóstico projects/-403 yproject404 no probaba existencia. Se agregó provisión explícita google_workload_identity_service_agent para productor logging.googleapis.com del proyecto origen, sin asignar automáticamente roles devueltos. Provider7.46.1 admite recurso pero no deletion_policy: protección lifecycle.prevent_destroy.

Primer intento de provisión indicó Workload Identity API deshabilitada, sin crear identidad. Se declaró google_project_service.source_workload_identity, disable_on_destroy=false, y dependencia explícita. Plan nuevo3altas/0cambios/0bajas; apply PASS: API, identidad administrada y grant publisher. Sink permaneció apagado todo el proceso. No se eludió IAM ni se usó rol amplio.

Dos replanes fallidos son errores de herramienta/configuración, no infraestructura omitida: PowerShell serializó lista de origen como objeto (corregido con ConvertTo-Json -InputObject); deletion_policy no admitido (corregido lifecycle). Estados, planes y logs privados ignorados conservan evidencia. La creación del service agent se audita en IaC; su provider Read no certifica existencia, por lo que el grant efectivo aporta comprobación adicional.

## Ventana sintetica ejecutada: E2E fallido

- DRY_RUN revision00002-9fs: POST200 y cleanupPASS. Esto verifica respuesta del productor privado, no persistencia.
- CANARY revision00003-n27: dos POST200 y cleanupPASS. No se atribuye procesamiento exitoso a esos codigos HTTP.
- Observer revision00003-br8, trafico100%: una entrega observada termino HTTP204 con INVALID_ENVELOPE. Esa respuesta no acredita un incidente procesado.
- Verificador: seis pares consultados devolvieron404 para receipt/incidente; ninguna persistencia verificada. No hubo E2E satisfactorio ni prueba de replay/idempotencia completada.
- Cierre: root applyPASS; sinkdisabled:true y canary00004-tjn Ready/DISABLED confirmados. La ventana esta cerrada, no abierta ni pendiente de apagar.

Los resultados fueron reportados por integracion. Este cambio es documental: no repite POST, consultas cloud o aplicacion Terraform. Las pruebas sinteticas no ejecutaron efectos financieros ni activaron contencion.

## Diagnostico y siguientes gates

Se investigan los aliases oficiales del envelope Pub/Sub message_id/publish_time frente a los nombres esperados por el parser. Un agente independiente prepara la correccion. Es hipotesis de causa y trabajo en curso: no afirmar que ya quedo resuelto ni que se desplego. Mantener evidencia del INVALID_ENVELOPE y los404sin reinterpretarlos como ausencia esperada exitosa.

Primero revisar contrato/parser y pruebas con el envelope oficial; despues build y despliegue acotado de la revision corregida, y solo entonces una nueva ventana sintetica explicitamente controlada con evento+replay. Exigir receipt/incidente persistidos e idempotencia, no solo HTTP200/204. Volver a cerrar sink/canary y comprobar estado al terminar. No activar productores financieros ni contencion; writers de restricciones siguen sin exportarse.
