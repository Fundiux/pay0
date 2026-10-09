# Revisión del despliegue canario — 2026-10-09

Resultado: fuente apta para revisión central y despliegue **DISABLED**, con plan nuevo. No autoriza activar el sink ni CANARY. Publisher comparado con `e643f3f`: sin cambios en el helper ni runtime. No se ejecutó despliegue, emisión, mint ni cambio IAM desde esta revisión.

## Fuente y plan

`services/pay0-sentinel-observation/infra/canary.tf` crea cinco recursos: SA dedicada en `pay-0-system`, rol personalizado con únicamente `logging.logEntries.create`, binding de ese rol, permiso de lectura del repositorio de imágenes para el **service agent de Cloud Run** del proyecto origen y servicio privado por IAM. Imagen fijada por digest; sin claves nuevas ni imports financieros/Admin SDK.

El plan anterior contenía cinco altas, modo DISABLED e IAM de invocación habilitado. Se añadió `scaling.max_instance_count = 1` al **servicio**, además del límite existente por revisión. El plan anterior queda **obsoleto**. `terraform fmt -check -no-color canary.tf` y `terraform validate -no-color` pasaron con `.terraform/verified-cli/terraform.exe`, usando `-chdir=services/pay0-sentinel-observation/infra`.

Configuración: mínimo cero, máximo uno, concurrencia uno, CPU 1, memoria 256 MiB, timeout 5 s. El máximo por servicio evita que varias revisiones multipliquen el límite configurado; Cloud Run advierte que puede excederse temporalmente, por lo que no constituye un límite monetario estricto. [Documentación oficial](https://docs.cloud.google.com/run/docs/configuring/max-instances).

## Límites y falsificación

DISABLED evita metadata, token y Logging desde el helper. No revoca el permiso de escritura que recibe la SA. El endpoint solamente admite POST vacío y genera root/actor sintéticos fijos; no acepta observaciones de clientes. Tiene un presupuesto compartido de 3 s para metadata y Logging, sin reintento automático ni registros de tokens/respuestas.

La cuota de seis intentos/minuto y veinte por proceso se reinicia con instancias/revisiones. No es una cuota global. El Terraform no añade invocadores públicos, pero deben revisarse permisos heredados antes de afirmar quién puede invocar. La autenticación depende de Cloud Run, no de un verificador JWT propio.

`logging.logEntries.create` es permiso sobre el proyecto: un principal que lo posea puede fabricar logName, labels y payload semejantes. La allowlist de servicio/revisión/root/actor filtra entradas, pero **no demuestra criptográficamente su productor**. Conservar esta limitación en la evaluación de amenazas; no usar las observaciones para decisiones financieras. No introducir pruebas de falsificación que generen falsas alertas financieras reales.

## Pruebas y transición propuestas

No ejecutadas en esta revisión:

1. Tras DISABLED, verificar invocación anónima, audiencia incorrecta y principal sin permiso: denegación en plataforma. Invocador autorizado: POST vacío devuelve 503/DISABLED; cuerpo, query y Origin no generan observaciones. Health no acredita IAM.
2. Con identidad canario, comprobar denegaciones de lecturas sintéticas inexistentes en Firestore financiero y DB nombrada del observador, BeginTransaction en esta última y Storage financiero. Esperar 403; 404 es inconcluso. No leer documentos reales ni escribir datos.
3. `testIamPermissions` en SAs observer/push: no `getAccessToken`, `getOpenIdToken` ni `signBlob`; en topic: no `pubsub.topics.publish`. No publicar ni acceder a secretos para probarlo. Cualquier mint temporal requiere revisión central y retirada verificada como en el protocolo existente.
4. CANARY_DRY_RUN verifica aceptación de Logging sin exportar. CANARY crea otra revisión: leer esa revisión real y ajustar exactamente allowlist/filtro antes de activar el sink. No reutilizar el identificador de revisión de DISABLED/DRY_RUN.
5. Ventana manual propuesta de 30 minutos: una emisión fija y una repetición para comprobar deduplicación; después DISABLED y sink apagado. Son controles operativos propuestos, no automatismos ya desplegados. Verificar el resultado persistido y ausencia de efectos financieros.

## Evidencia IAM del observador y default ausente

Resultado comunicado por ejecución central del verificador: mint 200; Firestore financiero 403; `(default)` aislada 404; documento sintético en DB nombrada 404; Storage financiero 403; BeginTransaction 200/Rollback 200; retirada `REMOVED_VERIFIED`.

Lectura independiente `gcloud firestore databases list --project=pay0-sentinel-observe` mostró solamente `sentinel-observation` (Firestore Native, us-central1). No existe `(default)`. La policy del proyecto, filtrada al miembro observer, contiene solamente `sentinelObservationWriter` con condición:

```text
resource.name == 'projects/pay0-sentinel-observe/databases/sentinel-observation'
```

Esto explica plausiblemente el 404 por inexistencia, **no prueba denegación**. La consulta de bindings directos tampoco certifica todos los permisos heredados. El script conserva expected 403 para default y la matriz completa **no pasa**. No se creó otra DB para cambiar el resultado.

## Alternativa Policy Troubleshooter, pendiente

La API no estaba habilitada en el proyecto de cuota consultado `pay-0-system`; no se habilitó. La API oficial admite contexto explícito `resource.name/service/type`, y la CLI muestra evaluación de políticas de proyecto con contexto de recurso. Por analogía, se propone modelar la condición para default inexistente, usando el proyecto existente como recurso de consulta. Es una inferencia que necesita ejecución, no evidencia obtenida. [API v3](https://docs.cloud.google.com/policy-intelligence/docs/reference/policytroubleshooter/rest/v3/iam/troubleshoot), [CLI oficial](https://docs.cloud.google.com/sdk/gcloud/reference/policy-intelligence/troubleshoot-policy/iam).

Tupla propuesta: principal `pay0-sentinel-observer@pay0-sentinel-observe.iam.gserviceaccount.com`; fullResourceName `//cloudresourcemanager.googleapis.com/projects/pay0-sentinel-observe`; permiso `datastore.entities.get`; contexto service `firestore.googleapis.com`, type `firestore.googleapis.com/Database`, name alternando `projects/pay0-sentinel-observe/databases/(default)` y `projects/pay0-sentinel-observe/databases/sentinel-observation`. Repetir, como máximo ocho consultas en total, para `datastore.entities.create`, `datastore.entities.update` y `datastore.databases.get`.

Revisar explicación de bindings y estado global: se espera condición falsa para default y verdadera para named si no intervienen otros permisos. UNKNOWN/contexto incompleto no es PASS. Incluso DENIED sería evidencia **modelada**, no una denegación HTTP observada. Root decidirá habilitación mínima y proyecto de cuota; no se certificó una tarifa gratuita de Troubleshooter.

## Presupuesto mínimo propuesto

Presupuesto del proyecto aislado, todos los servicios, importe y moneda aprobados por el responsable de facturación; umbrales reales 50/90/100% y previsión 100%. Seleccionar un canal existente y responsable confirmado antes de crear alertas: no hay destinatario inventado. El presupuesto es una alerta, no un corte automático. [Documentación oficial](https://docs.cloud.google.com/billing/docs/how-to/budgets).

El canario y su Logging facturan en `pay-0-system`, fuera de ese presupuesto aislado. Vigilar aparte solicitudes/bytes durante la ventana; no asumir que labels atribuyen todo el coste de Logging. No automatizar deshabilitación de facturación del proyecto financiero. Persisten costes de imágenes, builds, logs y posibles excesos transitorios aun con min cero/max uno.
