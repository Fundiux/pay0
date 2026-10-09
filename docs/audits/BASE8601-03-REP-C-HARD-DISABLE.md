# BASE8601-03 — REP C hard-disable

Fecha de certificación: 2026-09-27. Rama aislada:
`fix/base8601-03-rep-c-hard-disable`.

## Resultado

`REP_C_HARD_DISABLE_READY`

Este estado significa que el código y la configuración propuesta están listos
para aplicarse. Producción todavía no queda protegida hasta desplegar el código
y escribir explícitamente la configuración aprobada.

## A-E. Cambio mínimo

Antes del cambio, REQUEST aceptaba cualquier valor distinto de `false` para
`iqRequestEnabled`; por ello ausencia, `null` y tipos inválidos podían dejar C
potencialmente alcanzable.

La semántica nueva es estricta:

```text
paymentComplementConfigs/{rootId}.iqRequestEnabled === true
```

es el único valor que permite continuar evaluando los demás gates. `false`,
ausente, `undefined`, `null`, `"true"`, `1` o configuración inexistente
producen `REP_REQUEST_HARD_DISABLED`.

El resolver canónico es `isIqRepRequestHardEnabled` y la decisión se realiza en
`decide` dentro de `complementGates.ts`. `inspectIqComplementGate` y
`claimIqComplementGate` reutilizan esa decisión en automation, scheduler,
canario, sesión y cuotas. `Pay0Connector.getIqCapabilities` reutiliza el mismo
resolver para no anunciar una capacidad distinta.

La última barrera está en `complementProviders.requestIqComplement`: ejecuta
`requireGate(job, "REQUEST")` inmediatamente antes de construir/enviar
`fetch(..., { method: "POST" })`. Ningún caller que llegue accidentalmente al
provider omite el gate canónico.

Archivos modificados:

- `functions/src/modules/paymentApplications/complementGates.ts`
- `functions/src/modules/agent007/pay0Connector.ts`
- `qa/scripts/payment-complement-gates-emulator-smoke.cjs`
- `qa/scripts/payment-complement-automation-smoke.cjs`
- este informe

## F-H. Pruebas

`B_ENABLED_C_DISABLED`: PASS. Con `iqEnabled=true` e
`iqRequestEnabled=false`, B conservó consulta/seguimiento y C registró cero
POST.

| Caso | Resultado |
| --- | --- |
| `iqRequestEnabled=true` | supera este gate; adapter local controlado |
| `false` | `REP_REQUEST_HARD_DISABLED` |
| campo ausente | `REP_REQUEST_HARD_DISABLED` |
| `null` | `REP_REQUEST_HARD_DISABLED` |
| string `"true"` | `REP_REQUEST_HARD_DISABLED` |
| número `1` | `REP_REQUEST_HARD_DISABLED` |
| documento config inexistente | `REP_REQUEST_HARD_DISABLED` al evaluar REQUEST |
| Master IQ off | bloqueado |
| `automation.aplicacionPagos` off | bloqueado |
| `can_request_rep?=false` | bloqueado |
| elegibilidad no demostrada | bloqueado |
| cuota cero/agotada | bloqueado |
| resultado previo incierto | no reenvía |
| concurrencia | un solo claim/candidato |

Las suites reportaron `externalActions=0`/`externalNetworkCalls=0`. Los adapters
de IQ real permanecieron sustituidos; no se invocó IQ.

## I. `runHugoIqRepRequestCanary`

- Trigger: escritura Firestore en `hugoRepRequestCanaries/{canaryId}`; no es un
  callable y no recibe sesión Auth. Las reglas no exponen esa colección al
  cliente, por lo que el disparo práctico requiere backend/Admin con permiso de
  escritura.
- Autorización interna: ID fijo, documento `QUEUED` con capability REQUEST,
  folio y depósito fijos, evidencia previa B, fingerprint, aplicación IQ
  aplicada, historial sin solicitud, perfil, permisos IQ, gates LOOKUP/REQUEST,
  cuotas y claim transaccional.
- Antes del cambio podía alcanzar POST si toda esa evidencia y los switches lo
  permitían. Después del cambio atraviesa el mismo gate estricto varias veces y
  además el provider vuelve a verificarlo justo antes del POST.
- Utilidad productiva actual: canario puntual ya consumido. El job fijo existe,
  por lo que las barreras de identidad/estado impiden reutilizarlo como flujo
  general. No se eliminó.

## J. Intento histórico HTTP 422

Lectura productiva, sin reproceso ni llamada IQ:

- canario `iq-rep-request-ap1c4u1e6-220483-v1`;
- inició `2026-09-21T09:07:12.619Z`, reservó intento a
  `2026-09-21T09:07:17.499Z` y terminó a `2026-09-21T09:07:17.976Z`;
- entrypoint `runHugoIqRepRequestCanary`;
- actor persistido: UID root/superadmin
  `Ab4z0RttIqXbZFT0NuWsDjBkt6J2`;
- aplicación `AP1C4U1E6`, pago `P15C4U1E6`, solicitud `S39C4U1E6`, depósito
  `220483`;
- `profileId=bEGPMuplqNHMZ3lvYkeb`;
- job `5fb7dadc88f6d2e5ecefcf9ba8eb1c8874254d7442bc2608d0637d73fbb79aa5`;
- respuesta observada: HTTP 422, hash de cuerpo
  `29d14c28d41db9267a3577c0f8b834e86d4a99d2ed4d6a64db173e4cfc7f7950`;
- cuota REQUEST del 2026-09-21: `count=1`; sólo existe un `attemptedAt`, no hay
  `requestedAt` y no existe evidencia de retry/segundo POST;
- el job y follow-up están `RECEIVED`; la aplicación está `IMPORTED`;
- XML y PDF REP están `READY` y activos. Hubo importación del flujo legado el
  2026-09-22 y la asociación canónica quedó recibida el 2026-09-23;
- el estado incierto no puede reenviarse automáticamente: el intento durable,
  la identidad única por depósito y el estado `RECEIVED` lo impiden.

Clasificación: `HISTORICAL_REQUEST_TERMINAL`. El resultado original del POST
fue incierto, pero el REP apareció después por B y hoy está importado y
documentado; no corresponde reintentar C.

## K. Functions huérfanas

Ventana consultada: últimos 7/30 días al 2026-09-27. Los cuatro recursos fueron
desplegados el 2026-09-22, por lo que ambas ventanas contienen la misma vida
observable. No hubo logs `severity>=ERROR` en ninguno.

Durante esta auditoría se detectó deriva externa: el baseline de
`2026-09-27T13:49:21Z` mostraba las cuatro Functions activas; la consulta actual
posterior mostró que `enqueueIqPaymentComplements`,
`processIqPaymentComplementQueue` y
`requestIqPaymentComplementOnApplication`, junto con su scheduler/Eventarc y
servicios Cloud Run, ya no existen. Esta rama no ejecutó esas eliminaciones.

| Function | Trigger/IAM y uso 7/30 | Efectos/equivalente | Clasificación |
| --- | --- | --- | --- |
| `enqueueIqPaymentComplements` | callable HTTP; IAM Cloud Run sin bindings; auth interna sólo superadmin pagos/create; 0/0, sin última ejecución | Sólo encolaba `pagoAplicaciones`; sin caller en HEAD. Sustituido por `enqueueAutomaticPaymentComplement` y el modelo `paymentComplementJobs`. Ya ausente por cambio externo. | `SAFE_TO_RETIRE_CANDIDATE` |
| `processIqPaymentComplementQueue` | scheduler legado `0 19 * * 1-5`; IAM sin bindings; 8/8; última `2026-09-26T01:00:42.008863Z`, HTTP 200 | Ejecutaba B y podía hacer POST C directamente, sin los gates nuevos; equivalente funcional repartido entre `executeAutomaticPaymentComplement` y `checkPaymentComplementsDaily`. Ya ausente externamente. Retirarla puede dejar documentos `iqComplementStatus` legados sin consumidor. | `UNKNOWN_DO_NOT_TOUCH` hasta conciliar cola legada y autoría de la eliminación |
| `requestIqPaymentComplementOnApplication` | Eventarc sobre update de `pagoAplicaciones/{applicationId}`; IAM sin bindings; 99/99; última `2026-09-27T14:37:28.561451Z`, HTTP 200 | Al entrar `QUEUED` podía ejecutar B y POST C; reemplazado por `enqueueAutomaticPaymentComplement` + job executor. Ya ausente externamente. Su actividad reciente exige conciliar eventos/cola antes de aceptar retiro. | `UNKNOWN_DO_NOT_TOUCH` |
| `listPagoApplicationsForPayment` | callable HTTP; Cloud Run `allUsers` invoker, con Auth y scope dentro del callable; 12/12; última `2026-09-22T05:08:49.541228Z`, HTTP 200 | Sólo lectura Firestore, sin IQ ni efectos externos. Sin referencias actuales; la UI vigente mantiene snapshot autorizado de `pagoAplicaciones`. Es la única de las cuatro que sigue ACTIVE. | `SAFE_TO_RETIRE_CANDIDATE` |

Dejar activas las dos rutas legadas productivas implicaba riesgo de C fuera del
gate canónico y doble automatización. Retirarlas sin conciliación implicaba
riesgo de abandonar estados legados; por eso las dos rutas con ejecución IQ no
se certifican como retiro seguro pese a que un actor externo ya las eliminó.

## L. Configuración productiva propuesta

- Documento: `paymentComplementConfigs/Ab4z0RttIqXbZFT0NuWsDjBkt6J2`.
- Campo: `iqRequestEnabled`.
- Valor actual leído: campo ausente (`iqEnabled=true`; `facturamaEnabled=true`).
- Valor propuesto: booleano `false` explícito.
- Consumidores: gate canónico `decide` usado por inspect/claim, automation,
  scheduler, canario, sesión/provider; y `Pay0Connector.getIqCapabilities`.
  `configurePaymentComplementAutomation` no escribe hoy este campo.

No se cambió este documento en esta fase.

## M-O. Versionado y límites

El SHA se completa en la entrega al crear el commit. Verificaciones:

- build Functions: PASS;
- smoke gates: PASS, 23 casos;
- smoke automatización: PASS;
- smoke canarios: PASS;
- frontend build: no ejecutable con el guard normal porque este worktree no
  contiene los siete `NEXT_PUBLIC_*` requeridos; no hay cambio frontend;
- `git diff --check`: PASS antes del commit.

Confirmación: no deploy, no IQ, no POST REP C, no escritura productiva, no
Function eliminada por esta rama y no staging creado.
