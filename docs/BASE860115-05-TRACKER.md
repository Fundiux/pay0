# BASE860115-05 — Tracker de cierre

Actualizado: 2026-09-27 (America/Mexico_City)

- Rama: `cycle/base860115-05`
- Worktree: `C:\Users\ebarr\Desktop\pay0-system\.worktrees\base860115-05`
- Base inicial: `integration/base8601-04-production-clean`
- HEAD inicial: `b5091c835c8d076638e8355a9a7a37057941db14`
- Proyecto Firebase: `pay-0-system`
- Región: `us-central1`
- Estado del ciclo: `ABIERTO`

| Punto | Título | Estado | Commit | Deploy | Evidencia |
|---:|---|---|---|---|---|
| 1 | Complementos de pago PPD | CERRADO | `ebdeaf4`, `3e085d5` | Functions + Hosting, 2026-09-27 | Pipeline canónico único; AP1C13U3E5 reconciliado a 2 documentos de Pago `READY`; legacy retirado; `/pagos` HTTP 200. |
| 2 | Identidad de pestaña/navegador | PENDIENTE | — | — | — |
| 3 | Logo/símbolo/favicon | PENDIENTE | — | — | — |
| 4 | UUID visibles | PENDIENTE | — | — | — |
| 5 | Login mediante username | PENDIENTE | — | — | — |
| 6 | Cambio de contraseña | PENDIENTE | — | — | — |
| 7 | Filtro por usuario | PENDIENTE | — | — | — |
| 8 | Monto / Abono / Pendiente compacto | PENDIENTE | — | — | — |
| 9 | Hover global en todas las tablas | PENDIENTE | — | — | — |
| 10 | Sistema de notas | PENDIENTE | — | — | — |
| 11 | Usuario creador visible para Superadmin | PENDIENTE | — | — | — |
| 12 | Hugo pasa a llamarse María | PENDIENTE | — | — | — |
| 13 | Aplicación automática de pagos | PENDIENTE | — | — | — |
| 14 | Tracker y Estado Maestro | PENDIENTE | — | — | — |
| 15 | Canónicos de cotizaciones y constancias | PENDIENTE | — | — | — |
| 16 | Constancias: lugar de recepción/servicio | PENDIENTE | — | — | — |
| 17 | Actualización de Materialidad / MAT | PENDIENTE | — | — | — |
| 18 | Mensajes de María en Telegram más concretos | PENDIENTE | — | — | — |
| 19 | IQ: task inmediato + scheduler | PENDIENTE | — | — | — |
| 20 | Comisiones diarias a usuarios | PENDIENTE | — | — | — |
| 21 | División automática de comisiones por usuario | PENDIENTE | — | — | — |
| 22 | Identificación y registro automático de pagos | PENDIENTE | — | — | — |

## Punto 1 — Complementos de pago PPD

- Estado: `CERRADO`
- Fecha/hora de entrada: 2026-09-27
- Componentes iniciales: frontend, Functions, Firestore, Storage, Cloud Tasks, scheduler, IQ, Facturama, documentos de Pago y aplicaciones de pago.
- Diagnóstico: producción conserva dos pipelines IQ REP. El pipeline legacy importó el REP de `AP1C13U3E5` bajo documentos generales de Solicitud; el pipeline canónico mantuvo su job en `BLOCKED / IQ_REP_REQUEST_ELIGIBILITY_UNVERIFIED`. Cuatro aplicaciones históricas ya constan `RECEIVED` en el pipeline canónico. La UI del detalle de aplicaciones no consultaba documentos REP.
- Causa raíz: coexistencia de dos automatizaciones desplegadas, ausencia de reconciliación de evidencia legacy, documentos legacy con `entityType: solicitudes` y compuerta LOOKUP que no admitía el estado bloqueado por elegibilidad aun cuando IQ podía generar el REP posteriormente.
- Implementación: adopción idempotente de XML/PDF legacy hacia documentos de Pago ligados por `applicationId`; retiro lógico de copias legacy; reconciliación de request/job a `RECEIVED`; polling seguro para jobs bloqueados por elegibilidad; columna Complemento con descarga XML/PDF autorizada en el detalle del pago.
- Pruebas de emulador: smoke integral Firestore+Storage PASS con 26 controles y `externalActions: 0`: concurrencia, idempotencia, documentos bajo Pago, adopción legacy, recuperación del bloqueo de elegibilidad y tolerancia legacy explícita de un centavo. La coincidencia normal sigue siendo exacta.
- Emuladores utilizados: Firestore y Storage.
- Cierre de emuladores: confirmado después de cada corrida/atasco; puertos sin listeners del ciclo. Firebase dejó conexiones `TIME_WAIT` transitorias, sin procesos Java propios persistentes.
- Compuertas: Functions build PASS; frontend build PASS (43 páginas); autorización PASS; release baseline y 22 controles críticos PASS; `git diff --check` PASS.
- Deploy: `enqueueAutomaticPaymentComplement` revisión `00005-lal`, `checkPaymentComplementsDaily` revisión `00009-gak` y SSR `ssrpay0system-00556-fax`, todos `ACTIVE`. Hosting liberado el 2026-09-27.
- Verificación post-deploy: `AP1C13U3E5` quedó `RECEIVED` en request/job, con XML/PDF activos bajo `pagos/{pagoId}` y cero documentos legacy activos. Se eliminaron `enqueueIqPaymentComplements`, `requestIqPaymentComplementOnApplication` y `processIqPaymentComplementQueue`. Scheduler `ENABLED`, lunes a viernes 19:00 `America/Mexico_City`; `/pagos` HTTP 200; cero logs `ERROR` de los servicios desplegados en la ventana posterior.
- Riesgos residuales: la excepción de redondeo de un centavo existe únicamente para adoptar REP legacy ya timbrados y queda marcada en la aplicación; no modifica el criterio exacto de respuestas nuevas. No se realizó una solicitud IQ ni un timbrado real durante las pruebas.
- Bloqueadores: ninguno para el Punto 1.
- Cierre: 2026-09-27. Siguiente punto autorizado: Punto 2 — Identidad de pestaña/navegador.
