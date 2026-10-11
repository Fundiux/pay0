# Lectura autorizada de notas de dispersión — candidato, sin publicar

Fecha: 2026-10-10. Base aislada `2613559`; rama `feature/dispersion-notes-read-20261010`. No incluye el experimento de reglas fallido `e3ea3dd` (707 casos: 658 PASS / 49 FAIL / 68 agotamientos). No modifica reglas, financiación, índices, integración ni producción.

## Lote 1 y contrato

`listClientDispersionNotes` es un callable nuevo, lectura de `clientDispersions/{id}/notas`. Autentica el UID real, carga perfil y padre en transacción, aplica `assertAuthorized(wallet.dispersiones)` antes de cualquier bypass de rol, exige root del padre y preserva `assertDispersionFundingOwner` para USER. Superadmin, titular USER y propietario documental conservan sus ramas. Los demás requieren `viewBasic` del resolver canónico actual; los dos alias de cliente distintos conservan OR. El resolver verifica perfiles, restricciones, permisos, vigencia y linaje hasta 16 ancestros; la ausencia histórica de procedencia sigue su contrato canónico abierto, sin inventar padres.

Consulta descendente `createdAt`, ID documental descendente, 50 por defecto/100 máximo y una fila adicional para determinar continuidad. Cursor versión 1 con padre, segundos, nanosegundos e ID: es posición pública, nunca autoridad. Se valida forma/rango y la existencia/fecha de su nota bajo el padre autorizado. No hay secreto ficticio, backfill ni IDs de otra colección. La respuesta permite sólo campos de presentación de notas; no devuelve el padre ni payload financiero. Una fecha histórica malformada produce error explícito, no una nota omitida silenciosamente; documentos sin createdAt conservan la exclusión que ya hacía orderBy.

Tras consultar, una segunda transacción revalida toda la autoridad y compara root, alias, propietarios y funding del padre antes de devolver. No hay caché autorizante entre transacciones/peticiones. Esto limita carreras entre consulta y entrega; no promete atomicidad entre la última lectura y la recepción de red ni revocación retroactiva de datos ya entregados.

Presupuesto estructural conservador: cada alias <= 50 lecturas documentales del resolver con 16 delegados y terminal; dos alias+perfil+padre <= 102 por autorización. Primera transacción añade <= 101 notas y 1 ancla; segunda <= 102. Hasta 306 lecturas por ejecución sin retry; maxAttempts 3 en cada transacción da un techo conservador de 918. Ramas directas gastan mucho menos. No se reduce arbitrariamente el límite de linaje para cumplir este presupuesto. Las pruebas verifican el límite canónico y que denegaciones previas no consultan notas.

## Interfaz y continuidad

El modal wallet usa wrapper y hook, sin onSnapshot directo para notas. Expone «Actualización automática cada 5 s» y «Actualizar». Polling sólo con modal y documento visibles; foco, reaparición y envío propio refrescan. Una petición a la vez, refresco pendiente coalescido, backoff de fallos hasta 60 s y errores fijos en español sin rawlogs. La etiqueta describe el cambio respecto del realtime anterior.

«Cargar anteriores» recorre todas las páginas, no sólo las últimas 50. Mantiene historial por ID y orden por timestamp+ID. Si llegan más de 50 notas entre refrescos, conserva cursores separados de los intervalos nuevos y del historial anterior para no saltar huecos ni reiniciar el avance en cada poll. Las respuestas tardías de otra identidad/root/padre se descartan; la vista oculta síncronamente el snapshot de otra clave. Denegación elimina todas las páginas, cursores y polling; reintento explícito puede recuperar autoridad. Un ancla borrada/modificada provoca failed-precondition y el siguiente refresco reinicia el recorrido conservando las notas ya cargadas.

El botón «Recargar historial desde el inicio», deshabilitado mientras hay petición, vacía páginas/cursores por acción consciente y vuelve a la primera página; no dispara lectura automática de todo el historial. La generación del controlador descarta cualquier respuesta anterior en vuelo. Los datos ya cargados se conservan ante fallos temporales, con aviso visible. No se promete retirar automáticamente notas antiguas borradas fuera de la ventana consultada; no existe listener sobre todo el historial. Los borrados dentro del rango reciente sí se reconcilian con cada respuesta; fuera de ese rango sólo el recorrido explícito recupera el estado actual. Una denegación actual sí limpia todo. Esta diferencia debe aceptarse antes del rollout; ningún fallback directo a Firestore elude una denegación server.

## Orden de publicación y gates pendientes

1. Revisar este lote y verificar builds Functions/frontend, política canónica, contratos sintéticos y consulta real en emulador (índice/orden/tx).
2. Añadir exclusivamente el export `listClientDispersionNotes`: manifest esperado 346→347, con los 346 nombres existentes intactos. No se han modificado gates globales todavía. No hay ruta nueva ni cambio de política JSON.
3. Publicar backend y verificar positivos/denegados antes de Hosting. Publicar consumidor después; mantener compatibilidad de bundles abiertos.
4. Antes de retirar la rama directa, resolver versiones antiguas/clientes alternos: Hosting PASS no obliga actualización ni demuestra ausencia de consumidores. No existe fallback/reload universal que legitime cortar ahora. Esta entrega sola no cierra S10 ni permite desplegar el Rules fallido.

No hay índices nuevos declarados: se reutiliza el índice single-field descendente de createdAt con orden documental descendente; verificar consulta emulada y configuración real antes de release, sin deducir existencia productiva a partir del fake.

## Validación local

- Backend 25 PASS: callback real, authGuard/resolver/policy reales con infraestructura falsa; 125 notas paginadas, ties, DTO acotado, actor/root/grantor/restricción/permisos, revalidación postconsulta, aliasOR, USER, cursores forjados y límite de ancestros.
- UI 15 PASS: fakeclock sin sleeps; historial de 125 y salto de 125 (total 250), orden/deduplicación, polling de 5 s/visibility/focus, coalescencia, stale descartado, denegación elimina páginas y backoff.
- Functions final PASS (sesión28506, después de compatibilidad de alias); verificador de política PASS (`cached-selector`).
- Frontend final PASS, 47 páginas (sesión97749, exit0), incluido botón de recarga explícita.
- Sin llamadas a proveedores, Firebase remoto, mensajes ni despliegues. Consulta Admin SDK real PASS; pendiente review central para commit. Sin autorización de release.
## Volumen del polling y decisión de no inventar watermark

Conteos de llamadas lógicas a lectura en pruebas (no estimación garantizada de facturación): rama directa/USER/superadmin 55 por poll de 50, delegado simple 65, página posterior 66 por validación del ancla. Con 16 delegados y un terminal, un alias 155; dos alias completos 255 sin retry. Con modal continuamente visible, 5 s produce hasta 12 consultas/minuto / 720 por hora: 39.600,46.800,111.600 o 183.600 lecturas lógicas/hora respectivamente. Dos transacciones pueden reintentarse hasta 3 veces cada una; el techo conservador con página UI de 50 es 765 lecturas/poll y 550.800/h si todos los polls alcanzaran retries máximos; limit API de 100 eleva el techo a 918/petición. Visibilidad, ausencia de overlap y backoff reducen tráfico real; no eliminan el coste. Es un intervalo provisional explícito, no realtime ni optimización de consumo cerrada.

No existe un campo mantenido por todos los writers que certifique cambios de la colección. `addClientDispersionNota` agrega la nota y después actualiza `hasUnreadMsg`/`updatedAt` del padre en otra escritura; no mantiene una versión atómica y completa de notas. Un notModified basado sólo en la fecha última ocultaría cambios/borrados; un hash de la página reduciría bytes pero no esas lecturas. No se cambian writers financieros ni se presenta esa falsa optimización. Antes de generalizar a otras familias, revisar frecuencia/consumo observado y un contrato de invalidación completo.
## Tamaño de respuesta legacy — estado inicial del lote 5d735a0

El escritor manual actual limita text a 2000 caracteres; esto no demuestra que los documentos históricos ni todos los emisores automáticos tengan ese mismo límite. El DTO permite únicamente campos de presentación, pero no trunca texto ni nombres, y la paginación por número de documentos no establece un techo de bytes serializados. No se infiere un límite de autor a partir de su uso visual. Antes de publicar debe verificarse el tamaño máximo del payload con fixtures representativas y, si se autoriza, inventario agregado mínimo; definir entonces paginación por bytes compatible o error explícito recuperable. Este lote no cambia writers financieros ni inventa/trunca historia para ocultar el riesgo. El gate de 125 notas sintéticas pequeñas no prueba el peor tamaño de respuesta legacy.
Compatibilidad de alias: noteReads admite strings, números y booleanos mediante la misma expresión `String(value || "").trim()` del cleanId canónico privado, antes de deduplicar. 123 y true pueden resolver los documentos con esos IDs; 0 y false son vacíos. Objetos/listas se rechazan explícitamente; no se invoca su conversión a texto para fabricar un ID. Los alias distintos conservan OR, incluida la segunda rama string normalizada cuando la primera primitiva no concede acceso. No se presume existencia histórica ni se migra metadata. Cursor y dispersionId de entrada continúan estrictos, sin trim silencioso.
## Evidencia Admin SDK real: fallo de fixture conservado y gate final PASS

Sesión 19625: 25 PASS / 1 FAIL, emuladores cerrados y sin listeners en 18246/19246/14446/14546. La consulta real devolvió 125 IDs distintos y completos, pero la expectativa de orden asignaba 1 ns a algunos timestamps. Firestore persiste precisión de microsegundos y redondea precisión adicional; esa fixture terminaba con todos esos nanos en 0. Referencia primaria: [Tipos de datos de Firestore](https://firebase.google.com/docs/firestore/manage-data/data-types). Se conserva el log privado `.firebase/remediation-temp/notes-sdk-gate.log`; no se cambió el producto ni se relajó el orden esperado. Fixture corregida a 1000 ns, con assert explícito de readback antes de paginar. La primera ejecución no alcanzó la prueba de revocación en segunda transacción; no se declara PASS por ella. Segundo gate completado como se detalla debajo.
Sesión 14311 final: 26/26 PASS (25 pruebas con infraestructura falsa y una con Admin SDK real/emulador), sin skips; proceso de prueba y runner exterior exit0. 125 notas/125 IDs distintos, orden por segundos/microsegundos e ID, lectura persistida exacta, cursor con padre ajeno o fecha alterada rechazado, ancla eliminada rechazada, revocación real del otorgante entre primera y segunda transacción denegada. La petición siguiente no consultó notas. Log privado `.firebase/remediation-temp/notes-sdk-gate-microseconds.log`; marcador `NOTES_REAL_SDK_PASS notes=125 distinct=125 authorityRace=denied cloud=0 rulesVerdict=NOT_TESTED`. Shutdown completo y comprobación de cero listeners en 18246/19246/14446/14546. Reglas deny-all privadas; Admin las omite deliberadamente: no es un PASS de Rules ni un cierre de su brecha de linaje.

Comandos reproducibles desde el worktree aislado:

```powershell
node --test qa/scripts/remediation-dispersion-notes-read.test.cjs qa/scripts/remediation-dispersion-notes-ui.test.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File qa/scripts/remediation-dispersion-notes-emulator-run.ps1
node scripts/verify-authorization-policy.mjs
```

El primer comando deja el caso SDK real explícitamente skipped salvo opt-in del runner. El runner rehúsa credenciales y proyectos no-demo, exige 127.0.0.1:18246, crea config/reglas sólo en directorio ignorado y restaura su entorno. Functions final28506 y frontend final97749 PASS, política y diff-check PASS. No cambiar expectativas globales del manifest ni publicar antes de la revisión del lote; la integración sigue sin este endpoint.
## Lote de paginación por bytes (posterior a 5d735a0, candidato local)

El presupuesto de aplicación es 8 MiB para el JSON UTF-8 completo de respuesta callable `{result:{items,nextCursor}}`; no es un máximo histórico observado. Se acumulan sólo DTO de un prefijo ordenado y se consultan lotes internos de 4 u 8 documentos para comparar coste/memoria. El cliente no puede elevar estos límites. La página termina por cantidad o bytes; su cursor identifica la última nota entregada, nunca la última leída. Las filas leídas sobrantes se vuelven a consultar en la siguiente página. No se retienen listas de snapshots de todas las consultas. La segunda autorización completa sigue ocurriendo antes de entregar.

Firestore limita cada documento a 1 MiB y cada valor a 1 MiB menos 89 bytes ([cuotas oficiales](https://firebase.google.com/docs/firestore/quotas)). El DTO no duplica campos; el escape JSON de una cadena puede multiplicar hasta seis veces sus bytes. Los nombres del DTO son fijos y el ID/cursor están acotados: 8 MiB permite conservar íntegra una nota legal incluso con expansión por caracteres de control. La prueba real prepara notas sintéticas cercanas al máximo (1.048.400 caracteres de control), comprueba texto completo y recorre todas sin saltos. Un valor sintético no almacenable que supera el transporte produce error explícito, nunca truncado. El límite HTTP no sustituye este presupuesto: memoria de SDK, buffers, DTO y JSON puede agotarse antes que el límite de respuesta ([cuotas de Functions](https://firebase.google.com/docs/functions/quotas)).

No se introduce watermark ni `notModified`. Con 50 notas pequeñas se siguen leyendo 51 documentos, pero cambia el número de consultas: 13 con lote4, 7 con lote8. Las autorizaciones no se cachean entre peticiones. En páginas cortadas por bytes puede haber lecturas sobrantes hasta el tamaño del lote; son coste explícito, no filas omitidas. El contador agregado representa llamadas y documentos en estas pruebas, no una factura garantizada.

La UI conserva contrato y texto. Sus pruebas ahora fuerzan páginas de 1, 2 y 7 notas: completa historial, rellena huecos entre polls y elimina sólo el rango íntegro efectivamente recibido. Un borrado fuera de ese rango sigue requiriendo recarga consciente desde el inicio; limitar bytes no equivale a reconciliar toda la colección. UI 18/18 PASS, sin cambios del hook/producto.

Medición SDK ejecutada: procesos Node nuevos que cargan producto compilado, sin TypeScript ni mapas falsos de fixture en heap; compara lotes4/8 con 50 notas normales, nueve notas grandes y autoridad de 16 ancestros. Mide RPC, documentos, latencia local, RSS/heap y high-water RSS. Es evidencia sintética por proceso, no garantía de concurrencia o memoria productiva. No se interpreta Admin bypass de deny-all como PASS de Rules.
### Resultados locales de bytes y recursos (gate de publicación todavía abierto)

Functions build67453 PASS. Gate64443:33/33PASS, prueba125notas+revocación real en segunda transacción, comparación4/8 y extremosID1500bytes; inner/outer exit0. Log privado `notes-sdk-byte-comparison.log`. Se conserva lote4 porque lote8 redujo RPC pero no mejoró el escenario de expansión y consumió más memoria. Son mediciones locales individuales, sin inferencia estadística de latencia productiva.

| Escenario | Lote | Páginas | Query RPC | Documentos leídos | Tiempo local ms | High-water RSS MiB |
|---|---:|---:|---:|---:|---:|---:|
| 50 pequeñas | 4 | 1 | 13 | 65 | 1005 | 96,77 |
| 50 pequeñas | 8 | 1 | 7 | 65 | 1060 | 92,30 |
| 9 grandes con escape6x | 4 | 9 | 9 | 164 | 4032 | 196,77 |
| 9 grandes con escape6x | 8 | 9 | 9 | 178 | 4030 | 223,57 |
| 9 grandes ASCII | 4 | 2 | 4 | 39 | 1517 | 125,66 |
| 9 grandes ASCII | 8 | 2 | 3 | 39 | 1119 | 129,02 |
| 50 pequeñas +16ancestros | 4 | 1 | 13 | 155 | 2359 | 100,12 |
| 50 pequeñas +16ancestros | 8 | 1 | 7 | 155 | 2226 | 103,46 |

Mayor envelope:8.387.839bytes<8.388.608. Se persistieron18notas de1.048.400caracteres cada una (9ASCII y9controles) en el emulador; se recuperaron todas íntegras, sin saltos. La página ASCII contiene8notas y la siguiente1; la expansión devuelve1porpágina. Los casos de IDs extremos de1500bytes, timestamps iguales y nanosegundos999999000 verifican orden UTF-8 y cursor exacto. Lecturas sobrantes explican164vs178 documentos en controlchars. No se mantienen snapshots acumulados en código; RSS incluye retención efectiva de SDK/GC durante el recorrido.

Gate98831 posterior:33/33PASS, ampliado a procesos nuevos que cargan el `index` real con347endpoints y ejecutan `listClientDispersionNotes.run` real, lote4. El guard de sockets/DNS sólo admite127.0.0.1:18246, fetch deshabilitado; cero logs de inicialización. Log privado `notes-sdk-full-index-memory.log`. BaselineRSS tras cargar index92,3–92,8MiB. High-water:123,39MiB típico,182,89MiB expansión,156,58MiB ASCII y125,05MiB linaje16. Las diferencias entre procesos reflejan GC/carga y no prueban que más código use siempre menos memoria. La medición incluye serialización JSON, pero no el proceso completo de Functions Framework HTTP ni buffers de salida de ese servidor.

Ambos gates terminaron emuladores y comprobaron cero listeners18246/19246/14446/14546. UI18/18PASS, política canónica PASS, diff-check PASS. Sin cambios frontend producto; se conserva su build47páginas previo. Ninguna lectura remota, modelo/proveedor ni despliegue. Admin bypass no certifica Rules.

**Propuesta posterior a98831:** fijar concurrency1 y conservar256MiB; la concurrencia implícita no permite extrapolar las mediciones seriales. Esa propuesta exigió el gate HTTP auténtico que se registra debajo, antes de aceptar el contrato local. No se elevó silenciosamente a512MiB. Esta es evidencia Windows, no observación CloudRun/Linux. Docker no está disponible y `wsl --list` confirma WSL no instalado; no se instaló infraestructura para la prueba. La lectura sigue sin cierre de compatibilidad de clientes antiguos ni autorización de publicación.
### Contrato final local: HTTP auténtico, concurrencia 1 y 256 MiB

El candidato ahora declara explícitamente `concurrency: 1`, conserva `memory: "256MiB"` y timeout de 60 s. `index.ts` sólo fija globalmente la región; no hereda un maxInstances ni una concurrencia global. Este lote no inventa capacidad ni modifica otros endpoints. El manifest del candidato sigue siendo 347 (346 previos más notas); no modifica las expectativas del release independiente de 346.

Build Functions 15463 PASS tras el cambio de concurrencia. Gate 55742: 33/33 PASS, sin skips, prueba y runner exit0, incluyendo las comparaciones previas y cuatro procesos nuevos de HTTP. Se carga el index completo, se comprueban sus 347 endpoints y se entrega el callable original a `getServer` de Functions Framework 5.0.5. Así se ejecutan el parser HTTP, wrapper del Framework, verificación Auth del SDK, callback real, encode y escritura de respuesta. No se usa `.run` en estos cuatro escenarios. Un cliente Node separado envía POST a un puerto efímero de 127.0.0.1: sus buffers no contaminan el RSS del servidor. La única autoridad simulada es la verificación externa del token: nonce aleatorio local, UID sintético fijo; el perfil, root, permisos y linaje se leen por Admin SDK real al emulador. Las verificaciones Auth coinciden con 1/9/2/1 peticiones en cada escenario.

Se intercepta transporte saliente antes de SDK/index: sólo Socket/DNS a127.0.0.1:18246, fetch rechazado. No hay tokens reales. Logs del SDK se descartan sin conservar contenido y sólo se cuentan; no se imprimen nonce, headers ni payloads. El servidor se mide también antes/después de `response.end`, además del muestreo y el high-water del proceso. Cada escenario cierra conexiones/servidor/Firestore/app y termina su proceso; al final tampoco hay listeners en los cuatro puertos del emulador.

| HTTP real, lote 4 | Páginas | Query RPC | Documentos | Tiempo local ms | Baseline RSS MiB | High-water RSS MiB |
|---|---:|---:|---:|---:|---:|---:|
| 50 pequeñas | 1 | 13 | 65 | 4791 | 101,49 | 130,02 |
| 9 con escape6x | 9 | 9 | 164 | 7349 | 102,30 | 184,64 |
| 9 ASCII grandes | 2 | 4 | 39 | 5158 | 101,65 | 162,81 |
| 50 +16ancestros | 1 | 13 | 155 | 5682 | 101,98 | 133,96 |

Los asserts exigen RSS muestreado y high-water por debajo de256MiB. El máximo de HTTP fue184,64MiB; el máximo entre todos los procesos con lote4, incluido el módulo aislado y variación de GC entre corridas, fue205,96MiB. Quedan50,04MiB respecto al presupuesto declarado en esta evidencia, sin justificar512MiB. Concurrencia1 evita extrapolar estos resultados a80 respuestas simultáneas. Los tiempos incluyen el cliente nuevo y varían por carga local; no son SLA, no demuestran intervalo productivo de5s y el controlador sigue sin solapar peticiones.

La prueba utiliza Windows/Node22.23.2 y Framework5.0.5; no afirma igualdad con la imagen Linux/versión inyectada por CloudRun ni garantiza estadísticamente todos los historiales. Antes de release, revisar el artefacto final integrado y observar memoria/latencia con el rollout autorizado. Este contrato local no cierra clientes antiguos, Rules ni linaje histórico abierto. No hubo deploy.

Fuente del Framework y mecanismo de servidor: [GoogleCloudPlatform/functions-framework-nodejs](https://github.com/GoogleCloudPlatform/functions-framework-nodejs/blob/v5.0.5/src/server.ts). Dependencia de prueba instalada únicamente en `.firebase/remediation-temp/notes-http-framework`, ignorado, sin scripts, sin modificar manifiestos/lockfiles del producto ni sus junctions. Lock privado SHA-256 `03f6510a0669cf02e507c6ea6bf42058410b80e778df273d1b7e531d84b49081`. La descarga de esta dependencia pública es independiente del gate, cuyo transporte externo queda bloqueado.

Para reproducir en un checkout sin ese paquete, preparar primero el directorio privado ignorado y un package.json privado, e instalar `@google-cloud/functions-framework@5.0.5` con `npm install --prefix <directorio-privado> --cache <cache-privado> --ignore-scripts --no-audit --no-fund --save-exact`. No instalar en los node_modules del producto. Ejecutar build Functions antes del runner: los workers de medición usan el JS compilado, mientras que las pruebas de autorización usan TS real con infraestructura falsa. El runner no instala dependencias ni accede al registro durante sus mediciones.
### HTTP gate prerequisites

El runner comprueba antes de iniciar emuladores la versión instalada, URL pública e integridad npm del Framework; si falta o difiere, falla con instrucciones para esta sección. No descarga dependencias automáticamente. Preparación reproducible desde el worktree (sólo paquete privado, sin junctions del producto):

```powershell
$notesGateRoot = Join-Path (Get-Location) '.firebase/remediation-temp/notes-http-framework'
git check-ignore --quiet -- $notesGateRoot
if ($LASTEXITCODE -ne 0) { throw 'El directorio debe estar ignorado' }
[IO.Directory]::CreateDirectory($notesGateRoot) | Out-Null
if ((Get-Item -LiteralPath $notesGateRoot).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'No instalar en una junction' }
$notesGateManifest = Join-Path $notesGateRoot 'package.json'
if (-not (Test-Path -LiteralPath $notesGateManifest)) {
  [IO.File]::WriteAllText($notesGateManifest, '{"name":"pay0-notes-http-local-gate","version":"1.0.0","private":true}', [Text.UTF8Encoding]::new($false))
}
$notesGateNpmrc = Join-Path $notesGateRoot '.npmrc'
[IO.File]::WriteAllText($notesGateNpmrc, '', [Text.UTF8Encoding]::new($false))
npm install --prefix $notesGateRoot --cache (Join-Path $notesGateRoot 'cache') --ignore-scripts --no-audit --no-fund --save-exact --registry https://registry.npmjs.org --userconfig $notesGateNpmrc @google-cloud/functions-framework@5.0.5
if ($LASTEXITCODE -ne 0) { throw 'Falló preparación privada' }
Push-Location functions
try { npm run build; if ($LASTEXITCODE -ne 0) { throw 'Falló build Functions' } } finally { Pop-Location }
powershell -NoProfile -ExecutionPolicy Bypass -File qa/scripts/remediation-dispersion-notes-emulator-run.ps1
```

Proveniencia verificada en package.json y lock privados: nombre `@google-cloud/functions-framework`, versión5.0.5, repositorio `GoogleCloudPlatform/functions-framework-nodejs`, URL `https://registry.npmjs.org/@google-cloud/functions-framework/-/functions-framework-5.0.5.tgz`, integridad `sha512-/w+OB1MxJux1uO9KRud4CRPLouaB7bZcy0v6STfFVh7yqafZ1L5coWIpseoKPLUgyNfawyoEfE2mEBDRZNGL2w==`. Npm verifica esa integridad al instalar; el runner coteja el pin del lock y la versión instalada, sin afirmar detectar modificaciones manuales de todo node_modules. Ninguna dependencia privada se publica ni se incluye en Git.
Verificación final de prerrequisitos: `-PrerequisitesOnly` PASS con el paquete privado pineado; fixture aislada sin Framework falla antes de emuladores con instrucciones accionables (sesión18638 PASS de control negativo). El lector del lock usa Node porque PowerShell5 rechaza la propiedad vacía `packages[""]`; no se relajó el cotejo del pin. No se repitió el gate HTTP por este cambio exclusivo de preflight. Pruebas finales estrechas:50PASS/0FAIL/1SDKskip explícito (32 backend falsos+18UI); el SDK real ya tiene33/33PASS en55742. Política canónica y diff-check PASS. Archivos de producto congelados desde build15463/gate55742.

## Integrated bundle verification (2026-10-11)

Bundle SHA256 `758d7397d7e2761928fd9bb9e32a45123c47acaea1150a17d892e23b8c237a8f` passed SDK run39008:40/40 tests,16 resource scenarios,125 distinct notes, mixed native types and authority-race denial. No cloud calls or Rules verdict. Emulators shut down. The full-index HTTP path used Framework5.0.5 and production batch4: peak high-water222936KiB (217.71MiB); full-index direct208020KiB (203.14MiB). Instrumented batch8 stress peaked257504KiB (251.47MiB), still below256MiB; product batch remains4. Maximum response8,388,487bytes.

Earlier73958/55683 memory failures remain evidence: the instrumentation loaded TypeScript/AST into measured children, adding ~140MB unrelated to deployed execution. The parent now builds a hash-bound factory manifest; measured children validate byte offsets, headers, names and hashes without TypeScript. Missing/malformed manifests fail closed. No baseline subtraction, forced GC or larger memory limit. Six focused manifest tests passed. After the shared-harness change, runtime11308 passed155checks/63asset bundles and WASM passed2real initializations/1bundled resolver/1synthetic row, zero provider/remote requests. Product bundle bytes are unchanged.

Normal/bundle complete347-endpoint manifest comparison74465, normal Functions build30964, Next build63431 and local upload packer77971 already passed for this source. This is local candidate evidence; deployment and independent cloud source/configuration verification remain required before Hosting publication.
