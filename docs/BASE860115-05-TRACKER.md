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
| 2 | Identidad de pestaña/navegador | CERRADO | `1e638e6` | Hosting, 2026-09-27 | Título, manifest y metadatos públicos usan `PAY0`; SSR `ssrpay0system-00558-nit`; `/`, `/login`, `/pagos` y manifest HTTP 200; sin identidad técnica visible. |
| 3 | Logo/símbolo/favicon | PENDIENTE | — | — | Espera la decisión del símbolo visual; Eliut autorizó continuar con los puntos siguientes. |
| 4 | UUID visibles | LISTO_PARA_DEPLOY | `5df6ffd` | Hosting/SSR `00560-mum`, verificación inicial PASS | Correcciones post-deploy verificadas con build de 44 rutas, smoke de emulador PASS y puertos libres; pendiente redeploy final. |
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

## Punto 2 — Identidad de pestaña/navegador

- Estado: `CERRADO`
- Fecha/hora de entrada: 2026-09-27
- Componentes auditados: metadata raíz de Next.js, título del documento, manifest/PWA, OpenGraph, Twitter metadata y shell cliente.
- Diagnóstico: el layout raíz era un componente cliente y no declaraba metadata canónica, título, manifest ni identidad social. Los identificadores técnicos encontrados correspondían a configuración interna indispensable de Firebase y no a presentación pública.
- Implementación: el layout raíz pasó a ser servidor y declara `PAY0` como título, application name y site name; se añadieron descripción pública, OpenGraph, Twitter metadata y `/manifest.webmanifest`. La lógica cliente del shell se aisló en `RootClientShell` sin cambiar rutas, autenticación ni identificadores internos.
- Pruebas locales: frontend build PASS con 44 rutas; release baseline y 22 controles críticos PASS. HTML generado de `/`, `/login` y `/pagos`, más el manifest, verificados con identidad `PAY0` y sin `pay-0-system`/`pay0-system` en campos visibles.
- Emuladores: el hook estándar inició el smoke CSF y quedó suspendido después de que los procesos de emulador terminaron; se confirmó que no había listeners antes de interrumpir el proceso padre. No se alteró producto para eludir la prueba; las compuertas independientes ya habían aprobado.
- Cierre de emuladores: confirmado; sin listeners persistentes del ciclo.
- Deploy: Hosting liberado el 2026-09-27; SSR `ssrpay0system-00558-nit` `ACTIVE` y con 100% del tráfico. Se usó una configuración temporal equivalente sin hooks para publicar después de completar por separado las compuertas; el archivo temporal fue eliminado y no forma parte del repositorio.
- Verificación post-deploy: `/`, `/login`, `/pagos` y `/manifest.webmanifest` HTTP 200; título `PAY0`, enlace al manifest y OpenGraph `PAY0` en las páginas; sin identidad técnica en título/application-name/OG/Twitter; cero logs `ERROR` recientes del SSR.
- Riesgos residuales: el dominio y la configuración interna conservan legítimamente `pay-0-system`; no se modificaron porque son identificadores operativos, no texto de presentación. Logo, símbolo e iconos quedan reservados al Punto 3.
- Bloqueadores: ninguno para el Punto 2.
- Cierre: 2026-09-27. Siguiente punto autorizado: Punto 3 — Logo/símbolo/favicon.

## Punto 3 — Logo/símbolo/favicon

- Estado: `PENDIENTE` por instrucción de Eliut del 2026-09-27; continuar con los demás puntos.
- Auditoría: no hay favicon ni app icons de PAY0. Los PNG presentes son un fondo del login y un recurso ajeno a la identidad de PAY0. Manifest y metadata admiten la integración técnica.
- Pendiente: decisión del símbolo visual o entrega de un activo aprobado. No se eligió identidad definitiva, no hubo implementación ni deploy de este punto.
- Siguiente acción: retomar después de recibir la decisión visual, sin bloquear el avance del Punto 4.

## Punto 4 — UUID visibles

- Estado: `LISTO_PARA_DEPLOY` (corrección posterior al primer deploy)
- Fecha de entrada: 2026-09-27
- Rama/worktree: `cycle/base860115-05` / `C:\Users\ebarr\Desktop\pay0-system\.worktrees\base860115-05`
- Diagnóstico: varias vistas muestran IDs de Firestore como renglón secundario o sustituto de folios/nombres; algunos exports también los incluyen. Los UUID de CFDI son identificadores fiscales canónicos y los diagnósticos técnicos de IQ tienen utilidad operacional, por lo que se revisan por separado.
- Implementación: presentación con folios/nombres y textos de ausencia de datos en Solicitudes, Pagos, Materialidad, Reportes, Wallet, catálogos, documentos, accesos y WhatsApp. Se mantuvieron los IDs como keys, valores de selección, rutas y payloads. Los exports financieros conservaron sus columnas de trazabilidad.
- Emulador: Firestore local `demo-pay0` con fixture de dos aplicaciones PPD y renderizado real del componente en Chromium. Verificados folio humano, caso sin folio y ausencia de ambos IDs Firestore en el DOM. Resultado PASS. Emulador detenido y puertos liberados.
- Compuertas: frontend build PASS (44 rutas), baseline y 22 controles críticos PASS, Functions build PASS; `qa:document-access` PASS con 42 descargas firmadas y 8 rechazos autorizados, `qa:document-ui` PASS, `git diff --check` PASS. Segunda ejecución de Firestore Emulator cerrada y puertos libres.
- Deploy planeado: Hosting/SSR únicamente. Sin cambios en Functions, Rules, Indexes ni datos de producción.
- Primer deploy: flujo estándar completo PASS y SSR `ssrpay0system-00560-mum` con 100% de tráfico. Ocho rutas HTTP 200, cero logs `ERROR` recientes y emuladores cerrados.
- Hallazgo post-deploy: un tooltip, un chat sin nombre y etiquetas accesibles de beneficiarios/dispersiones aún podían revelar IDs al faltar su referencia humana. Se corrigen antes del cierre definitivo.
- Corrección final: también se cubrieron los mensajes de exceso en pagos, el selector de adelantos, el nombre del despacho en costos y la confirmación de borrado de beneficiario. Build de frontend PASS con 44 rutas; baseline y 22 controles críticos PASS. Smoke Firestore + Chromium PASS, `git diff --check` PASS y emuladores cerrados.
