# Despliegue selectivo de notas: verificacion y ejecucion

Estado vigente: helper ROOT revisado y commit7392bf5. StageDryRun99418 y Preflight76946 PASS. Execute91921 fallo en el ultimo predeploy antes de plan/create; entorno restaurado. Retry93477 termino exit0 con HEAD9a729e3: revision listclientdispersionnotes-00001-mug, sourcegeneration1791691748273508, receipt hasta INVOKER_CREATED y entorno restaurado exacto. Fetch independiente85522e completo seis lecturas y guardo ZIP/metadata, pero comparacion local fallo: diagnostico offline pendiente, sin proof PASS ni Hosting aprobado. No repetir create. Endpoint unico listClientDispersionNotes, pay-0-system/us-central1.

## Contrato y pines

scripts/deploy-dispersion-notes.ps1 acepta LibraryOnly, Preflight (default), StageDryRun y Execute explícitos. Requiere ExpectedHead, ExpectedEnvHash, ExpectedProvenanceHash, ExpectedSourceHash, ExpectedCliHash, ExpectedWrapperHash, ExpectedManifestFile y ExpectedManifestHash. Los hashes son SHA256 de bytes exactos salvo ExpectedSourceHash: SHA256 de JSON.stringify(report.sourceInputs). ExpectedCliHash es SHA256 de JSON.stringify de la lista ordenada CLI_FILES con hashes individuales, calculada por cliInfo(); versión exacta15.3.1. No copiar hashes de un candidato anterior.

El manifiesto normal347 debe estar en .firebase/internal-bundle-manifests de integración y coincidir con el sourceInputs del bundle instalado. Su SHA fija la referencia revisada. Antes de ejecutar deben pasar comparación completa normal/bundle347, runtime, sourcemap, WASM, SDK notas mixtas/race, HTTP256MiB/concurrency1, policy y packer real. Esta herramienta no sustituye ninguno.

Preflight valida HEAD limpio, provenance/hash de fuente y outputs mediante verifyInstalled, CLI y wrapper compartido; consulta únicamente metadata GCF del nombre exacto y exige404 autenticado.401/403/5xx/transporte no significan ausencia. StageDryRun sólo valida/stage/restaura localmente y no consulta metadata remota. Execute repite ausencia y validación bajo lock privado antes del CLI.

## Entorno y CLI

La clausura local de noteReads abarca10 TS y no lee env/secretos. Sin embargo, el índice completo registra PAY0_FIREBASE_WEB_API_KEY con defineString/default vacío. En CLI15.3.1 resolveParams rechaza nonInteractive con parámetros sin dotenv incluso antes de procesar el default. Se conserva exactamente una clave pública de configuración previamente revisada; no se despliega TELEGRAM_DOWNLOAD_TRANSPORT_MODE. Se rechazan otros dotenv/keys ambiguos. Backup CreateNew privado, CAS de bytes y restauración exacta usan la biblioteca ROOT ya existente; conflicto concurrente preserva el archivo ajeno y backup, sin sobrescribir.

El wrapper compartido de integración genera un proceso Node nuevo sin reenviar execArgv. Por eso --require en su padre no protegería el CLI. El launcher nuevo arranca el CLI fijado directamente con --require del guard y los argumentos exactos deploy --project pay-0-system --only functions:listClientDispersionNotes --non-interactive. No cambia firebase.json ni omite predeploy, build, discovery o packer. Conserva variables de uso/configuración heredadas; elimina DEBUG, NODE_OPTIONS, FUNCTIONS_DISCOVERY_TIMEOUT y controles viejos del guard. Configura discovery por archivo temporal y BUNDLED_V1 sólo en el proceso, nunca dotenv/runtime. Los children discovery/build no heredan --require. El hash del wrapper compartido permite detectar cambios que exijan reevaluar esa equivalencia.

El índice registra además secretos de otras familias: CLI resuelve metadata de esos parámetros antes del filtro de endpoints. No significa bindings secretos en notas ni autorización para leer valores o crear secretos. Con --non-interactive los secretos ausentes/inhabilitados abortan. No se suprimen esos controles.

## Creación exclusiva

Se valida Fabricator.applyPlan: una creación exacta, cero update/delete/skip, GCFv2 callableTrigger explícito, sin httpsTrigger ni otros triggers. Inmediatamente antes del API create se revalidan los pines y el body:60s/256Mi/CPU1/concurrency1/min ausente o0/max no declarado, sin VPC/secretos, identidad default prevista, entorno de una clave con hash fijado. GCFv1 create, GCFv1/v2 update/delete y Run updateService/setInvokerUpdate están interceptados para fallar. Se permite setInvokerCreate solamente para el nuevo servicio exacto y ['public']; sigue siendo el callable autenticado por su lógica backend. No se añade un principal distinto.

El POST create de GCF lleva functionId y no se convierte en update. Si otra operación crea el endpoint entre404 y POST, el conflicto aborta y no hay retry automático del helper. El guard rechaza una segunda entrada al wrapper create, incluidas las reentradas del executor después de un resultado incierto. Esto no acredita que se haya interceptado cada transmisión HTTP interna. El recibo privado debe contener exactamente GUARD_ACTIVE, PLAN_CREATE_ONLY, CREATE_DISPATCHED, CREATE_ACCEPTED, INVOKER_CREATED y CLI exit0. El recibo no sustituye postflight.

## Postflight y máximos

La herramienta exige ACTIVE/Node22/configuración exacta/env y source bucket/object/generation esperados. Obtiene además metadata privada de Cloud Run servicio/revisión para revisión independiente. Ningún resultado del helper afirma Hosting aprobado: todos devuelven hostingApproved=false.

maxInstances está sin declarar en el manifiesto. No inferir20 por otros endpoints ni100 por el mensaje CLI de cuota. El máximo GCF observado se registra como REQUIRES_REVIEW, incluso ausente; revisar conjuntamente service.scaling, template.scaling y revision.scaling, CPU/memoria/concurrency, min efectivo0, Ready y tráfico100%/sin tags alternos. No fijar un override para hacer pasar el gate. Un valor desconocido o discrepante mantiene pendiente Hosting y requiere decisión concreta.

Después, GET sólo lectura del ZIP exacto de buildConfig.source.storageSource con generación fijada. Mantener ZIP privado; validar CRC, rutas, ausencia de traversal, y hashes de todas las entradas esperadas (bundle, map, .debug, assets, fuente y manifests), comparando contra la provenance revisada y el dotenv staged de una clave. Reutilizar el algoritmo de verify-functions-upload-artifact sin confundir su ZIP local con el objeto publicado. No extraer .env ni imprimir valores. Releer revisión/generación al terminar para detectar drift. Independiente debe registrar Ready, tráfico/configuración y bytes desplegados; aún no implementado como PASS automático.

## Pruebas locales y límites

Resultado local vigente:11/11 suites PASS. Parser PowerShell y sintaxis Node PASS. Hubo un primer fallo de fixture postflight por construir hashtable en lugar del PSCustomObject de Invoke-RestMethod; se corrigió sólo la representación sintética y se repitió PASS. No se modificó el criterio de entorno. Comando: node --test qa/scripts/remediation-dispersion-notes-deploy.test.cjs: fakes de plan/guard/API/IAM/entorno/recibo y PowerShell LibraryOnly con CAS éxito/fallo/conflicto. Sin red, deploy, IQ, mensajes ni endpoint real. Estado original de preparacion: faltaban StageDryRun, preflight, despliegue y postflight. La cronologia vigente consta arriba y en HANDOFF; los tests locales no sustituyen verificaciones remotas.

La guardia no promete una transacción global sobre APIs de Firebase. El CLI conserva sus validaciones/aseguramiento de infraestructura y lecturas de metadata; la exclusividad aquí cubre mutaciones de Functions y Run inspeccionadas en CLI15.3.1. Cualquier versión/hash nuevo requiere revisión. Rollback no debe restaurar reglas o lectores que eludan autorización; no hay endpoint anterior que restaurar. Ante fallo, conservar el consumidor publicado actual hasta hotfix compatible, sin eliminar funcionalidad ni borrar datos.


## Corrección tras revisión central: contrato CLI real

La primera guardia exigía httpsTrigger y sus fakes repetían esa suposición errónea. Se corrigió a callableTrigger sin httpsTrigger y se exige el label API deployment-callable=true. El caso11 usa la captura normal347 aprobada (archivo privado notes347-normal-33e7a98.json; SHA9569510897877e74c33312123518af575c73c2a59566b2d8e6ed498f8989f9a5, manifiesto e4c0f5e0ec14a4c7ef2fae0495ccc7e3ae4b3850545aec283255fc12e346e63b). Falla con prerrequisito explícito si falta; no busca fuente remota ni sustituye una captura distinta.

Ejecuta módulos originales CLI15.3.1: toBackend, resolveCpuAndConcurrency, createDeploymentPlan, functionFromEndpoint y Fabricator.applyPlan/createV2Function. Sólo adaptadores externos GCF create/poller/IAM son falsos; sockets/http/https/fetch están bloqueados. Verifica CPU1/con1, max null, label callable y rama invoker public del servicio exacto. El planner real incluye endpointsToSkip:[]; ningún ajuste de shape fue asumido. Configuración de CLI aislada en directorio temporal XDG y cleanup, sin acceder a preferencias/credenciales personales. Primer intento del nuevo caso abortó por EPERM al buscar esas preferencias; se aisló XDG, sin relajar la prueba.

Se amplió el fingerprint CLI para incluir planner/build/prepare/params/env además de fabricator/API/entry/package, porque esos módulos determinan el contrato comprobado. Recalcular y revisar ExpectedCliHash; un pin antiguo abortará.

### Estabilidad de provenance

Inspección del instalador: sus bytes contienen sólo schema/mode/sourceInputs/outputs ordenados; no timestamps, UUID, journal ni ruta del candidato. Se reconstruyó localmente la provenance desde el único report completo disponible con exactamente el mismo sourceInputs; coincide byte por byte con la instalada, SHA ebaeebe747cc428026569b02a4eb1ab4f6088f8583d91aebf3aa01498747f907. Esto acredita el algoritmo y un build; NO acredita tres builds ejecutados. No se corrieron nuevos builds en esta revisión. El guard conserva el pin original y abortará antes de create si cualquier predeploy produce bytes distintos: repetir compilación no autoriza actualizar el pin automáticamente. Tres predeploys idénticos deberían conservarlo por construcción, pero su evidencia empírica sigue pendiente de la secuencia central.


### Alcance preciso de reintentos CLI15.3.1

Inspección estática: cloudfunctionsv2.createFunction llama Client.post con queryParams.functionId y sin retryCodes. apiv2 configura capacidad de retry, pero operation.retry sólo se invoca cuando retryCodes incluye el status. En esta llamada no ocurre; errores de fetch/parse rechazan directamente.401 puede refrescar token, sin segundo fetch automático por esa rama. QueueExecutor externo admite429/409/503 y volvería a entrar en el wrapper, donde la segunda llamada está bloqueada.

El guard no intercepta node-fetch ni su seguimiento de redirects predeterminado;307/308 pueden conservar POST. No afirmar un único POST en todas las capas ni que los reintentos internos de transporte estén interceptados. La garantía implementada es una entrada permitida al API wrapper, sin conversión a update y con identidad/configuración fijadas. No se cambió el transporte ni se ejecutó una solicitud real para esta revisión.
