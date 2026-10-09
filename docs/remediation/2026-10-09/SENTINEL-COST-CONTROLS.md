# Sentinel: presupuesto y controles de coste

Fecha: 2026-10-09. Alcance: proyecto aislado `pay0-sentinel-observe` (756518473677). Fuente financiera: `pay-0-system`. Este lote prepara configuracion revisable: no ejecuta plan/apply, no crea alertas, no envia pruebas de correo ni modifica IAM. El responsable de integracion mantiene el canary en DISABLED y el sink desactivado hasta completar sus gates.

## Evidencia de solo lectura

Consultas REST autenticadas con token en memoria; salida reducida sin billing ID, correos ni respuestas crudas:

| Consulta | Resultado |
| --- | --- |
| Vinculo de facturacion del proyecto | Habilitado |
| Metadatos de cuenta | Cuenta abierta, moneda MXN |
| Inventario de presupuestos | HTTP 403, PERMISSION_DENIED, SERVICE_DISABLED |
| Canales Monitoring del proyecto aislado | 0; ningun tipo |
| Tipos de cuotas Cloud Run | 28 metricas |
| Tipos de cuotas Pub/Sub | 11 metricas |
| Tipos de cuotas Firestore | 16 metricas |

El numero de presupuestos existentes es **desconocido**. SERVICE_DISABLED no demuestra ausencia de presupuestos ni un rechazo de permisos de facturacion. Los conteos de cuotas tampoco prueban limites personalizados: se consulto el catalogo BASIC, no se modifico ninguna cuota. No se consultaron costes acumulados ni se identificaron destinatarios individuales.

## Propuesta revisable

`services/pay0-sentinel-observation/infra/budget.tf` propone 300 MXN mensuales para el piloto, solo proyecto 756518473677, todos sus servicios, sin descontar creditos. Umbrales actuales 50/90/100% (150/270/300 MXN) y previsional 100%. Es un importe inicial de vigilancia elegido para un piloto reducido, **no una estimacion de factura ni garantia de suficiencia**; revisar con gasto real tras el primer periodo observado. No incluye el coste del canary, Logging u otros componentes facturados al proyecto financiero.

La variable `enable_observation_budget` queda false por defecto. El responsable puede incluirla en su plan revisado sin otra pregunta rutinaria de presupuesto; no se vincula automaticamente a `activate_sink`. La API opcional y el presupuesto usan el alias `google.observation_budget`, cuyo quota project es el aislado; esta propuesta no habilita Billing Budgets API en el proyecto financiero. Tras habilitar la API autorizadamente, repetir inventario antes de crear y adoptar/importar un presupuesto equivalente si ya existe. Requiere permisos de presupuesto en la cuenta y Service Usage del proyecto aislado; el alias no concede permisos.

El destino propuesto es el grupo de destinatarios IAM predeterminado de la plataforma: **Billing Account Administrators y Billing Account Users**, no solamente administradores. Se omite `all_updates_rule` para conservar esos destinatarios predeterminados; el provider exige canal o topic cuando se declara ese bloque. No se inventan emails ni se activan destinatarios Owner del proyecto. Puede incluir personas fuera del equipo del proyecto. No se realizo envio de prueba. Campos contrastados con [provider Google 7.46.1](https://raw.githubusercontent.com/hashicorp/terraform-provider-google/v7.46.1/website/docs/r/billing_budget.html.markdown).

Este recurso es un presupuesto de alertas: no detiene gasto. Las notificaciones permiten detectar desviaciones, no sustituyen cuotas ni un interruptor operativo. [Google: presupuestos](https://docs.cloud.google.com/billing/docs/how-to/budgets).

La documentacion actual tambien ofrece presupuestos con spend cap para determinadas combinaciones de un proyecto y un servicio (incluido Cloud Run). Su ejecucion no es instantanea y no elimina costes persistentes; no cubre conjuntamente Firestore y Pub/Sub. No se configura esa modalidad en este lote. [Google: spend caps](https://docs.cloud.google.com/billing/docs/how-to/budgets-spend-caps).

## Controles observados en codigo

| Capa / fuente | Limite | Alcance y coste residual |
| --- | --- | --- |
| `infra/main.tf`, observer | min 0, max 1 por revision y ahora servicio; 1 CPU, 256 MiB, concurrencia 4, timeout 10 s, CPU idle | Reduce capacidad; no limita facturacion total |
| `src/config.mjs`, `src/persistence.mjs` | Admision transaccional 60/min y 10000/dia; maxAttempts 3 | Limita eventos nuevos aceptados; rechazos y reintentos aun consumen lecturas/ejecucion |
| `src/http.mjs` | 4 en vuelo, 120 intentos/min locales, timeout aplicacion 7 s | Contadores por proceso; reinicios/revisiones no forman cuota global |
| `src/config.mjs` | Envelope 16 KiB; log 8 KiB | Acota cada entrada; no numero de solicitudes externas |
| `infra/main.tf`, Pub/Sub | Retencion 1 dia, retry 10..600 s, DLQ configurada en 5 entregas | No tratar el numero de entregas como techo monetario exacto |
| Persistencia/TTL | Cuotas/receipts 48 h; incidentes 7 dias | TTL es limpieza diferida, no borrado inmediato ni gratuito |
| `infra/canary.tf` | DISABLED por defecto, min 0/max 1, concurrencia 1, timeout 5 s | Su coste pertenece a `pay-0-system`, fuera del presupuesto aislado |
| `src/main.mjs` | Metricas por codigos fijos agregadas cada minuto | Evita registrar payload/identificadores; volumen de logs sigue facturable |

La ruta de un evento nuevo usa una base de 5 lecturas y 5 escrituras, incluyendo admision. En 31 dias, el maximo configurado de aceptaciones es 310000 eventos: 1.55 millones de lecturas y 1.55 millones de escrituras base. Esto es un calculo de volumen, no una cotizacion: excluye transacciones reintentadas, duplicados, invalidos, lecturas de cuotas agotadas y borrados TTL. Una base Firestore con nombre no obtiene la cuota gratuita de la base predeterminada; los TTL deletes son facturables. [Google: Firestore pricing](https://cloud.google.com/firestore/pricing?hl=en).

Faltan politicas de limpieza explicitas para imagenes Artifact Registry y objetos de builds en las configuraciones revisadas; su almacenamiento puede crecer aun con el sink apagado. No se inspecciono remotamente la retencion efectiva de Logging. Proponer cleanup con conservacion de digests desplegados, no borrar artefactos en este lote.

## Dos inferencias delimitadas

1. **Escalado:** agregar `scaling.max_instance_count=1` al servicio limita el crecimiento entre revisiones mejor que solo el limite del template. No es un limite monetario duro: Google documenta posibles excesos temporales. Cambio de fuente preparado, no evidencia de aplicacion remota. [Google: max instances](https://docs.cloud.google.com/run/docs/configuring/max-instances).
2. **IAM push:** Pub/Sub necesita `iam.serviceAccounts.getOpenIdToken`; `roles/iam.serviceAccountOpenIdTokenCreator` contiene ese permiso. Por ello el rol estrecho parece suficiente para este flujo OIDC, pero esa compatibilidad se infiere de los permisos, no de una prueba push end-to-end. Se conserva `roles/iam.serviceAccountTokenCreator` actual. Un cambio posterior requiere revisar IAM efectivo y probar entrega autentica sintetica antes de retirar el rol amplio. [Google: authenticated push](https://docs.cloud.google.com/pubsub/docs/authenticate-push-subscriptions), [Google: service account roles](https://docs.cloud.google.com/iam/docs/service-account-permissions).

## Observabilidad y respuesta propuestas

Antes de activar el sink: presupuesto inventariado/aplicado por el responsable, destinatarios predeterminados explicitados, observer privado y allowlist de revision revisada. La revision canary indicada por integracion es `00001-fmm`; este lote no emitio eventos para comprobarla.

Crear posteriormente alertas sobre backlog/edad del mensaje mas antiguo y DLQ, errores 5xx/latencia del observer, saturacion de instancias, operaciones Firestore y outcomes QUOTA/BUSY/STORE_UNAVAILABLE/CIRCUIT_OPEN/TIMEOUT. Usar solo metricas agregadas, sin IDs de actores ni contenido de evidencia. No hay canales existentes que esta revision pueda reutilizar automaticamente.

Ante desvio: desactivar el sink de observacion y mantener canary DISABLED; revisar backlog, reintentos, retencion y objetos acumulados. No deshabilitar facturacion del proyecto financiero como automatismo de control de coste. Mantener separado cualquier mecanismo futuro de spend cap de las funciones financieras.

## Cambios y verificacion

- `infra/main.tf`: maximo de una instancia a nivel servicio y API `policytroubleshooter.googleapis.com` en conjunto gestionado. El responsable informo que esta API ya fue habilitada y verifico acceso del runtime a la base con nombre; no se repitieron operaciones remotas.
- `infra/budget.tf`: propuesta opt-in descrita arriba; sin recursos de correo nuevos ni publicacion Pub/Sub de presupuestos.
- Verificacion local PASS: `terraform fmt -check main.tf budget.tf`, `terraform validate -no-color` (configuracion completa) y `git diff --check`. No plan/apply, cambios de estado Terraform, builds globales, emisiones ni invocaciones financieras. La revision del plan completo y la activacion siguen a cargo de integracion.
