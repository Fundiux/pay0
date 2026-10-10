# Gate IAM sintetico antes de provisionar productor

Candidato local implementado, 2026-10-10. No nube, roles, bindings, tokens, documentos ni recursos
creados por esta tarea. Implementacion local autorizada y probada; ejecucion cloud pendiente de revision central.
Complementa SENTINEL-PRODUCER-PROVISIONING.md; no habilita listUsers ni el writer.

## Recursos y evidencia local

Reutilizar SA `pay0-observation-canary@pay-0-system.iam.gserviceaccount.com` y DB
`projects/pay0-sentinel-observe/databases/sentinel-observation`. El canario debe
seguir DISABLED, revision/traffic exactos verificados antes y despues. No cambiar
observer, sink, Cloud Run IAM, KMS, funcion listUsers ni desplegar otro servicio.
La SA ya posee logging.logEntries.create en source segun infra/canary.tf: el token
puede ejercer ese permiso aunque el programa este DISABLED. No se emitiran logs
sinteticos en esta prueba. No afirmar que el token solo permite Firestore.

Artefactos revisados: infra/canary.tf, verification.tf, main.tf y producer-infra;
scripts/verify-canary-runtime.ps1 y verify-runtime-iam.ps1. La evidencia historica
reporta negativas Firestore/Storage de la SA canary y cleanup confirmado. No se
reconsulto IAM efectivo en esta tarea; todos los preflights remotos siguen pendientes.

Rol existente source canaryRuntimeVerifier permite getAccessToken Y getOpenIdToken.
Rol aislado sentinelRuntimeVerifier permite solo getAccessToken, pero un rol custom
de proyecto no se puede conceder sobre una SA de otro proyecto. No modificar esos
roles compartidos ni dar TokenCreator. Propuesta minima: rol nuevo source
`canaryAccessVerifier` con SOLO iam.serviceAccounts.getAccessToken y rol aislado
`sentinelSyntheticReader` con SOLO datastore.entities.get/datastore.entities.list.
Si preflight encuentra un rol equivalente exacto ya existente, revisarlo y
reutilizarlo; no asumir existencia por nombre. Roles sin bindings no dan acceso.
[Alcance de roles custom](https://docs.cloud.google.com/iam/docs/roles-overview).

## Grants temporales y fronteras

1. Sobre ESA SA canary, miembro user del operador actual, rol access-only source,
   condicion request.time < timestamp(expiry fijo), ventana maxima 20 minutos.
2. Sobre proyecto aislado, SA canary, rol reader exacto, condicion conjunta:
   resource.name == 'projects/pay0-sentinel-observe/databases/sentinel-observation'
   && request.time < timestamp(el mismo expiry).

No grant sobre proyecto financiero para leer/escribir Firestore. El grant de DB
permite leer TODA la DB nombrada, no solamente fixtures; esto es una capacidad
temporal residual explicita. El script se limita a paths sinteticos. Si ese
alcance no es aceptable, no reutilizar canary; detener propuesta y revisar otro
entorno, sin crear automaticamente DB/SA para eludir el gate.

Firestore documenta condiciones por resource.name a nivel DB aplicadas en REST y
client libraries (la consola tiene una excepcion). get usa entities.get;
runQuery requiere get+list. No anadir databases.get para estas lecturas sin
transaccion. [Condiciones por DB](https://firebase.google.com/docs/firestore/manage-databases#configure_per-database_access_permissions),
[permisos por metodo](https://firebase.google.com/docs/firestore/security/iam#required_permissions_for_api_methods).

## Secuencia acotada propuesta

- Preflight solo lectura: pin revision DISABLED/100%traffic/no tags, SA identity
  uniqueId, API habilitada, DB existente, roles exactos, policies v3/etag,
  ausencia de grants propios y baseline efectivo DENIED antes del grant reader. Verificar
  operador puede crear/limpiar fixtures e IAM; no ampliar su IAM automaticamente.
- Journal privado ignorado con run UUID, expiry fijo, nombres de fixtures propios,
  tuplas de bindings y etapas; nunca tokens, policy completa o respuestas. Lock
  local exclusivo; no renovar expiry en reanudacion. Un journal abierto obliga a
  cleanup/revision, no iniciar otra ventana solapada.
- Operador crea UN fixture `sentinelIamReadProbes/<runUuid>` en la DB aislada con
  precondition exists=false y campos constantes schema=1/synthetic=true/probeTag.
  El tag aleatorio pertenece a esta prueba, no es root/actor/productor. Ninguna
  coleccion de incidentes, recibos o usuarios se toca. Registrar updateTime para
  limpiar por CAS. NO usar nombres reservados __...__.
- Agregar ambos bindings exactos con etag; confirmar presencia y permisos exactos.
  Mint access token para ESA SA, cloud-platform, lifetime=600s, sin delegates,
  solo en memoria. Verificar expireTime y respuesta; max7 intentos separados20s
  para propagacion mint, sin extender plazo. No ID token, run.invoker ni POST Run.
  [API de token](https://docs.cloud.google.com/iam/docs/reference/credentials/rest/v1/projects.serviceAccounts/generateAccessToken).
- Get fixture esperado200 y runQuery limitado2 con igualdad probeTag esperado un
  unico fixture. Validar identidad/campos exactos en memoria; salida solo enum.
  Usar SDK Firestore v1 real con credenciales gRPC de token en memoria, TLS y
  endpoint fijo. Harness local debe validar sslCreds y limites de respuesta de
  la version instalada ANTES de ejecucion real, sin ADC ni clave. No importar index.ts/handlers financieros.
  Gate de startup del artefacto compartido permanece separado, no acreditado aqui.
- Negativas de create/update/delete en fixtures propios, nunca documentos reales:
  create segundo nombre UUID con exists=false; update fixture con exists=true y
  campos sinteticos; delete fixture. Esperado403 por operacion. Si alguna acepta,
  FAIL inmediato y cleanup operador de ambos nombres exactos; no repetir probes.
  Esto prueba permisos separados, no solo una escritura fallida por precondicion.
- Otra DB existente: GET a ruta UUID inexistente en pay-0-system/(default),
  esperado403 sin leer body aun en200. Verifica aislamiento cross-project; NO
  demuestra por si solo condicion DB dentro del proyecto aislado.
- Para probar condicion DB sin crear otra DB: quitar binding reader positivo por
  CAS y confirmar ausencia; agregar la misma tupla reader con condicion que apunta
  a pay0-sentinel-observe/(default), misma expiry. Pedir GET y query del fixture
  EXISTENTE en sentinel-observation: esperado403. Puede haber propagacion, por
  ello hasta7 lecturas cada20s, sin remint ni ampliar expiry; nunca aceptar200 como
  PASS. Esa fase demuestra rechazo por mismatch de nombre sobre un recurso real.
  Quitar tambien este binding propio. No demuestra una segunda DB inexistente.
- (default) aislada historicamente ausente devolvio404. Reconsultar inventario;
  si sigue ausente, clasificar una eventual llamada404 como INCONCLUSIVE, nunca
  DENIED. No crear DB solo para fabricar un403. Policy Troubleshooter es evidencia
  modelada adicional, no sustituto del runtime.

## CAS, limites y recovery

Adaptar el patron existente de policy v3 + etag + edicion de miembro/rol/condicion
exactos. No reutilizar invocacion completa del verifier canary (ancla revision
antigua y agrega invoker/OIDC innecesarios). No restaurar policy snapshot entero.
En conflicto etag releer y fusionar SOLO la tupla propia, max3 intentos; conservar
miembros, bindings y condiciones ajenos. Finally retira condiciones positiva y
negativa, luego impersonacion, y verifica ausencia en lectura fresca. Si retorno
ambiguo tras setIamPolicy, intentar cleanup de tupla marcada antes del request.

Fixture cleanup compara identidad/tag/updateTime con el ACK de seed o writeResult propio persistido; usa esa version exacta como precondicion CAS. Nunca
borrar coleccion ni UUID ajeno, ni restaurar datos anteriores. Ante updateTime
inesperado registrar CLEANUP_UNVERIFIED, no borrar por fuerza. Si probe delete
aceptado inesperadamente, marcar fallo y confirmar ausencia, sin recrearlo.
Registrar cleanup separado de resultado probes; solo PASS si ambos verificados.
Token ya emitido puede seguir vivo hasta600s; retirar mint grant no lo revoca.
Retirada reader esta sujeta a propagacion; expiry fija constituye otra barrera,
no revocacion instantanea. Credenciales se descartan al terminar.

Presupuesto propuesto: ventana20min no renovable, tiempo operativo8min y reserve
cleanup2min; max120 solicitudes totales, SDK retries desactivados/configurados
explicitamente y contabilizados, 20sHTTP,256KiBrespuesta, cero logs payload. Las
esperas se cortan por expiry/budget. Si cantidad o tiempo se agota, cleanup y FAIL.
Roles custom quedan sin bindings, administrados por IaC separado si se aprueban;
no crear/borrar roles desde el verificador ni dejar infraestructura fuera de state.

## Implementacion candidata

- `services/pay0-sentinel-observation/scripts/verify-producer-read-iam.mjs`:
  importable sin I/O, default DRY_RUN y Execute explicito, CAS especializado,
  token en memoria, SDK real fijado por lockfile y rutas/enums limitados.
  ESM evita duplicar puentes PowerShell y pasar tokens por argumentos.
- `qa/scripts/remediation-producer-read-iam.test.mjs`: fakes de policy conflicts,
  respuesta perdida, expiracion, crash por fase, cleanup, denial vs404, token no
  output, seed CAS y rol extra rechazado. Tests SDK transporte sin red primero.
- IaC roles en verification-infra, root y state separados, solo despues de revision
  central; no modificar producer-infra ni crear SA productora para ensayar.

El helper contiene operaciones remotas pero no se ejecutaron. Execute sigue
pendiente de revision central. Default sin argumentos no hace red.

## Inspeccion y pruebas SDK locales

Firestore v1 firestore_client.js copia options al cliente google-gax. El cliente
fallback acepta options.auth (OAuth2Client/GoogleAuth); no se encontro contrato
Settings.authClient del SDK de alto nivel que justifique asumirlo. Ademas,
fallbackServiceStub usa node-fetch y parser de streams propios sin un limite de
bytes aportado por el caller en el contrato observado: no prometer 256KiB solo
por pasar una opcion inventada.

Alternativa preferida a probar: Firestore v1 nativo con sslCreds creado mediante
@grpc/grpc-js credentials.combineChannelCredentials(createSsl(),
createFromMetadataGenerator(...authorization bearer en memoria...)).
google-gax grpc.js:_getCredentials devuelve opts.sslCreds directamente antes de
ADC; createStub copia opciones grpc.*. Fijar grpc.max_receive_message_length y
grpc.max_send_message_length=262144, grpc.enable_retries=0, endpoint
firestore.googleapis.com:443 y CallOptions timeout20000/retry sin codigos.
El query debe cancelar al superar dos respuestas/documentos y plazo. El cliente
se cierra y la referencia al token se borra en finally. La suite ejecuta Firestore v1 y GAX reales con stub de transporte, bloquea ADC/red
y verifica credenciales, opciones, cancelacion y una sola llamada por error.
No demuestra enforcement de bytes por el transporte nativo sobre una conexion real.
No tokeninfo ni token en URL, private_key, archivo ADC o logs de errores SDK.

## Cierre local y limites pendientes

30 pruebas PASS (18 orquestador, 12 SDK), sin red, 2026-10-10. Incluyen CAS con
conflictos, respuesta perdida despues de seed/grant, stamp ajeno conservado,
recovery sin nuevos grants, rol ampliado/disabled rechazado, identidad equivocada,
respuesta HTTP sobredimensionada, query7/5, documento extra/malformado y cancelacion.
El SDK usa gaxServerStreamingRetries=true con retryCodes vacio/maxRetries0:
la ruta GAX antigua reintentaba streams pese a esas opciones; el harness detecto
ese comportamiento y ahora comprueba un solo intento, incluido error14.

La identidad del operador se comprueba via GET userinfo con fields=email,verified_email;
el token va solo en Authorization, nunca URL/tokeninfo. Scope insuficiente falla
antes de mutaciones sin ampliar OAuth/IAM automaticamente. Contrato oficial:
[OAuth2 discovery](https://www.googleapis.com/discovery/v1/apis/oauth2/v2/rest).
SA uniqueId queda fijado en journal y se vuelve a comprobar al final. Los permisos
del operador se consultan con testIamPermissions. No se afirma inventario completo
de IAM heredado de organizacion/carpetas: la baseline get/query DENIED mide permisos
efectivos relevantes antes de reader; logging residual conocido sigue explicito.
La revision debe ser exactamente pay0-security-canary-00006-6wv, DISABLED, sin tags.

Cada SDK call consume el mismo contador HTTP. Operacion permite80, cleanup120total;
SDK recibe min(20s,plazo operativo restante). Tres limpiezas con dos conflictos CAS
cada una usan21requests; dos fixtures usan max6:27 <=40 reservadas. Deadline global
puede impedir terminar cleanup; nunca convertirlo en PASS. Una fixture con seed
aceptado pero ACK perdido carece de version demostrada: se conserva y marca
UNVERIFIED. No se adopta updateTime recien leido para borrarla. Recovery usa
--execute --cleanup-journal <archivo privado propio> --operator-email <operador>
y token por stdin; no remint, nuevas ventanas ni probes. Lock residual tras crash
requiere verificar proceso muerto y retirar solo ese lock antes de recovery;
no robo automatico de locks. Journal .pending residual requiere revision manual.

Terraform fmt -check y validate PASS con CLI portable existente y google7.46.1
local; init -backend=false -input=false -plugin-dir=../infra/.terraform/providers.
Primer init no completo por permiso local de enlace; reintento local aprobado
completo, sin red. El lock usa el bloque google del root observer ya revisado,
no autentica de nuevo el binario offline. Dos roles stageGA, defaultdisabled,
prevent_destroy y sin bindings/runtime. No plan/apply. State/backups/tfvars/planes
estan ignorados; .terraform.lock.hcl intencionalmente versionable.

Sigue pendiente ejecutar el gate real tras revision y provision minima separada.
No productor autenticado/provisionado ni autoridad financiera nueva por estas pruebas.

## Revision central posterior

Root leyo helper, adapter SDK, ambas suites y Terraform completos. Corrigio la
validacion de expireTime para rechazar fechas no finitas; las pruebas negativas
UPDATE/DELETE ahora fijan currentDocument.updateTime del seed confirmado, sin
sobrescribir una version concurrente. El adapter no puede certificar DENIED ni
NOT_FOUND si ya recibio un documento antes del error del stream.

Suite final: 35/35 PASS (20 orquestador y 15 SDK), sin red. Incluye error transitorio
14 en get y query con un solo intento, expiracion invalida, precondicion de version
y respuesta parcial seguida de status 7/5. No cambia limites, grants ni politica
productiva. La verificacion cloud y provision separada de roles siguen pendientes.
