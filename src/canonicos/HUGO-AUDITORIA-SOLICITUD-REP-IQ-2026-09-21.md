# Auditoría local de solicitudes de REP IQ

Fecha: 2026-09-21. Lectura productiva de Firestore con `audit-operational-followup.cjs --hugo-request-evidence`; cero llamadas a IQ, cero POST C y cero escrituras productivas. Esta auditoría no autoriza el canario C.

## Evidencia por aplicación

| Aplicación | Evidencia de aplicación IQ | Job/clave por root-perfil-depósito | Intento/respuesta C/resultado incierto | Clasificación local |
| --- | --- | --- | --- | --- |
| AP1C4U1E6 | Aplicada; anterior a `activatedAt` | No hay job; seguimiento sin `automationJobId` | `externalRequestSent=false`, sin `requestedAt`, sin pedido Hugo; cero actividad de envío | `REP_ATTACHMENT_NOT_AVAILABLE` + `REP_REQUEST_NOT_SENT_BY_PAY0` |
| AP2C4U1E6 | Aplicada; anterior a `activatedAt` | No hay job; seguimiento sin `automationJobId` | Igual; no se ha consultado el recurso REP para este caso | `REP_REQUEST_NOT_SENT_BY_PAY0`; disponibilidad de adjunto no comprobada |
| AP3C4U1E6 | Aplicada; anterior a `activatedAt` | No hay job; seguimiento sin `automationJobId` | Igual; no se ha consultado el recurso REP para este caso | `REP_REQUEST_NOT_SENT_BY_PAY0`; disponibilidad de adjunto no comprobada |
| AP4C4U1E6 | Aplicada; anterior a `activatedAt` | No hay job; seguimiento sin `automationJobId` | Igual; no se ha consultado el recurso REP para este caso | `REP_REQUEST_NOT_SENT_BY_PAY0`; disponibilidad de adjunto no comprobada |

Universo leído: 16 seguimientos, **0** `paymentComplementJobs` del root y 4,527 eventos `activityLog` del root. Cada candidata tenía un evento enlazado de seguimiento y ninguno de envío; no había reservas `REQUEST` en `paymentComplementQuotas`. Los ID determinísticos esperados de job se comprobaron individualmente sin exponer perfil ni depósito. No hay `SENDING`, `UNKNOWN`, `attemptedAt`, `requestedAt` ni respuesta IQ de C para estas candidatas. El experimento B de AP1C4U1E6 sí obtuvo el `400` exacto de **adjunto no disponible**; ese hecho no se extrapola a las otras tres.

La clasificación `REP_REQUEST_NOT_SENT_BY_PAY0` es una **conclusión local acotada**: el código actual crea un job antes de cualquier POST, la activación prospectiva excluía las cuatro aplicaciones, los seguimientos actuales carecen de vínculo/envío y no existe una ruta de borrado de jobs en el repositorio. No constituye prueba de que nadie solicitara un REP por otra interfaz de IQ, de que registros históricos no fueran borrados fuera del código, ni de que IQ nunca generara uno. Si cualquiera de esas condiciones no puede verificarse antes de C, usar `REP_REQUEST_STATE_UNKNOWN` y bloquear un POST.

## Capacidad C existente y sus límites

`complementProviders.requestIqComplement` ejecuta `POST /deposits/{depositId}/complement` sin cuerpo. Solo acepta `HTTP 200` con `{message:"success"}`. La sesión exige permisos IQ `deposits/complement:view` y `create`; las compuertas `REQUEST` incluyen Master, flujo `automation.aplicacionPagos`, configuración y cuota C, root, cliente, actor y perfil. El job prospectivo exige aplicación PPD `IQ_APPLIED`, plan e intento del mismo root/perfil, depósito numérico y fuente fiscal coherente. `preflightIqComplement` también exige depósito `Conciliado`, `En Operacion`, `rep !== true` y `can_request_rep === true`; **el significado contractual de esos dos últimos campos no está demostrado**, y el primer canario observó que no eran `true`. C no está lista para ese depósito con la política vigente.

La clave local actual es SHA-256 de `rootId:IQ:profileId:depositId`; evita dos jobs simultáneos del mismo perfil/depósito. El job pasa a `SENDING` **antes** del POST; si ocurre timeout o error posterior, pasa a `UNKNOWN` y no se reenvía automáticamente. Tras aceptación explícita, `requestedAt` y `externalRequestSent=true` se propagan al seguimiento. La respuesta IQ de una solicitud previa no existe aquí porque no hubo job ni intento registrado. El código contempla un nuevo login y segundo POST tras `401`; esa decisión y la ausencia de una clave de idempotencia aceptada por IQ necesitan revisión antes de cualquier canario histórico C. Una variación de perfil cambia la clave local y podría crear otro job para el mismo depósito. Por tanto, el mecanismo actual **reduce duplicados locales pero no demuestra que repetir C no pueda producirlos en IQ**.

## Evidencia requerida por transición futura

| Estado | Prueba exigida |
| --- | --- |
| `NOT_REQUESTED` | Auditoría acotada de seguimiento, jobs por depósito sin importar perfil, actividad, activación y exclusión de resultados inciertos; registrar snapshot/fingerprint antes de actuar. |
| `SENDING` | Claim transaccional persistente por root/depósito, actor/perfil/permiso/cuota, fecha y un solo intento de POST. |
| `REQUESTED` | HTTP y cuerpo de aceptación explícita, `requestedAt`, `externalRequestSent`, job/seguimiento vinculados. No equivale a REP generado. |
| `ATTACHMENT_PENDING` | Solicitud aceptada o incierta registrada **y**, separadamente, GET específico con 400 exacto sin adjunto; programar nueva lectura B, sin segundo POST. |
| `ATTACHMENT_AVAILABLE` | GET específico 200 con URL, sin inferir validez fiscal. |
| `VALIDATED` | ZIP y XML/PDF correctos, UUID/parcialidad/importes/saldos/moneda, hashes y vínculos releídos; solo entonces `RECEIVED`. |
| `REQUEST_STATE_UNKNOWN` | Job o log `SENDING`/`UNKNOWN`, ausencia de respuesta definitiva, posible solicitud externa o historial incompleto; no repetir C. |

Antes del primer canario C: definir una clave durable por **root y depósito** que sobreviva cambios de perfil; comprobar de nuevo todo el historial local y el adjunto B; retirar/revisar el replay tras `401`; exigir una forma verificable de saber si IQ ya recibió una solicitud o una garantía documentada de idempotencia del endpoint; y resolver con evidencia la precondición actual `can_request_rep`. El `400` de B por sí solo nunca concede C. No se implementó ni se ejecutó C en esta auditoría.
