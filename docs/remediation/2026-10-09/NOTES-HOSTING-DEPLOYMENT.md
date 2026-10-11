# Hosting de notas: launcher SSR para revision

Estado 2026-10-11: implementacion local revisada por root, NO ejecutada contra Hosting. 19/19 pruebas sinteticas PASS, repetidas por root d17f1b. Syntax Node y carga PowerShell LibraryOnly PASS. Sin builds ni cloud writes en este lote. El segundo deploy del callable de notas termino exit0, pero el ZIP remoto contiene327 archivos adicionales a los1251 esperados (todos estos coinciden); no existe aun proof independiente PASS. Hosting permanece pendiente de resolver esa diferencia, sin relajar el verificador.

## Baseline nueva, solo lectura

Cuatro GET autorizados: GCF ssrpay0system, servicio Run, revision Ready y ultima release Hosting. Captura privada ignorada .firebase/notes-hosting-baseline/baseline.json, SHA256 14993deb2c4b5f8f2e92d448f8c456c86dcaa9e1f5b6b1f486ab0ff38baea70f.

SSR ACTIVE/nodejs22/revision00588-guh; 256Mi/CPU1/concurrency80/timeout60/min ausente/max20. Max Run servicio y template20. Ocho env, cero secretos. Hosting version de6ff585fd68735d, rewrite tag fh-de6ff585fd68735d. 288 tags historicos, trafico latest100%. Los tags sin porcentaje siguen siendo rutas accesibles. Estos datos se revalidan antes de actualizar; no se reutilizan como prueba perpetua.

Primer intento no llego a HTTP porque gcloud no pudo crear su log local bajo sandbox. La repeticion con escalacion por ese fallo de entorno completo los cuatro GET. Token solo memoria; metadata/config/env se conserva privada, sin valores en stdout/Git. No se hicieron nuevas lecturas remotas durante implementacion del launcher.

## Hallazgo y preservacion

Integracion examinada: ed5e6f3dd80d05e4ede95dbac8e8c65593235bfe. Actualizar pins si cambia HEAD; no copiar hashes antiguos a otro candidato.

hosting.predeploy ejecuta qa:document-access, que incluye npm --prefix functions run build. El launcher hereda PAY0_FUNCTIONS_BUILD_MODE=BUNDLED_V1 a TODO el proceso y sus hijos. No se escribe en dotenv ni se admite en runtime SSR. Se conserva el selector hosting y todos los hooks; no se reducen limites discovery7s/10s. Source/provenance se verifican antes/despues y antes de cada mutacion relevante.

CLI15.3.1 genera .firebase/pay-0-system/functions y codebase firebase-frameworks-pay-0-system. --only hosting tambien actualiza HTTPS ssrpay0system. El nuevo launcher inyecta la guardia en ese mismo proceso CLI con --require; no confia en que un wrapper padre propague execArgv. Conserva usage/config env, limpia DEBUG/NODE_OPTIONS/discoverytimeout heredado y usa discovery por archivo.

Root aprobo overlay EN MEMORIA de frameworksBackend: region us-central1, memory256MiB, CPU1, concurrency80, timeout60, minInstances0, maxInstances20, serviceAccount e ingress del baseline. Ausencia de min y0 equivalen a cero instancias minimas. No se modifica firebase.json. SDK real instalado confirma los campos resultantes; conversor/planner reales CLI confirman HTTPS update.

El wrapper frontend mezcla archivo y luego entorno del proceso. El helper verifica conjunto/hashes de dotenv raiz y hash de TODAS NEXT_PUBLIC_* efectivas, ademas de7campos requeridos, sin emulator=true. Pins de helpers/frontend/firebase.json y del dotenv Functions restaurado son independientes de los de source/bundle. No loguear valores.

## Archivos y modos

- scripts/deploy-notes-hosting.ps1: LibraryOnly, Preflight LOCAL por defecto, StageDryRun LOCAL explicito y Execute explicito. Execute tiene lock local exclusivo; no se ejecuto.
- scripts/lib/notes-hosting-ssr-update-only.cjs: verificacion local, launcher, overlay, guardias GCF/Run/Hosting y postflight.
- qa/scripts/remediation-notes-hosting-deploy.test.cjs: 19 pruebas sin red productiva.

Invocacion futura, solamente tras revision root de pins y prerequisitos:

    powershell.exe -NoProfile -File scripts/deploy-notes-hosting.ps1 -Mode Preflight -InputFile <privado>/input.json -ExpectedInputHash <sha256>
    powershell.exe -NoProfile -File scripts/deploy-notes-hosting.ps1 -Mode StageDryRun -InputFile <privado>/input.json -ExpectedInputHash <sha256>

Execute sustituye Mode unicamente despues de revision explicita; este documento no lo ejecuta. Logs y receipt quedan bajo .firebase/notes-hosting-baseline. LibraryOnly no lee nube ni inicia procesos externos.

Request privado schema PAY0-NOTES-HOSTING-INPUT@1:

- candidate: contrato completo del helper de notas anterior (worktree/head/provenanceSha/sourceSha/cliSha/wrapperSha/manifest/manifestSha). Debe acreditar manifest347 y source exactos actuales.
- baselineFile/baselineSha: captura SSR/Run/Hosting revisada.
- firebaseConfigSha, frontendHelperSha, frontendWrapperSha: archivos exactos de integracion.
- rootDotenv: lista completa de objetos file/sha256 para archivos raiz .env/.env.*; nada de valores.
- frontendEffectiveSha: SHA256 del JSON de todas NEXT_PUBLIC_* ordenadas por clave, despues del resolver real y herencia.
- hostingCliSha: fingerprint ampliado de CLI incluyendo frameworks, converter/release/pinTag y poller; guardSha y candidateHelperSha: herramientas exactas revisadas.
- receiptFile: archivo nuevo privado de estados, sin sobreescritura.
- notesProof: verifierSha; requestFile/requestSha; receiptFile/receiptSha del verificador independiente; approved=true y approvedScaling exactamente con los cuatro niveles observados/revisados. El request del verificador debe ser el modo local con metadataSha/zipSha fijados, originalEnvSha y revision/generation exactas.

Preflight/Stage verifican archivos y pruebas previas; no leen nube ni construyen. Execute primero repite --verify-local sobre ZIP/metadatos privados con el verificador fijado; despues comprueba metadata actual antes de cargar CLI. Que el recibo original diga hostingApproved=false es correcto: la decision de escala es posterior, explicita y fijada en este request. No se acepta aprobacion inferida de defaults.

## Contrato de mutaciones y recibo

El plan admite exactamente un UPDATE SSR HTTPS en su codebase; cero create/delete/recreate/skip ni otro endpoint. API exige runtime/config/env exactos, normalizando solamente FUNCTION_TARGET y LOG_EXECUTION_ID que agrega deterministamente CLI. Reserva wrapperUPDATE antes de await. No retry automatico de resultado incierto.

La operacion GCF aceptada queda identificada por nombre; su poller debe completar ACTIVE y devolver runtime/config compatibles. El recibo guarda revision y storage source bucket/object/generation, sin env. Antes de finalizar/publicar y DESPUES del deploy se exige esa revision/source exacta, no cualquier SSR nuevo con config igual.

Run replaceService se permite una sola vez y exclusivamente para el tag fh-<versionHosting asignada>. Reserva antes del GET/await; un resultado incierto no habilita otro dispatch. GET fresco y objeto propuesto conservan metadata/resourceVersion/template/trafico anterior, agregando solamente ese tag hacia latestReady. GC inesperado se rechaza. Se conserva la proteccion de resourceVersion que viaja en el objeto Run; no se infiere atomicidad entre servicios diferentes.

IAM: setInvokerUpdate verifica binding existente allUsers sin condicion; no llama setIamPolicy. Cambios de IAM, createInvoker y otros endpoints fallan cerrado. Las bindings reales se verifican al ejecutar, no fueron parte de los cuatro GET de baseline.

Hosting: una version nueva en el sitio exacto. Su creacion/subida no es aun publicacion. Finalize y release live exigen SSR operativo exacto, tag esperado, notas sin cambios y observacion fresca de la release previa. Se rechazan canales, clones, otros sitios y cambios de dominios. CLI release real invoca createRelease(site, 'live', version, {}) cuando no hay channel/message; las pruebas recorren release.js + convertConfig + runTags reales con transportes falsos. No se simulan argumentos inventados.

LIMITACION: GET de la release previa seguido de POST createRelease NO es un CAS atomico; API no recibe precondicion del servidor en este launcher. Existe una carrera con otro publicador entre ambas llamadas. El lock solo coordina ejecuciones de esta herramienta local. Se requiere ventana operativa exclusiva y postflight; no se declara garantia global de exclusion.

Recibo exige activacion, overlay, version, plan, update, finalizacion de operacion, finalize/release y postflight. Run Ready requiere trafico100 y latestCreated/latestReady exactos. TrafficStatuses.revision admite las representaciones corta/completa de la MISMA revision; baseline real usa corta. Env Run en arrays conserva comparacion estricta de orden: puede rechazar un reordenamiento equivalente; no se amplio a ciegas. El env GCF se compara como mapa.

Postflight comprueba el recibo source/revision del poller, version Hosting exacta, config FINALIZED/rewrite y backend notas sin cambios, ademas de source/provenance local. No afirma una verificacion independiente del ZIP SSR publicado ni browserPASS: esos gates posteriores siguen pendientes. El guardia opera en wrappers API de CLI; no afirma bloquear redirecciones/reintentos inferiores del transporte HTTP.

## Evidencia y condiciones restantes

19/19 PASS: negativo de todos los parametros runtime/env/bindings; plan equivocado; overlay SDK; actual CLI planner/converter; release+converter+pinTag reales; replay incierto/concurrente; tag equivocado; finalize incierto; observacion previa distinta; source/revision posterior distinta; milestones faltantes. Sin endpoint invocations, nube ni efectos financieros. La carga LibraryOnly/syntax no sustituye probar el launcher completo con pins reales.

Pendiente antes de Hosting: desplegar y verificar el callable notas; revisar escala efectiva; preparar input fijado; revision root del helper; Preflight/Stage; secuencia de ejecucion exclusiva; verificacion de ZIP SSR/activos versionados y smoke seguro. No sustituir estos gates por un CLI exit0.

## Compatibilidad y recuperacion

Frontend nuevo usa cursor nativo snapshot/updateTime y displayDate solo visual; no fallback Firestore al denegarse el callable. Cada ciclo visible hace head y hasta una pagina de sweep, luego5s; sin overlap. Historial cargado se revalida progresivamente, sin promesa de snapshot global instantaneo. Writers financieros permanecen intactos.

Sesiones abiertas conservan listener Firestore ascendente. Hosting NO obliga recarga y no demuestra clientes antiguos retirados. Este lote NO cambia Rules/Storage ni cierra el gap de linaje de esos clientes. Se mantienen accesos historicos existentes mientras se prepara su transicion separada.

Smoke permitido tras autorizar publicacion:

    node qa/scripts/remediation-download-browser-smoke.mjs --remote-readonly

POST Telegram interceptado con PDF sintetico, solo GET/HEAD al Hosting fijo, red externa bloqueada. Sin login real, capability real, lectura de notas productivas ni mutacion financiera. UX de notas se acredita con fixtures React/hook/SDK demo; no se atribuye a un falso smoke productivo autenticado.

Recuperacion preferida: fix hacia adelante conservando el callable y autorizacion. Rollback solo a version Hosting revisada compatible con /descarga/documento y POST Telegram, con rewrite/tag SSR correspondiente. Restaurar Hosting no revierte automaticamente SSR. El bundle previo vuelve a listener directo: evaluar explicitamente el riesgo de autorizacion, no llamarlo rollback neutro. No ocultar modal ni retirar capacidades. Mantener backend nuevo y restricciones; no borrar/recrear el callable para recuperar frontend.
