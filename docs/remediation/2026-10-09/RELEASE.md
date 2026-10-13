# Publicación y recuperación

Actualizacion 2026-10-13: reconciliacion SSR completo11GET pero verificacion de ZIP FAIL por caches Webpack mayores a64MiB y total declarado551373077 bytes. ZIP privado preservado SHA b44220d46a5960bbb9564fe7775b7cd67a33d25b0211e791f5885d962d3ac98a; no redespliegue ni PASS retrospectivo. Prueba offline de subconjunto5 en preparacion; assets/navegador pendientes. Detalle: docs/remediation/2026-10-09/HOSTING-61879-RECONCILIATION.md.

Aplicaciones SDK9388 PASS55c23e,4casos/14refs/CAS/puertos cerrados, commit9b1f9f6. Integracion selectiva ffa8d3c incluye contexto financiero y aplicaciones:415PASS+1SDKskip, politica, NORMAL, frontend47paginas y manifest7/7(348endpoints) PASS; sin BUNDLED ni deploy. A1 reparado en candidato QA-only, root45+13PASS7a13ec, commiteab2743; A7B sigue pendiente. OIDC7f82cd8 confirmado con134tests/build/policy; SDK DELIVERY en revision, no ejecutado.

Checkpoint vigente 2026-10-13: Hosting Execute61879 termino con error local NOTES_HOSTING_GUARD_FAILED (37649f), despues de RELEASE_ACCEPTED. El recibo original conserva sus 15 estados, sin POSTFLIGHT_VERIFIED; no se modifica ni se convierte en PASS. La causa exacta del fallo final no esta reproducida. No hay deploy activo y no corresponde redesplegar para verificarlo.

Reconciliacion independiente 9a6023: cinco GET y cero escrituras; SSR ssrpay0system-00590-gik, generacion 1791920820865879, Ready y trafico100%; Hosting sites/pay-0-system/versions/4cfd958c9a8694ae FINALIZED. Notas sin cambios. Evidencia privada SHA256 981fdb7977ef04351dbae9e556851688b7359329d569965ef4cc01514ce3d6ad. Probe local fa3312: seis comprobaciones de configuracion/operacion/release pasan; el validador del recibo falla por el marcador ausente. Esto no identifica la causa original. Fuente ZIP, subconjunto local, assets y navegador siguen pendientes de una prueba de reconciliacion separada; no fabricar eventos de finalizacion.

Pago: commit ba10db22aed4d04aaca1344d3c61638765334b37 en remediation/solicitud-notes-read-20261011. SDK demo46262 PASS6661d6: tres casos,20 refs, limpieza CAS y puertos cerrados, cero cloud; retry ABORTED inyectado, sin afirmar contencion natural. Aplicaciones conserva tres archivos WIP revisados:51/51 pruebas, NORMAL58847, politica e identidad IQ15/15 PASS. Gates historicos h4-d66-a1 (imports IQ ya presentes) y h4-d80-a7b (iqBrowser.ts ausente) fallan por condiciones anteriores; SDK de aplicaciones pendiente. Integracion b1d8e78 espera incorporar ambos cambios antes de nuevo empaquetado.

Notifier: DELIVERY corregido y revisado por raiz (e53492/causal binding, adaptador y limites); suite raiz0123c9:71/71 PASS, cero skips. Fija admision y creacion nativa en claim/receipt/cleanup, captura dependencias y concede cinco segundos independientes para registrar el resultado incierto, sin repetir POST. Sigue inerte, sin dispatcher DELIVERY ni proveedor conectado; SDK pendiente. OIDC134/134 PASS, build y commit acotado en curso. No hay cierre global.

Historial preservado: los estados activos o pendientes de los checkpoints siguientes describen su momento y quedan sustituidos por este corte.

Checkpoint vigente 2026-10-13: Execute85272 termino FAIL antes del upload, con FUNCTIONS_CLI_DISCOVERY_FAIL / CHILD_STOP_FAILED (16888 ms, limite 7000 ms). Receipt conservado con GUARD_ACTIVE y OVERLAY_APPLIED; no VERSION_CREATE, SSR_UPDATE ni release. La comprobacion aislada posterior paso: 347 endpoints en 2686 ms, sin relajar limites ni ejecutar acciones remotas. Competencia por recursos es una hipotesis compatible, no una causa exclusiva demostrada.

Reconciliacion posterior 780726: cinco GET y cero escrituras. SSR00588-guh, notas00002-lah, servicio y release de6ff585fd68735d sin cambios; servicio Ready. Evidencia privada reconcile-after85272-20261013-9b9efcd09555-five-get-evidence.json SHA256 37d2347d77521cc8497cddc3372f075b2b0ca791ff2c175c2d0531bd1e73ba85. Lista parcial de versiones sin cambios: 30c61b0ada41fe90 CREATED, 3423b4eb75ac869f ABANDONED y de6ff585fd68735d FINALIZED. No hay deploy activo; siguiente intento requiere input y receipt nuevos y compilaciones concurrentes detenidas.

Integracion aislada Solicitud/Pago 9b622f8: dependencias offline, 318 pruebas PASS y una SDK omitida, politica y builds Functions NORMAL/frontend PASS (47 paginas). Manifest SDK 7/7 y transicion completa 347 a 348 PASS. Primera captura CLI fallo por timeout10849 ms; unico reintento aislado PASS4700 ms. BUNDLED, nuevo artefacto y despliegue pendientes. Notifier f737e97 incorpora supervision inerte revisada, 115/115 pruebas y NORMAL PASS; todavia sin activacion ni entregas a proveedores. No hay cierre global.

Historial de checkpoints anteriores (los estados activos de abajo corresponden a su momento):

## Checkpoint 2026-10-13: diagnostico de subida y reconciliacion

Execute68333 termino FAIL al subir a Storage el paquete de88,25MB; receipt de cuatro estados, hasta VERSION_CREATED, sin SSR_UPDATE ni release. No se observo codigo HTTP ni errno: el log privado contiene URL firmada y no debe imprimirse. Su vigencia restante segun reloj local no respalda expiracion como causa. Se preservan input, receipt, log y versiones.

Reconciliacion b346f5: cinco GET, cero escrituras; SSR00588-guh, notas00002-lah, servicio y release de6ff585fd68735d iguales, Ready100. Captura privada reconcile-after68333-20261013-4bc3eee923f9-five-get-evidence.json SHA256fb2a3927ce3802e49178728d7628abc15f665428f9e259185178abf2f45479b8. Lista parcial:30c61b0ada41fe90 CREATED,3423b4eb75ac869f ABANDONED,de6ff585fd68735d FINALIZED; no equivale a inventario exhaustivo.

Guard diagnostico revisado: solo storage.upload, una llamada original, mismos argumentos/retorno/error, sin consumir stream ni anadir retries. Metadatos de error limitados a enums propios y numeros; nunca URL, mensaje, stack, ruta, headers ni body. Root59/59PASS5d78fe. Guard SHA25603e20ead5f1cd95a3cd2bad4a894fb844004d17c11d155627389910e46ec51f1; CLI fingerprint e26ccb22a24cc8b3a74afd5d3680fa2b65e359ef52ac082c499b93eee90154fc incluye los tres callsites de subida. No requiere rebuild del producto: herramienta local probada con API CLI real y transporte simulado. Proximo intento requiere input/receipt nuevos y Preflight/Stage; postflight SSR, assets y navegador siguen pendientes.

Historia conservada de checkpoints anteriores:


Estado 2026-10-13: comparador Hosting corregido, revision independiente y
root51/51 PASSfa6ee6. Nuevo despliegue pendiente de input/receipt propios y
metadata remota fresca. La captura ca19dc corresponde al 11 de octubre.
Los checkpoints siguientes conservan la historia del intento fallido.

Actualizacion vigente: Execute61813 FAIL en VERSION_RESPONSE tras dispatch
createVersion, sin milestone SSR_UPDATE/release. Puede existir version creada
no publicada; reconciliacion remota pendiente, no repetir ni borrar.
Reconciliacion posterior ca19dc PASS: SSR/notes/release/service sin cambios y
Ready100. Version3423b4eb75ac869f CREATED, aun no publicada. El namespace
projects/- devuelve projects/751158244178/sites/...; guard esperaba sites/...
solamente. Evidencia privada a7a2b4334773ad445c78566396bde456a06b287dedc2e4311b4486f573dc2f00.
Correccion y prueba integral del API instalado pendientes antes de nuevo intento.

Checkpoint anterior: Execute61813 Hosting en curso con inputb92026725d...
y guardf499aee/ff946532, Preflight e6a21a/Stage e730d0 PASS. Receipt separado
created-7fef3ab20a19: GUARD_ACTIVE/OVERLAY_APPLIED. No nueva release confirmada.
Integrationa529/helper/pins congelados mientras activo; no repetir Execute.

Checkpoint anterior: ZIP de notas00002-lah verificado exacto1251 y hash
identico al subido, cloud68631/local32483. Escala20/20/20/20 aceptada tras
revision completa; ver NOTES-UPDATE-RECONCILIATION.md, sin ocultar launcherFAIL.
Hosting inputbf9e1911... Preflight/Stage64981PASS; Execute37057 FAIL.
Receipt solo GUARD_ACTIVE/OVERLAY_APPLIED; 4GET posteriores confirman SSR,
notas y release anteriores sin cambios (SHA63b0285a22b5076106a87b45061ace06ca56b9c3ff4f3535238fd033f17cc36f).
Incompatibilidad reproducida offline con prepare real del CLI: status CREATED
rechazado por guard anterior. Fix y diagnostico cerrado: root22/22 PASSc2f503.
La excepcion productiva exacta no fue capturada. Nuevo input/receipt pendiente;
no reutilizar intento fallido ni cambiar integrationa529 hasta resolver lote.

Estado vigente: integrationa52959b contiene fix de extensions vacias ff69fc6,
root38 tests PASS. Execute33777 envio un solo UPDATE aceptado; operacion
operation-1791701277259-65d8af62cb6f7-78339efc-00d901df confirmada done:true
sin error por GET independiente c35bfa. Revision00002-lah ACTIVE/Ready100%,
sourcegeneration1791701277897589. Launcher exit1 en comprobacion final
API_MAX_OVERRIDE: max antes null/20/null/null, ahora GCF/servicio/template20;
lectura de nueva revision y evaluacion explicita pendientes. Receipt queda
en UPDATE_ACCEPTED, siete estados; no atribuirle finalizacion exitosa.
Entorno restaurado/working tree limpio c6af5a. No repetir actualizacion.
ZIP subido1251 SHA7c7da3c0d3358a714dfda8966436aa2a02f4924cf5713e0ba4714f4ff3c98183;
verificacion independiente del ZIP final en curso. Hosting no publicado.

Historia anterior: Packagingf3f3bed integrado/pushed: strict local1251/1251PASS82565, cloud0;
root25tests+6packerPASS. Launcher eef4d18 PASS53/defaultlocal+StageCASPASS.
Update-only61313 fallo antesupload/update por resolucionJSZip errada enCLI;
guardGUARD_ACTIVE solamente, entorno restaurado. Correccion decoderFunctions
PASS41+offline1251/stream45447. Execute93350 fallo despues ZIP_VERIFIED1251,
sin ZIP_UPLOADED/plan/update. Entorno restaurado SHA572b76d y trackedclean;
fresh75310PASS3GET confirma revision/config originales. Causa reproducida
offline: guard rechaza payload.extensions={} producido por CLI real; correccion
aislada en curso y nuevo intento pendiente. Preservar ambos intentos fallidos.
Solo despues de nuevo ZIP independiente exacto y configuracion preservada
se puede preparar Hosting. No implica cierre de solicitud348 ni S10.

Notas2026-10-11: Execute93477 creo listclientdispersionnotes-00001-mug,
sourcegeneration1791691748273508, entorno restaurado. ZIP independiente
rechazado por327extras pese a1251hashes esperados coincidentes. Hosting aun
sin publicar; correccion packaging aislada en revision. Los checks historicos
IQ/download acreditan subconjuntos de archivos/hashes runtime, no igualdad
global del ZIP. Mantener esta distincion al leer checkpoints anteriores.

Gate cloud de cohorte sintetica PASS a48min, misma ancla y limpieza verificada;
no activa el notificador. Ver [NOTIFICATION-CLOUD-READTIME-EVIDENCE.md](NOTIFICATION-CLOUD-READTIME-EVIDENCE.md).

Actualizacion2026-10-11: seis entradas IQ desplegadas desde3f3c4c5 y verificadas
por revision, configuracion y ZIP exacto. Ver [RELEASE-IQ-SIX-BUNDLED.md](RELEASE-IQ-SIX-BUNDLED.md).
Descarga autorizada tambien publicada con bundle; checkpoints al final conservan
su detalle. Las menciones de IQ6 pendiente debajo son historia, no estado vigente.

Estado mas reciente: Firestore ruleset76fda1a0 y los cuatro consumidores Hugo
00003 fueron publicados desde5a4457e y verificados el2026-10-10. Ver
[FIRESTORE-RELEASE-PREFLIGHT.md](FIRESTORE-RELEASE-PREFLIGHT.md) y
[RELEASE-HUGO-EVIDENCE.md](RELEASE-HUGO-EVIDENCE.md). Storage permanece sin cambio.
IQ deposito ya publicado; otros seis IQ siguen pendientes. Core documental publicado desde a276e03: init00016-zot, finalize00017-jaz, deactivate00017-rob, ACTIVE/Ready100/401. Ver [RELEASE-DISPERSION-DOCUMENT-CORE.md](RELEASE-DISPERSION-DOCUMENT-CORE.md); notifier sin cambios y entrega aun parcial.

Primer lote publicado: logUnauthorizedRouteAttempt desde integración 6b8d2f7e35cb, rama remota integration/pay0-remediation-20261009. Main remoto sin cambios. Estado efectivo y recuperación en HANDOFF.md; las filas siguientes conservan detalle del candidato inicial, no son cierre global.

## Lote documental compatible: desplegado 2026-10-09 23:03 UTC

Candidate integration c29260b, pushed before deployment. Only getAuthorizedDocumentDownloadUrl published; revision00004-vat ACTIVE/Ready100%, source generation1791586901568255. CLI exit0, timeout30s/memory256Mi/no secret references, synthetic unauthenticated POST401 verified. Build/policy/focused13/predeploy96+42 PASS. Previous00003-xuj source generation1790583836497870 preserved in private getAuthorizedDocumentDownloadUrl-pre-bridge.zip, SHA256 C50F0D7A95BB24CAF156022AE1145503D34F2110F9C39DF71921EE52A190DB1F. Prefer compatible forward correction; old artifact lacks current authority checks and rollback would reintroduce that gap. No real download, rule publication or historical token rotation. Contract remains300s path-based bearer; see STORAGE-CLIENT-TRANSITION.md for residual limitations.

## Candidatos locales

Esta tabla conserva el candidato inicial. Para estado posterior a las 20:00 UTC, prevalece la actualizacion al final; en particular, el orden Telegram vigente exige emisor puente y drenaje antes del consumidor dual, Hosting y emisor final.

| Lote | Commit fuente | Verificación | Publicación |
|---|---|---|---|
| Reportes sin contención | 31a9f05 | 4 pruebas y build PASS | Publicado revision00012-zal; HTTP401 PASS; limpieza de binding de secreto pendiente |
| Materialidad QA | 6507598 | Contrato ejecutable PASS | Herramienta local |
| Delegaciones/reglas | 6859938 | 243 aserciones emuladas; build PASS | Revalidar integrado antes de reglas/callables afectados |
| OCR y memoria por root | a43658b | 11 pruebas PASS | parsePagoReceiptPdf y correctPagoReceiptSemanticField |
| Telegram | 6a894d0 | 6 pruebas PASS | Orden: consumidor compatible, Hosting de página, productor; ventana legacy 15 min |
| Dependencias | d66555b | Audit cero; builds y smokes PASS; npm ci limpio PASS | Se publica con lotes pertinentes |
| Resultado IQ incierto | 36270fb | 17 escenarios emulador PASS | Entradas de depósito afectadas, sin ejecutar depósitos de prueba reales |
| Integridad documental | b49db84 | 8 pruebas y build PASS | init/finalizeEntityDocumentUpload preservando continuidad CSF |
| Sentinel núcleo | 6f3f931 | 10 pruebas PASS | Sin export; servicio aislado pendiente |
| Inventario | 1de4d85 | 3 pruebas PASS | Snapshot estático; regenerar al congelar integrado |

## Artefactos previos preservados

- Reglas en %TEMP%/pay0-remediation-20261009-rules/. Firestore ruleset042bafab-3487-418e-8245-2416e19d1963, SHA256 E46B418E151684F983703A86B1FF6DD1C096FAF113929086F5F45397681E125D. Storage rulesetd37e96b3-5266-4a44-8ce6-c903a502a854.
- logUnauthorizedRouteAttempt revision00011-zev, generation1790583721294236, ZIP SHA256c50f0d7a95bb24caf156022ae1145503d34f2110f9c39df71921ee52a190db1f; fuente activityLog idéntica a HEAD inicial.
- parsePagoReceiptPdf revision00012-fab, generation1790843385213011, ZIP SHA256329b31f7f23c0b87556a38034cc5ae6e0f9e64f8b5a2d0d51ec6cd8eda723a98; capacidades publicadas recuperadas antes del nuevo límite.
- telegramDownloadAction revision00014-lot, generation1789965997517317, ZIP SHA256250f7ab8072e11c58fd6fb864b5a117b94cef38e28deb5861ec578103696c220. telegramWebhook revision00031-yeg, generation1789965994022008 identificada; revalidar productor exacto.
- ZIP locales en %TEMP%/pay0-remediation-20261009-sources/. Solo fuentes seleccionadas extraídas; no .env ni secretos incorporados.

## Procedimiento por lote

1. Congelar commit integrado y ejecutar comprobaciones aplicables.
2. Reconsultar revisión/source generation y comparar dependencias con producción.
3. Registrar componentes exactos, configuración y recuperación. Mantener pausas REP/syncTodayIqInvoicesNow y no desplegar globalmente.
4. Publicar por el flujo Git permitido; GitHub main consultado: protected=false, sin reglas devueltas, SHA remoto7dfcd8a.
5. Desplegar componentes concretos, comprobar revisión efectiva y postflight seguro.
6. Un fallo bloquea solo ese lote. Si rollback reintroduce vulnerabilidad, priorizar contención compatible o corrección hacia adelante. Nunca repetir un efecto externo incierto.

## Estado confirmado posterior a las 20:00 UTC

- Backend documental y consulta de estado propio publicados desde `d4298e09fe66`: `streamPrivateDocument` revision `streamprivatedocument-00001-cig` (20:17:52.478459991Z) y `getMyRestrictionStatus` revision `getmyrestrictionstatus-00001-hay` (20:18:07.522711461Z). Ambos ACTIVE/Ready, trafico 100%, rechazo no autenticado HTTP401 PASS. No se publicaron reglas, Hosting ni writers por ese lote. Detalle: [RELEASE-DOCUMENT-BACKEND.md](RELEASE-DOCUMENT-BACKEND.md).
- Inventario secuencial del root seleccionado: 1,446 uploads, 1,361 elegibles, 1,357 con padre canonico y objeto real <=32 MiB, 85 inactivos. Los cuatro casos entityId-only quedaron diagnosticados con padre SOLICITUD ausente, prefijo coincidente y procedencia no verificada; no existe base para reparacion automatica ni para inventar padres. Siete tamanos registrados desconocidos son una dimension adicional, no registros a sumar. Entidades: 23 documentos, 13 activos validos y 10 inactivos; assets: cero. No constituye snapshot atomico ni cobertura de todos los roots. Detalle: [DOCUMENT-INVENTORY.md](DOCUMENT-INVENTORY.md) y [LEGACY-DOCUMENT-COMPATIBILITY.md](LEGACY-DOCUMENT-COMPATIBILITY.md).
- Sentinel E2E sintetico y deduplicacion PASS tras corregir aliases Pub/Sub: observer `00005-dgr`, dos HTTP200, RECORDED=1/DUPLICATE=1, receipt/incidente HTTP200, eventCount=1, authority=NONE y TTL valido. Ventana cerrada: canary `00006-6wv` Ready/DISABLED y sink apagado. Esto acredita el canario y su replay, no cobertura de productores financieros ni contencion. El intento inicial fallido se conserva en [SENTINEL-ROLLOUT.md](SENTINEL-ROLLOUT.md).
- Integracion publicada a su rama remota en `3fa5957`; cambio frontend posterior `d08acda` con build en progreso al registrar este hito. Estado temporal: `pendingFrontendHashFix/browser`. No atribuir a ese candidato un build final ni browser PASS hasta recibir evidencia. No hubo deploy Hosting ni Telegram de este lote y no se declara completada la remediacion.

Preflight offline del ZIP SSR productivo frente a integracion `7b56c4c`: 56 rutas app existentes conservadas y 57 en candidato, unica adicion `/descarga/documento`; rutas estaticas 44->45 y dinamicas 12->12. Configuracion de rutas equivalente; Next.js 15.5.25->15.5.27, Node22 en ambos. Sin metadata suficiente para atribuir commit fuente productivo. No se detecto perdida de rutas, pero esta comparacion no prueba equivalencia funcional completa ni sustituye los gates del frontend posterior. Preflight Telegram comunicado por integracion: ocho modulos comparados, iguales salvo `actionTokens`; no implica despliegue ni ejercicio de Telegram real. Orden, entorno y recuperacion en [RELEASE-FRONTEND-TELEGRAM.md](RELEASE-FRONTEND-TELEGRAM.md).

## Descarga autorizada: bundle integrado y fuente desplegada verificada

- Integracion3f3c4c5, deploy selectivo95455 PASS; run2817b3ed3e504dd4bc621d1649a29580.
- Revision getauthorizeddocumentdownloadurl-00005-zur, source generation1791679264531843.
- Predeploy completo PASS; CLI6199ms/346 endpoints; tres builds producen la misma provenance.
- Postflight86060 GET-only PASS: ACTIVE, RunReady/100%, configuracion/env preservados,
  GOOGLE_NODE_RUN_SCRIPTS vacio;931 entradas de ZIP real iguales a manifest aprobado.
- ZIP remoto SHA256 efc10a0728c646f6cafe9d31bc3cfa0a84a967c6580f54dee8c198e7d368dcc4;
  bundle308ad5c99d96990df327e08bb0272ea9f52931bf43fcc630b97fcad6842e980d.
- Dotenv original restaurado. Evidencia privada conserva generacion exacta y checkpoint;
  no provider payloads/env en Git. Sin invocar handlers ni probar efectos financieros.
- Verificacion de artefacto/configuracion, no afirmacion de ejecucion de cada ruta.
  No rollback automatico: preservar generation-pinning al preparar correccion compatible.
  Main y reglas publicadas permanecen sin cambio; IQ6 y notas347 siguen pendientes.
