# Sentinel: infraestructura privada y verificación efectiva

2026-10-09: observador privado pay0-sentinel-observer-00001-kwj Ready/tráfico100% en proyecto aislado pay0-sentinel-observe. DBnamed sentinel-observation, deny-all cliente, TTL4colecciones y exclusión índices evidencia creados. Runtime sin permisos financieros; canario financiero privado00001-fmm sigue DISABLED. Topic/subscription/DLQ y sink pay0-sentinel-observe-v1 creados; sink DISABLED, sin emisiones todavía.

Presupuesto mensual300MXN creado para únicamente projects/756518473677, sin créditos, umbrales reales50/90/100 y forecast100. Destinatarios IAM predeterminados de facturación, sin mensajes de prueba ni canal inventado. Es alerta, no límite duro; no incluye canario/Logging en proyecto financiero. Min0/máximo1 a nivel servicio y revisión; costos y cuotas documentados en SENTINEL-COST-CONTROLS.md.

IAM verificado: observer Firestore financiero403 yStorage403; DBnamed Begin/Rollback200. Default aislada no existe, RPC404 no acredita denegación; PolicyTroubleshooter modela cuatropermisos defaultDENIED/namedGRANTED. Canario tokenruntime600s: Firestorefinanciero403,DBnamed403,Storage403 y POST autenticado503/PUBLISHER_DISABLED. Bindings temporales de ambos verificadores retirados y ausencia comprobada. IDtoken de canario conserva validez criptográfica hasta1h sin guardarse; invoker retirado.

Pub/Sub service agent recibe SOLO roles/iam.serviceAccountOpenIdTokenCreator sobre SA push; push solo run.invoker del observer. Sinkwriter solo pubsub.publisher del topic. Sin roles financieros, Secret Manager ni credenciales de proveedores asignados al runtime.

## Recuperación del apply

Plan inicial16altas/1update de título, sin bajas, creó observador/presupuesto/transporte. Falló únicamente grant del sink: identidad Logging no disponible para IAM. Refresh residual confirmó uncreatependiente. Diagnóstico projects/-403 yproject404 no probaba existencia. Se agregó provisión explícita google_workload_identity_service_agent para productor logging.googleapis.com del proyecto origen, sin asignar automáticamente roles devueltos. Provider7.46.1 admite recurso pero no deletion_policy: protección lifecycle.prevent_destroy.

Primer intento de provisión indicó Workload Identity API deshabilitada, sin crear identidad. Se declaró google_project_service.source_workload_identity, disable_on_destroy=false, y dependencia explícita. Plan nuevo3altas/0cambios/0bajas; apply PASS: API, identidad administrada y grant publisher. Sink permaneció apagado todo el proceso. No se eludió IAM ni se usó rol amplio.

Dos replanes fallidos son errores de herramienta/configuración, no infraestructura omitida: PowerShell serializó lista de origen como objeto (corregido con ConvertTo-Json -InputObject); deletion_policy no admitido (corregido lifecycle). Estados, planes y logs privados ignorados conservan evidencia. La creación del service agent se audita en IaC; su provider Read no certifica existencia, por lo que el grant efectivo aporta comprobación adicional.

## Pendiente

Prueba CANARY_DRY_RUN privada, luego revisión exacta en allowlist y synthetic E2E de Logging/PubSub/observer/Firestore con un evento y replay. HTTP200 del publisher por sí solo no demuestra persistencia. No activar productores financieros ni contención; ningún writer de restricciones exportado. Verificar estado aplicado, revisar métricas/budget y apagar solo sink/canary de prueba al concluir la ventana.
