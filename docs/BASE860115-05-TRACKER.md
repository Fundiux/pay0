# BASE860115-05 — Tracker de cierre

Actualizado: 2026-09-28 (America/Mexico_City)

> ASTRA: trabajo técnico del producto completado y publicación verificada. Quedan decisiones humanas específicas y completar el cierre Git descrito abajo, sin aceptación inventada ni automatizaciones habilitadas por defecto. Esta tabla prevalece sobre los cierres históricos de abajo. REP sigue pausado por instrucción explícita.

- Rama de integración actual: `integration/astra-cycle-20260928`
- Worktree de integración: `.worktrees/astra-reconciliation-20260927`
- Base de main incorporada en `dd2f825`; identidad IQ certificada recuperada en `060313a`. Integración final mediante fast-forward autorizado, sin force push ni cambios a worktrees ajenos.
- Fuente del release: backend `51d7667`, frontend `a0b987b`; CI `3d0ce1d` y verificadores `a434f82`. Los commits posteriores sólo documentan el cierre.
- Publicación: Hosting `ae9632f51fe79634`, SSR `00570-rol`; postflight 70/70 a las 09:21:16 UTC. [Evidencia y límites](audits/ASTRA-PUBLICATION-2026-09-28.md).
- Rama inicial: `cycle/base860115-05`
- Worktree: `C:\Users\ebarr\Desktop\pay0-system\.worktrees\base860115-05`
- Base inicial: `integration/base8601-04-production-clean`
- HEAD inicial: `b5091c835c8d076638e8355a9a7a37057941db14`
- Proyecto Firebase: `pay-0-system`
- Región: `us-central1`
- Estado del runtime: preparado para validación humana. El cierre global requiere completar main/push y comprobar CI; el resultado se verifica después del commit de este informe y se comunica en la entrega.

`VALIDADO` significa implementación, pruebas y publicación técnica comprobadas. No significa que se hayan hecho operaciones financieras reales, cambiado contraseñas reales o completado aceptación humana de voz. La navegación productiva se comprobó sin sesión; los componentes y permisos se probaron con fixtures/emuladores.

| Punto | Título | Estado | Commit | Deploy | Evidencia |
|---:|---|---|---|---|---|
| 1 | Complementos de pago PPD | VALIDADO | 659bc40, b982fbe, 12d1b82, f14c885 | Contención y migración publicadas | Cuatro históricos migrados: ocho documentos canónicos activos, cero legacy activos, finanzas conservadas. Sin seguimientos repetidos en la ventana posterior; entrega pausada y enqueue excluido del despliegue. |
| 2 | Identidad de pestaña/navegador | VALIDADO | 1e638e6 | Hosting ae9632f51fe79634 | Identidad PAY0 y rutas públicas conservadas; postflight final PASS. |
| 3 | Logo/símbolo/favicon | BLOQUEADO EXCLUSIVAMENTE POR DECISIÓN HUMANA | — | No aplica todavía | Pendiente elegir símbolo; no se inventa aprobación visual. |
| 4 | UUID visibles | VALIDADO | 5df6ffd, 6ae63ed | Hosting final | Presentación humana conservada; nueve superficies reales y bundles publicados comprobados. |
| 5 | Login mediante username | VALIDADO | 732b24e | Backend, reglas, TTL y Hosting | 37 controles locales; 13 aliases aplicados y leídos, sin cambiar correos/passwords; login público y rechazo anónimo comprobados. |
| 6 | Cambio de contraseña | VALIDADO | 732b24e | Mi cuenta publicada | Reautenticación y cambio mediante Firebase Auth; pruebas de cuenta y bundle real; sin alterar contraseñas productivas durante QA. |
| 7 | Filtro por usuario | VALIDADO | e7d408e | Backend y Hosting | Filtro por creador con alcance servidor; 47 comprobaciones. |
| 8 | Monto / Abono / Pendiente compacto | VALIDADO | e7d408e | Hosting final | Nueve controles de presentación; componentes reales y build PASS. |
| 9 | Hover global en todas las tablas | VALIDADO | c4d95ed, a0b987b | Hosting final | 117 comprobaciones en nueve superficies; selector grid y hash exacto del CSS servido verificados. |
| 10 | Sistema de notas | VALIDADO | e7d408e | Backend y Hosting | Notas reutilizadas con identidad y alcance; 46 controles combinados notas/identidad/Telegram. |
| 11 | Usuario creador visible para Superadmin | VALIDADO | e7d408e | Backend y Hosting | Creadores visibles y filtro autorizado; pruebas de permisos y componentes. |
| 12 | Hugo pasa a llamarse María | VALIDADO; aceptación de voz humana pendiente | 46afdd2, 51d7667 | Textos en live; voz candidata en astra-p05 | Gateway 12/12 y preview 30/30; fuente P0/P0.5 preparada para conversación humana. La revisión habitual conserva 100% del tráfico. |
| 13 | Aplicación automática de pagos | VALIDADO | e7d408e | Backend, índices y Hosting | 62 controles de evidencia exacta, transacción e idempotencia; no reprocesa históricos ni ejecutó IQ real durante QA. |
| 14 | Tracker y Estado Maestro | VALIDADO | Informe de cierre | No requiere runtime | Los 22 puntos reflejan pruebas, publicación y límites humanos; versiones y migraciones enlazadas. |
| 15 | Canónicos de cotizaciones y constancias | VALIDADO | c938828 | UI, 11 callables, reglas y Storage | Tres recursos de la empresa propia elegible migrados; seis artefactos verificados. 72+5 controles y 247 verificaciones PDF. |
| 16 | Constancias: lugar de recepción/servicio | VALIDADO | c938828 | Backend y Hosting | Lugar, dirección, receptor y observaciones; firma de un solo ganador, PDF verificable y recuperación sin refirmar. |
| 17 | Actualización de Materialidad / MAT | VALIDADO | e7d408e | Backend y Hosting | 21 controles; lecturas antes de escrituras y referencias canónicas REP migradas con backend actualizado. |
| 18 | Mensajes de María en Telegram más concretos | VALIDADO | 46afdd2 | Backend y textos publicados | 46 controles combinados; no se enviaron mensajes reales durante QA. |
| 19 | IQ: task inmediato + scheduler | VALIDADO; staging depende de autorización externa | 060313a, e7d408e, 3f6fa19 | Backend publicado; staging preparado | Continuación y recuperación acotadas; origen certificado y REP cerrado. Barrera staging 79 + runtime 30 PASS. Facturación staging deshabilitada; falta su autorización y un sandbox para pruebas IQ reales. |
| 20 | Comisiones diarias a usuarios | BLOQUEADO EXCLUSIVAMENTE POR DECISIÓN HUMANA | a076c84 | Código y UI publicados, activación deshabilitada | 110 controles; cursor continuo y una solicitud por invocación. Cero configuraciones activas: falta definir hora/días y habilitar el corte. |
| 21 | División automática de comisiones por usuario | VALIDADO | a076c84 | Backend, reglas, índices y Mi cuenta | Regla por cliente y propietario, solicitud manual y motor automático, N destinos y reserva USER. 110 + 29 controles; no descuenta del saldo CLIENT ni reescribe distribuciones históricas. |
| 22 | Identificación y registro automático de pagos | VALIDADO | e7d408e | Backend y Hosting | 75 controles de identificación y 17 de registro real concurrente en emuladores; comprobante inequívoco, folio y costos canónicos. |

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
