# Resolucion individual legacy - AR-10

Revision estatica del 9 de octubre de 2026. Fuente: `docs/audits/pay0-system-integral-2026-10-07/DISABLED-AND-LEGACY-INVENTORY.csv` (31 filas exactas). Principal HEAD `99d1f3a2efc1d3e946d16e89c44c75a9b8b75bca`; integrado HEAD `e5508973023ee2e9848f346df5c3ce827f40a71f`, ambos con cambios de trabajo: los SHA no representan por si solos este contenido. Candidato en `.worktrees/pay0-remediation-integration-20261009`. Comparacion de archivos normaliza LF/CRLF; no se confundieron diferencias de EOL con cambios semanticos.

Se contrastaron las 31 entradas, consumidores frontend/backend, redirecciones, reglas de rutas y diferencias del candidato. No se retiro ni reactivo ninguna capacidad. No se consulto produccion ni se ejecutaron estas funcionalidades. Las decisiones siguientes resuelven clasificacion y trabajo concreto; no certifican uso productivo ni autorizacion de todos sus efectos.

## DL-FN-backfillPagoReportDates - backfillPagoReportDates

- Evidencia fuente: `functions/src/modules/reports/pagoReportDateBackfillCallables.ts`. Archivo integrado: equivalente tras normalizar EOL. SHA256 fuente normalizada `a54f1bd464d1cf5a`; integrado `a54f1bd464d1cf5a`.
- Consumidores y contrato: Reportes page:254 - services/reports.ts:145; callable superadmin, reportes/view, root, limite250, apply===true.
- Decision y aceptacion: Conservar mantenimiento operativo; corregir carrera entre lectura de reportDateAt y batch.update mediante transaccion/precondicion. Probar cambio concurrente y dry-run sin escrituras.

## DL-FN-runHugoIqRepReadCanary - runHugoIqRepReadCanary

- Evidencia fuente: `functions/src/modules/paymentApplications/complementCanary.ts`. Archivo integrado: equivalente tras normalizar EOL. SHA256 fuente normalizada `e139b7ef1503088b`; integrado `e139b7ef1503088b`.
- Consumidores y contrato: index export - trigger onDocumentCreated hugoComplementCanaries; ID fijo iq-rep-read-ap1c4u1e6-v1; canon HUGO-CANARIO-REP-IQ-2026-09-21; evidencia local y claim LOOKUP.
- Decision y aceptacion: Conservar expediente y handler acotado; no agregar UI ni reactivar. Probar ID distinto, replay y fingerprint cambiado con proveedor falso antes de retiro.

## DL-FN-runHugoIqRepAttachmentExperiment - runHugoIqRepAttachmentExperiment

- Evidencia fuente: `functions/src/modules/paymentApplications/repAttachmentExperiment.ts`. Archivo integrado: equivalente tras normalizar EOL. SHA256 fuente normalizada `273234def42cb99e`; integrado `273234def42cb99e`.
- Consumidores y contrato: index - onDocumentCreated hugoRepAttachmentExperiments; ID fijo, exige canario STOPPED y fingerprint; observa adjunto sin crear REP.
- Decision y aceptacion: Conservar dependencia historica explicita del canario REQUEST; probar falta de antecedente y archivo ambiguo. Retiro debe preservar documentos fuente.

## DL-FN-runHugoIqRepDepositFieldProbe - runHugoIqRepDepositFieldProbe

- Evidencia fuente: `functions/src/modules/paymentApplications/repDepositFieldProbe.ts`. Archivo integrado: equivalente tras normalizar EOL. SHA256 fuente normalizada `7ae924fa38b1ea27`; integrado `7ae924fa38b1ea27`.
- Consumidores y contrato: index - onDocumentCreated hugoRepDepositFieldProbes; ID fijo, antecedentes y un deposito esperado; canon HUGO-VERIFICACION-CAMPO-REP-IQ-2026-09-21.
- Decision y aceptacion: Conservar probe de lectura y antecedente de REQUEST; probar deposito ajeno/campos ambiguos sin POST. No ejecutar orden real.

## DL-FN-runHugoIqRepRequestCanary - runHugoIqRepRequestCanary

- Evidencia fuente: `functions/src/modules/paymentApplications/repRequestCanary.ts`. Archivo integrado: equivalente tras normalizar EOL. SHA256 fuente normalizada `a27e47a680901bb3`; integrado `a27e47a680901bb3`.
- Consumidores y contrato: index - onDocumentWritten hugoRepRequestCanaries; ID/folio/deposit fijos; claim QUEUED->RUNNING; antecedentes, gate REQUEST despues de sesion, estado UNKNOWN tras ambiguedad.
- Decision y aceptacion: Conservar capacidad acotada y evidencia. No es solo lectura: puede POST. Gate actual S01 revalida actor y cliente; probar revocacion durante sesion y un solo POST en replay antes de certificacion.

## DL-FN-probeIqDispersionModule - probeIqDispersionModule

- Evidencia fuente: `functions/src/modules/iq/dispersionModuleProbeCallables.ts`. Archivo integrado: diferencia semantica descrita abajo. SHA256 fuente normalizada `36f7d17d58ede306`; integrado `a6a113d1d1d4e192`.
- Consumidores y contrato: services/iq.ts:1082 - integraciones/iq/diagnostico/page.tsx:324; callable assertIqAuthorized. Integrado incorpora normalizeIqAssociatedName(access.associatedName || profile.associatedName).
- Decision y aceptacion: Conservar diagnostico consumido; preservar normalizacion main al integrar. Probar acceso denegado y perfil asociado normalizado con sesion falsa.

## DL-FN-seedUproAssetPortfolio - seedUproAssetPortfolio

- Evidencia fuente: `functions/src/modules/assets/callables.ts`. Archivo integrado: equivalente tras normalizar EOL. SHA256 fuente normalizada `87d6b284f7430a79`; integrado `87d6b284f7430a79`.
- Consumidores y contrato: services/assets.ts:117; qa/scripts/assets-emulator-smoke.cjs:72/74; callable context comprueba systemAccess.assets o superadmin y propiedad uid. existing.exists solo afecta retorno.
- Decision y aceptacion: CORREGIR AR10-SEED: segunda ejecucion vuelve a escribir status, nombre, createdAt y movimientos con merge. IDs estables no son no-op. Claim transaccional y prueba replay tras cierre/edicion; no eliminar.

## DL-UI-42099b4af0 - /

- Evidencia fuente: `src/app/page.tsx`. Archivo integrado: equivalente tras normalizar EOL. SHA256 fuente normalizada `0b2032cae20feb32`; integrado `0b2032cae20feb32`.
- Consumidores y contrato: page.tsx:18/23 redirige a /login o getFirstAllowedRoute(profile).
- Decision y aceptacion: Conservar entrada publica de navegacion; no requiere menu. Probar anonimo y cada perfil sin bucle de redireccion.

## DL-UI-88e60e85e1 - /cuenta

- Evidencia fuente: `src/app/cuenta/page.tsx`. Archivo integrado: equivalente tras normalizar EOL. SHA256 fuente normalizada `ce9de8a6b6af4d77`; integrado `ce9de8a6b6af4d77`.
- Consumidores y contrato: AppShell.tsx:175, systems/page.tsx:23 y dispersiones enlace retiro; changeMyPassword, reauthenticateCurrentUser, setMyUsername y destinos comision.
- Decision y aceptacion: Conservar cuenta activa y enlace contextual; senal sin menu queda refutada. Probar reautenticacion y usuario distinto.

## DL-UI-bd98cdefb8 - /mensajes

- Evidencia fuente: `src/app/mensajes/page.tsx`. Archivo integrado: equivalente tras normalizar EOL. SHA256 fuente normalizada `3a9844724584db1b`; integrado `3a9844724584db1b`.
- Consumidores y contrato: page.tsx:10 router.replace(/dashboard); roles.ts marca /mensajes publico; no consumidor interno localizado.
- Decision y aceptacion: Conservar alias de compatibilidad; no hay mensajeria implementada en esta pagina. Retiro solo con evidencia de enlaces externos; considerar destino getFirstAllowedRoute para perfiles sin dashboard.

## DL-UI-4c94e3bc7f - /systems

- Evidencia fuente: `src/app/systems/page.tsx`. Archivo integrado: equivalente tras normalizar EOL. SHA256 fuente normalizada `23d6f62eb961d936`; integrado `23d6f62eb961d936`.
- Consumidores y contrato: AppShell.tsx:179/235, AssetsShell.tsx:35/43, HugoShell.tsx:19; launcher PAY0/ASSETS/Hugo y canAccessSystem.
- Decision y aceptacion: Conservar selector activo; menu especializado demuestra uso previsto. Probar systemAccess.assets=false y rol no superadmin.

## DL-UI-25d020c883 - /wallet/adelantos

- Evidencia fuente: `src/app/wallet/adelantos/page.tsx`. Archivo integrado: equivalente tras normalizar EOL. SHA256 fuente normalizada `a3352768ee475e9c`; integrado `a3352768ee475e9c`.
- Consumidores y contrato: grantClientAdvance y listScopedClients; roles.ts wallet/adelantos superadmin; no enlace de entrada localizado en src.
- Decision y aceptacion: Conservar herramienta restringida por URL; no anadir menu sin decision de producto. Probar grant root/cliente y saldo insuficiente; falta enlace no prueba obsolescencia.

## DL-UI-43819dc890 - /wallet/clientes

- Evidencia fuente: `src/app/wallet/clientes/page.tsx`. Archivo integrado: equivalente tras normalizar EOL. SHA256 fuente normalizada `58fd28ad2c2a2d1f`; integrado `58fd28ad2c2a2d1f`.
- Consumidores y contrato: WalletNavigation.tsx:12, wallet/page.tsx:145; readClientWalletAccountsOverview y detalle cliente.
- Decision y aceptacion: Conservar seccion activa; navegacion confirmada. Probar alcance delegado y cuenta ajena.

## DL-UI-0d4625fa32 - /wallet/estado-cuenta-cliente

- Evidencia fuente: `src/app/wallet/estado-cuenta-cliente/page.tsx`. Archivo integrado: equivalente tras normalizar EOL. SHA256 fuente normalizada `4a66167cbbb941d5`; integrado `4a66167cbbb941d5`.
- Consumidores y contrato: redirect(/wallet/clientes) en pagina linea4; regla estadoCuentaCliente.
- Decision y aceptacion: Conservar alias explicito al reemplazo /wallet/clientes; sin duplicar UI ni retirar bookmarks.

## DL-UI-00bb28340e - /wallet/estado-cuenta-usuario

- Evidencia fuente: `src/app/wallet/estado-cuenta-usuario/page.tsx`. Archivo integrado: equivalente tras normalizar EOL. SHA256 fuente normalizada `d1b5a784785c8d28`; integrado `d1b5a784785c8d28`.
- Consumidores y contrato: WalletNavigation y wallet/page.tsx:146; readUserWalletOverview; permiso estadoCuentaUsuario.
- Decision y aceptacion: Conservar vista activa; probar usuario propietario y privacidad de otro usuario.

## DL-UI-e89b8aa328 - /pagos/reproceso

- Evidencia fuente: `src/app/pagos/reproceso/page.tsx`. Archivo integrado: equivalente tras normalizar EOL. SHA256 fuente normalizada `43ba6e3e92a6d8dc`; integrado `43ba6e3e92a6d8dc`.
- Consumidores y contrato: diagnosePagoFinancialContext y preparePagoFinancialPosting(postNow:true); rol superadmin en pagina y politica; no enlace entrante src localizado.
- Decision y aceptacion: Conservar herramienta financiera restringida. Requiere prueba replay posting y pago ajeno antes de promoverla al menu; no ejecutar datos reales.

## DL-UI-462c419553 - /mat/clientes

- Evidencia fuente: `src/app/mat/clientes/page.tsx`. Archivo integrado: equivalente tras normalizar EOL. SHA256 fuente normalizada `875182ed87024992`; integrado `875182ed87024992`.
- Consumidores y contrato: MatShell + useMatClientHome - getMatClientHome(initData, botScope CLIENTS); sin initData devuelve modo LOCAL sin pedir datos.
- Decision y aceptacion: Conservar entrada Telegram fuera del menu PAY0; publica a nivel ruta no significa datos publicos. Probar firma/expiry/replay initData y scope CLIENTS en backend.

## DL-UI-00b2a5e029 - /mat/usuarios

- Evidencia fuente: `src/app/mat/usuarios/page.tsx`. Archivo integrado: equivalente tras normalizar EOL. SHA256 fuente normalizada `47ea83054374b829`; integrado `47ea83054374b829`.
- Consumidores y contrato: MatShell + useMatUserHome - getMatUserHome(initData, botScope USERS); sin initData modo LOCAL.
- Decision y aceptacion: Conservar entrada Telegram USERS; probar separacion CLIENTS/USERS y usuario no vinculado. No unificar ambas rutas.

## DL-UI-d2aff0ef08 - /integraciones/iq

- Evidencia fuente: `src/app/integraciones/iq/page.tsx`. Archivo integrado: equivalente tras normalizar EOL. SHA256 fuente normalizada `7646af4d263024cd`; integrado `7646af4d263024cd`.
- Consumidores y contrato: Pagina integra servicios IQ; enlace entrante desde diagnostico/page.tsx:615; regla superadmin.
- Decision y aceptacion: Conservar configuracion operativa restringida; el enlace contextual refuta abandono. Prueba guardar flags con rol ajeno.

## DL-UI-4f07ac256c - /integraciones/iq/automatizacion

- Evidencia fuente: `src/app/integraciones/iq/automatizacion/page.tsx`. Archivo integrado: equivalente tras normalizar EOL. SHA256 fuente normalizada `44efe0adeb14b047`; integrado `44efe0adeb14b047`.
- Consumidores y contrato: Enlace desde diagnostico/page.tsx:632; enlaza de regreso en linea487; regla superadmin.
- Decision y aceptacion: Conservar configuracion automatizacion; probar apagado no emite efectos y guardado respeta root.

## DL-UI-623a7932e7 - /integraciones/iq/diagnostico

- Evidencia fuente: `src/app/integraciones/iq/diagnostico/page.tsx`. Archivo integrado: equivalente tras normalizar EOL. SHA256 fuente normalizada `ba0b986044c4717b`; integrado `ba0b986044c4717b`.
- Consumidores y contrato: Configuracion automatizacion enlaza diagnostico; diagnostico consume probeIqDispersionModule y otras inspecciones; regla superadmin.
- Decision y aceptacion: Conservar diagnostico real; probar proveedores falsos y no exponer secretos en respuesta.

## DL-UI-c48d1ce9d3 - /integraciones/iq/diagnostico/pagos

- Evidencia fuente: `src/app/integraciones/iq/diagnostico/pagos/page.tsx`. Archivo integrado: equivalente tras normalizar EOL. SHA256 fuente normalizada `78e70a7cc343a2b0`; integrado `78e70a7cc343a2b0`.
- Consumidores y contrato: redirect(/integraciones/iq/diagnostico) linea4; regla superadmin.
- Decision y aceptacion: Conservar alias conocido al diagnostico unificado; no crear pantalla ni retirar ruta.

## DL-UI-e91b31e517 - /hugo/evaluation

- Evidencia fuente: `src/app/hugo/evaluation/page.tsx`. Archivo integrado: equivalente tras normalizar EOL. SHA256 fuente normalizada `41147cab508ff210`; integrado `41147cab508ff210`.
- Consumidores y contrato: hugo/page.tsx:48 enlaza HugoModelEvaluation; solo superadmin obtiene bypass de ruta, otros roles fallan cerrados.
- Decision y aceptacion: Conservar evaluacion activa; probar rol no superadmin. No inferir que es experimento abandonado por no figurar en AppShell.

## DL-UI-c1a74c7b39 - /assets/documents

- Evidencia fuente: `src/app/assets/documents/page.tsx`. Archivo integrado: equivalente tras normalizar EOL. SHA256 fuente normalizada `ac45193cfbc4d90b`; integrado `ac45193cfbc4d90b`.
- Consumidores y contrato: AssetsShell.tsx:13; useAssetsOverview, uploadAssetDocument y getDownloadURL; acceso systemAccess.assets.
- Decision y aceptacion: Conservar modulo documental ASSETS; revisar URLs de descarga en frente S01 sin retirar UI. Probar init/upload/finalize y documento ajeno.

## DL-UI-3dd9289b45 - /assets/movements

- Evidencia fuente: `src/app/assets/movements/page.tsx`. Archivo integrado: equivalente tras normalizar EOL. SHA256 fuente normalizada `f1a918337dcc9232`; integrado `f1a918337dcc9232`.
- Consumidores y contrato: AssetsShell.tsx:12 y assets/page.tsx; useAssetsOverview y movimientos enlazados a posicion.
- Decision y aceptacion: Conservar navegacion ASSETS confirmada; probar proyeccion financiera y ownership.

## DL-UI-85bdece098 - /assets/positions

- Evidencia fuente: `src/app/assets/positions/page.tsx`. Archivo integrado: equivalente tras normalizar EOL. SHA256 fuente normalizada `013d127c78a2b7d0`; integrado `013d127c78a2b7d0`.
- Consumidores y contrato: AssetsShell.tsx:11, assets/page.tsx; useAssetsOverview y enlaces dinamicos a /assets/positions/{id}.
- Decision y aceptacion: Conservar catalogo real; probar acceso propio y status terminal.

## DL-UI-cf047cbc75 - /assets/positions/new

- Evidencia fuente: `src/app/assets/positions/new/page.tsx`. Archivo integrado: equivalente tras normalizar EOL. SHA256 fuente normalizada `47a2da52b6102434`; integrado `47a2da52b6102434`.
- Consumidores y contrato: assets/page.tsx y assets/positions/page.tsx:36; createAssetPosition, importe entero positivo y confirmacion explicita.
- Decision y aceptacion: Conservar alta contextual; no anadir entrada global separada. Probar doble submit/idempotencia backend y datos invalidos.

## DL-REP-REQUEST - Solicitud automatica REP IQ

- Evidencia fuente: `functions/src/modules/paymentApplications/complementGates.ts`. Archivo integrado: equivalente tras normalizar EOL. SHA256 fuente normalizada `49a5f898f8d43f51`; integrado `49a5f898f8d43f51`.
- Consumidores y contrato: complementAutomation, complementProviders y repRequestCanary consumen gates; iqRequestEnabled===true, master, perfil, cuota y estado. Fuente S01 anade actor actual REQUEST y LOOKUP durable acotado.
- Decision y aceptacion: Conservar gate de seguridad, no reactivar por esta revision. Trasladar S01 a integrado; comprobar cuota ultima plaza/revocacion/UNKNOWN con pruebas ya entregadas y prueba canario especifica.

## DL-IQ-HTTP - Creacion HTTP deposito IQ

- Evidencia fuente: `functions/src/modules/iq/depositHttpCreateCore.ts`. Archivo integrado: equivalente tras normalizar EOL. SHA256 fuente normalizada `738691803eb1d338`; integrado `738691803eb1d338`.
- Consumidores y contrato: pagoDepositHttpCreateFlow - createIqDepositHttpControlled; allowHttpPost===true. Fuente callback autorizacion prePOST; ambos clasifican outcomes inciertos para recovery.
- Decision y aceptacion: Conservar gate y transporte operativo. Trasladar callback S01; suite financiera y wiring validan flujo, no valor de flag productivo.

## DL-WHATSAPP - Envio WhatsApp

- Evidencia fuente: `functions/src/modules/documentDelivery/whatsappRuntime.ts`. Archivo integrado: equivalente tras normalizar EOL. SHA256 fuente normalizada `275f6faedf7b1004`; integrado `275f6faedf7b1004`.
- Consumidores y contrato: whatsappRuntime.ts:144 define requireWhatsAppManualSendReady y :156 sendEnabled, pero busqueda completa TS no encuentra consumidor en ninguno de los arboles. AutomationCallables/QR exponen estado del conector.
- Decision y aceptacion: NO certificar enforcement por este helper aislado. Conservar mientras se traza productor/bridge real y su PAY0_SEND_ENABLED; agregar prueba off->0 envios en ejecutor real antes de conectar/eliminar helper.

## DL-COMMISSION - Envio automatico de comisiones

- Evidencia fuente: `src/components/CommissionUserAssignments.tsx`. Archivo integrado: equivalente tras normalizar EOL. SHA256 fuente normalizada `793497cf4c04c8ef`; integrado `793497cf4c04c8ef`.
- Consumidores y contrato: CommissionUserAssignments configuracion - services/commissions. Principal carece daily.ts; integrado commissionDistributions/daily.ts:97/100 usa policy.executionEnabled para reservar/ejecutar, snapshot del corte y maximo1 ejecucion por pagina.
- Decision y aceptacion: Conservar capacidad main incorporada. Gate real si existe en integrado; probar enabled/executionEnabled false->0 ejecucion y revocacion durante corte. No certificar solo desde UI ni borrar por ausencia backend principal.

## Hallazgos ejecutables y limites

1. **AR10-SEED, P1, vigente en ambos arboles.** `seedUproAssetPortfolio` consulta `assetSeeds` pero no abandona cuando existe; siempre escribe nuevamente los registros deterministas y agrega bitacora. Reproduccion propuesta: seed, cerrar/renombrar posicion KWID mediante servicio, seed de nuevo; el segundo seed restablece status ACTIVE/nombre y createdAt. Corregir con transaccion de lectura/creacion atomica del seed y documentos, no un simple early-return externo susceptible a carreras. Prueba aislada debe verificar replay no cambia datos ni auditoria y dos invocaciones simultaneas producen un unico seed. No implementado en esta revision.
2. **AR10-BACKFILL, P1, carrera estatica verificable.** La seleccion sin reportDateAt ocurre antes del batch; otro escritor puede fijarlo y resultar sobrescrito. Usar transaccion por lote o precondicion updateTime/reintento para preservar fecha canonica concurrente. Prueba con pausa entre get y commit. No se afirma incidente productivo.
3. **AR10-WHATSAPP, pendiente de contrato.** Helper de compuerta sin consumidor TS: no basta para concluir bypass ni proteccion. Seguir bridge/worker externo, configuracion y pruebas del frente mensajeria; antes de eliminar, buscar imports dinamicos fuera de TS y operacion del conector.
4. **AR10-MENSAJES, P2.** Alias /mensajes redirige fijo a dashboard; candidato pequeno es resolver primera ruta permitida para perfiles sin dashboard. Requiere prueba de navegacion con ese perfil; no afecta conservacion del alias.

Las diferencias semanticas observadas en los 31 archivos fueron probe de dispersion (normalizacion asociada de main), complementGates y depositHttpCreateCore (lote S01 todavia pendiente de traslado durante esta lectura). Los otros 28 archivos son equivalentes normalizando EOL. Esta igualdad no implica igualdad de todo el dominio: comision demuestra por que deben revisarse tambien consumidores incorporados desde main.

## Omision adicional del filtro historico

`runHugoIqRepReadCohort` no se suma artificialmente a las 31 filas. `repReadCohort.ts` implementa trigger sobre ordenes con tres IDs/folios permitidos, claim QUEUED->RUNNING, fingerprint, root/padres/plan/attempt, LOOKUP con cuota y comprobaciones antes de sesion/deposito/adjunto. Es lectura y puede actualizar evidencia local; no es una solicitud REP. Conservar handler y expedientes hasta confirmar retencion/consumidores operativos, probar ID desconocido, replay y evidencia modificada con adaptador falso. El canario REQUEST referencia explicitamente los documentos de experimentos anteriores: eliminarlos como limpieza romperia ese contrato.

## Validacion de esta entrega

Se verifico correspondencia uno a uno con los 31 IDs del CSV y comparacion de contenido fuente/integrado. Se inspeccionaron consumidores completos mediante busquedas locales y lectura de implementaciones relevantes. No se ejecutaron emuladores, navegadores, builds ni proveedores en esta revision documental. Pruebas S01/S07 anteriores son evidencia de sus respectivos lotes; no se atribuyen automaticamente a seed, backfill o canarios. unico archivo modificado por esta revision: este informe.

## Adenda: fix seed autorizado despues de la revision

Se corrigio `functions/src/modules/assets/callables.ts` unicamente en `seedUproAssetPortfolio`: transaccion que lee el seed y todos los destinos deterministas antes de crear documentos; seed existente retorna `alreadySeeded:true` sin escribir ni auditar; datos parciales sin seed rechazan con failed-precondition para conciliacion explicita. Se usan creates, sin merge que pueda sobrescribir historia. Se conservan valores, ownership y tipos del portafolio inicial. El estado de comparacion anterior describe la fotografia previa a este fix; integrado debe recibir este hunk del coordinador.

`node qa/scripts/remediation-legacy-seed.test.cjs`: PASS. Ejecuta el callback real extraido del AST con Firestore falso y verifica primer seed, dos invocaciones simultaneas serializadas como retries exitosos, replay tras cerrar/editar una posicion sin cambios ni auditoria, rechazo sin escrituras de datos parciales y propietario separado. La prueba no simula internals del servidor Firestore: falta carrera real de emulador si se exige certificacion transaccional completa. Sintaxis y diff --check PASS. No se ejecuto produccion ni build concurrente.

Seguimiento WhatsApp: `whatsappAutomationTrigger.ts` prepara y libera jobs mediante `releaseWhatsAppJobDeliveriesCore`; `functions/scripts/verify-whatsapp-automation.mjs` explicitamente espera READY_FOR_SEND/PENDING_SEND con conector DISCONNECTED y sendEnabled=false. Por contrato la compuerta no bloquea preparacion de cola; debe operar en el consumidor externo antes de enviar. `tools/whatsapp-qr-connector` local solo presenta directorios de sesion y no fuentes top-level; no se leyo contenido de sesiones. Se mantiene abierta la prueba del ejecutor real, sin afirmar bypass a partir de cola preparada.

La entrega ahora modifica tres archivos: este informe, callable assets y la nueva prueba seed; la autorizacion adicional del coordinador corresponde exclusivamente a ese fix.

## Adenda: backfill concurrente autorizado

Se corrigio `pagoReportDateBackfillCallables.ts`: el apply relee todos los candidatos dentro de una transaccion antes de escribir, conserva reportDateAt establecido por otro escritor, comprueba root actual, ignora documentos eliminados y resuelve la fecha fuente actual. El resultado updated cuenta escrituras reales, no candidatos obsoletos. Dry-run sigue sin escribir.

`node qa/scripts/remediation-legacy-backfill.test.cjs`: PASS callback real con Firestore falso: dry-run, fecha canonica concurrente, cambio de root, fecha fuente cambiada, eliminacion y replay. La prueba de concurrencia introduce el cambio exactamente entre consulta y transaccion; no usa servidor remoto.

Entrega final AR-10: dos TS autorizados (seed assets y backfill reportes), dos tests nuevos y este informe. Builds finales a cargo del coordinador.

Busqueda final del bridge: git ls-files no rastrea fuente del conector; git log --all -- tools/whatsapp-qr-connector no devuelve historia. Se examinaron solo candidatos fuente top-level (*.js/*.mjs/*.cjs) y src (*.ts/*.js) de ese directorio en los worktrees registrados: ninguno localizado. No se inspeccionaron sesiones. Verificador de politica y diff --check PASS para el lote. Correspondencia automatizada 31/31 IDs en orden del CSV: PASS.
