# BASE860115-05 — Tracker de cierre

Actualizado: 2026-09-28 (America/Mexico_City)

> ASTRA continúa ABIERTO. Esta tabla refleja el estado vigente; los cierres históricos de abajo se conservan como trazabilidad y no sustituyen las incidencias posteriores. REP sigue pausado por instrucción explícita.

- Rama de integración actual: `integration/astra-cycle-20260928`
- Worktree de integración: `.worktrees/astra-reconciliation-20260927`
- Base de main incorporada en `dd2f825` (la referencia main todavía no avanzó); identidad IQ certificada recuperada en `060313a`.
- Rama inicial: `cycle/base860115-05`
- Worktree: `C:\Users\ebarr\Desktop\pay0-system\.worktrees\base860115-05`
- Base inicial: `integration/base8601-04-production-clean`
- HEAD inicial: `b5091c835c8d076638e8355a9a7a37057941db14`
- Proyecto Firebase: `pay-0-system`
- Región: `us-central1`
- Estado del ciclo: `ABIERTO`

| Punto | Título | Estado | Commit | Deploy | Evidencia |
|---:|---|---|---|---|---|
| 1 | Complementos de pago PPD | EN PROGRESO | 659bc40, b982fbe, 12d1b82, f14c885 | Contención publicada; migración pendiente | Bucle corregido; entrega pausada. Automatización 26, adopción 17 y plan reanudable 21 controles PASS. Cuatro históricos pendientes de aplicar con backend MAT actualizado. |
| 2 | Identidad de pestaña/navegador | VALIDADO | 1e638e6 | Hosting actual | Identidad PAY0 comprobada; repetir postflight tras publicación. |
| 3 | Logo/símbolo/favicon | BLOQUEADO EXCLUSIVAMENTE POR DECISIÓN HUMANA | — | No aplica todavía | Pendiente elegir símbolo; no se inventa aprobación visual. |
| 4 | UUID visibles | VALIDADO | 5df6ffd, 6ae63ed | Hosting actual | Presentación humana conservada; repetir postflight transversal. |
| 5 | Login mediante username | PROBADO | 732b24e | Pendiente | 37 controles Auth/Firestore PASS; plan de 13 aliases únicos sin cambiar emails/passwords. Falta publicar backend, aplicar plan y Hosting. |
| 6 | Cambio de contraseña | PROBADO | 732b24e | Pendiente | Mi cuenta con reautenticación y cambio mediante Firebase Auth; sin alterar credenciales reales durante QA. |
| 7 | Filtro por usuario | PROBADO | e7d408e | Pendiente | Filtro por creador con alcance servidor; 47 comprobaciones de filtros. |
| 8 | Monto / Abono / Pendiente compacto | PROBADO | e7d408e | Pendiente | Presentación compacta; 9 controles de presentación y build frontend PASS. |
| 9 | Hover global en todas las tablas | PROBADO | e7d408e | Pendiente | Estilo compartido incorporado; build frontend PASS. |
| 10 | Sistema de notas | PROBADO | e7d408e | Pendiente | Notas reutilizadas con identidad visible y reglas existentes; 46 controles combinados notas/identidad/Telegram PASS. |
| 11 | Usuario creador visible para Superadmin | PROBADO | e7d408e | Pendiente | Creadores visibles y filtro de alcance; pruebas de permisos y build PASS. |
| 12 | Hugo pasa a llamarse María | PROBADO | Integración local | Pendiente | Textos públicos María; IDs técnicos estables. Gateway 48 y privacidad 10 PASS. Aceptación acústica humana y promoción separadas. |
| 13 | Aplicación automática de pagos | PROBADO | e7d408e | Pendiente | 62 comprobaciones: evidencia exacta, transacción y reintento idempotente; no reprocesa históricos ni ejecuta IQ real en QA. |
| 14 | Tracker y Estado Maestro | EN PROGRESO | Integración local | No aplica | Se distingue implementación/prueba/publicación. Actualización final pendiente de postflight y Git. |
| 15 | Canónicos de cotizaciones y constancias | PROBADO | c938828 | Pendiente | UI y backend de recursos versionados; 72+5 controles y PDF 247 verificaciones/10 páginas inspeccionadas. Plan real de 3 recursos elegibles pendiente. |
| 16 | Constancias: lugar de recepción/servicio | PROBADO | c938828 | Pendiente | Lugar, dirección, receptor y observaciones; firma de un solo ganador y recuperación de PDF sin refirmar. |
| 17 | Actualización de Materialidad / MAT | PROBADO | e7d408e | Pendiente | 21 controles de proyección, cambios y permisos; todas las lecturas antes de escribir en la transacción. |
| 18 | Mensajes de María en Telegram más concretos | PROBADO | Integración local | Pendiente | 46 controles combinados PASS; no se enviaron mensajes reales durante QA. |
| 19 | IQ: task inmediato + scheduler | PROBADO | 060313a, e7d408e | Pendiente | Continuación inmediata y recuperación acotada; origen IQ certificado conservado y REP cerrado. Barrera staging 79 comprobaciones sin red. |
| 20 | Comisiones diarias a usuarios | PROBADO | Integración local | Pendiente | 110 controles PASS; cursor continuo, 250 lecturas/máximo una solicitud por invocación. Configuración inicialmente deshabilitada; hora/días pendientes de decisión. |
| 21 | División automática de comisiones por usuario | EN PROGRESO | Integración local | Pendiente | Regla por cliente/usuario, manual y automática, N destinos, reserva USER atómica. Identidad hist?rica exacta hasta el transporte IQ; 29 controles de adapter PASS. |
| 22 | Identificación y registro automático de pagos | PROBADO | e7d408e | Pendiente | 75 controles de identificación y 17 de registro real concurrente; comprobante inequívoco y folio/costos canónicos. |

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

- Estado: `CERRADO` (corrección posterior publicada durante la reconciliación ASTRA)
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
- Cierre de publicación: `6ae63ed` quedó incluido en Hosting `a601e3d72f58fffc`, liberado el 2026-09-27 a las 23:02:20 UTC y fijado a SSR `00564-vuv`. La rama `fix/astra-activity-log-reconciliation` conserva esta base, coordina las reglas/consultas de Actividad y repara los bloqueos de verificación de despliegue. No reemplazó las Functions REP publicadas por el frente concurrente. Evidencia ampliada en `docs/ASTRA-RECONCILIATION-2026-09-27.md`.
- Versión final de ese cierre: Hosting `95413a190fd561ea` / SSR `00566-tig`, 23:18:35 UTC, con los mismos cambios de interfaz y la corrección de encabezados de seguridad en la raíz. Diez rutas públicas y manifest HTTP 200; encabezados, hashes de 26 archivos y navegación pública Chromium PASS.
