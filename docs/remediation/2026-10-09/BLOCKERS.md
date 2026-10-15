# Dependencias y problemas abiertos

Actualizacion2026-10-13: Hosting ya tiene release4cfd958c9a8694ae/SSR00590-gik Ready100 y pruebas parciales fuente5/assets15/browser publico PASS. Siguen distintos dos problemas: launcher61879 fallo tras RELEASE_ACCEPTED (causa final no reproducida) e inventario completo rechaza caches Webpack grandes (causa demostrada). No redesplegar para verificar; conservar ZIP/recibos y preparar exclusion especifica para el proximo artefacto. La validacion parcial no cierra equivalencia completa ni flujos autenticados. Ver HOSTING-61879-RECONCILIATION.md.

SDK DELIVERY8casos PASS, pero dispatch/transport/continuation/supervision/HTTP y configuracion de vida DELIVERY no estan conectados. No activar admision hasta cerrar continuidad y agregacion/auditoria sin doble envio legacy. A1 esta reparado e integrado; A7B necesita contrato actual para snapshots/lifecycle/evidencia de release, no restaurar archivos ausentes arbitrariamente. Estos frentes tienen trabajo local ejecutable y no son bloqueo global.

Historico conservado debajo; las afirmaciones de estado anteriores corresponden a sus cortes.

Actualizacion2026-10-11: el prerrequisito de lectura historica para la cohorte
del notificador paso en Firestore cloud aislado a48min, misma ancla y limpieza
verificada (NOTIFICATION-CLOUD-READTIME-EVIDENCE.md). Sigue pendiente conectar
admision, dispatcher y entrega con autoridad actual/fences; el adaptador y la
admision permanecen inertes. Esto no cierra DOC-DISPERSION-REPLAY.

Notas de dispersion integradas/pushed9a729e3: bundle347 y matriz40/16recursos
PASS39008. Callable creado revision00001-mug/generation1791691748273508;
401 sin autenticar PASS74b0e6. Hosting pendiente por ZIP:1251 hashes esperados
coinciden,327 extras detectados (315maps normales y12auxiliares). El packer
anterior validaba subconjunto; correccion exacta/ignore/stream en worktree
aislado, sin borrar archivos locales. Siguiente: integrar gate revisado,
update-only con mismo runtime y verificar ZIP independiente antes de Hosting.
Experimento Rules e3ea3dd fallido permanece excluido; S10 no queda cerrado.

Candidato separado solicitud-notes7a913c3: normal348/16recursos PASS, HTTP
bundle PASS7 y132208KiB, pero matriz bundle39/40: stress instrumentado batch8
large alcanzo267832KiB sobre256MiB. Probe31827 reprodujo fallo en ambos:
old267544KiB/current266928KiB; no demuestra regresion por extraccion. Se
implementa contador exacto de bytes JSON del DTO cerrado para evitar strings
temporales expandidos; oracle y matriz completa pendientes. No ampliar memoria
ni quitar caso. Todos los casos batch4 pasaron, lo cual
no convierte la matriz completa en PASS ni autoriza integrar este candidato.

| Punto | Evidencia / causa | Trabajo que continúa | Condición de publicación/cierre |
|---|---|---|---|
| Integración Git | 108/13 commits divergentes; merge aislado conserva ambas historias. Se detectaron y corrigieron duplicados TypeScript y un helper de reglas. | Builds y pruebas del candidato integrado. | Release guards, emuladores y frontend build del commit exacto. |
| Drift productivo | Hosting cambió por acción externa durante baseline. OCR, reglas y CSF publicados tenían capacidades ausentes de HEAD inicial; ya recuperadas en candidato. | Lotes independientes con fuente exacta y rollback preservado. | Nuevo preflight por componente antes del deploy. |
| S01 frontera completa | Guardia actual no cubre todavía todos los HTTP/workers ni Storage directo; límite Storage de dos consultas. | Writer/recovery preparados sin export y revalidación de trabajos en curso. | No activar restricciones hasta cobertura y recuperación verificadas. |
| S10 derivadas | Límites otorgante implementados; revocación transitiva y TOCTOU de setter pendientes. | Diseño de autorización documental canónica. | Demostrar revocación descendiente sin depender de limpieza. |
| S06 parsers | Hash servidor no demuestra ausencia de malware. Tipos opacos explícitamente no analizados. | Finalización transaccional probada; plan en FILES.md. | Aislamiento de parsers, límites de expansión y promoción según riesgo. |
| Sentinel | Compute/Appspot/cloudservices con Editor de proyecto; detector no debe usar identidad compartida. | Servicio aislado, IAM y preflight en implementación. | Identidad sin acceso financiero, persistencia aislada y pruebas negativas. |
| Calibración | No existe ventana de observación nueva ni evidencia de falsos positivos. | OBSERVE_ONLY permitido al pasar controles técnicos. | Automatismos de contención siguen desactivados hasta evidencia real. |
| Respaldo | Firestore PITR y delete protection deshabilitados; restauración no demostrada. | Cambios de código/reglas no destructivos. | Sin migración destructiva hasta respaldo y recuperación probados. |

Ninguno de estos puntos detiene los frentes independientes. No se han ejecutado efectos financieros reales ni mensajes de prueba a destinatarios.

## 2026-10-13: arranque CLI e integracion IQ

Capturas NORMAL35761 (8501 ms) y85598 (62464 ms) fallan STARTUP_LIMIT de7000, sin baseline. Diagnostico instrumentado3371 ms no sustituye gate. Timestamps del segundo manifiesto apuntan a un tramo posterior de59,5 s; no distinguen parsing, scheduling u otra causa. Comparacion funcional offline e8b35f5 PASS347->348 exacto (b2b06c), schema distinto con normalStartupPassed:false. No repetir capturas a ciegas ni relajar limites. Siguiente: candidato empaquetado sin instalar y diagnostico separado si hace falta; publicacion dependiente sigue pendiente.

IQ retorno canonico corregido d5bafca, integrado c21a2b7, unit30 y SDK4 casos PASS; no despliegue. Binding DELIVERY99 pruebas/build PASS, SDK adaptado pendiente y productor inactivo. A7B conserva entradas historicas ausentes; no fabricar cierre ni equivalencia de snapshots.

## Coexistencia de versiones financieras

Las siete fuentes recuperadas y verificadas parcialmente (74bf29/63ce50) permiten comparar código publicado. La matriz leída por root919dbb confirma que el formato de Tasks conserva generación, hash y solicitante, pero los productores antiguos escriben ACK/error sin el nuevo fence y las Tasks antiguas escriben resultados después de una comprobación inicial. Una invocación antigua en curso puede sobrescribir estado posterior. Actualizar primero el consumidor no demuestra seguridad de esa coexistencia. Falta probar la transición y establecer una ventana operativa con evidencia de retiro de productores y ejecuciones anteriores; no se ha pausado ni drenado la cola.

También se detectó pérdida de la exclusión de importaciones históricas. Se restauró en884e4b2 (rama fuente), con19 pruebas, compilación NORMAL y política PASS. Debe integrarse en un nuevo candidato financiero; el artefacto congelado para los dos lectores permanece intacto. Este frente no impide terminar el launcher y verificar los lectores por separado.

## 2026-10-14: gates locales recuperados y limites restantes

El candidato notifier3e4a1bc tiene NORMAL/BUNDLE y cuatro SDK aprobados.
Los controles predeploy restantes pasaron entre intentos: 13/14 en98439 y
acceso documental12 en19832, ambos con postflight completo. El fallo inicial
1297 permanece; el diagnostico demuestra que la CLI oculta cualquier rechazo
socket tras TIMEOUT, pero no identifica su causa historica. No se amplia el
plazo ni se acredita una ejecucion unica de los14 comandos.

La fuente f8969a8 prueba cancelacion durable aislada con SDK4casos/24refs y
regresiones DELIVERY25/206 yConsumers6/12. Su conexion al core sigue pendiente;
no activar productor, endpoints o recuperacion por estos resultados aislados.

IQ receipt dispone de un ZIP minimo local verificado: seis entradas cambiadas,
1078 registros preservados crudos,25pruebas compiladas y12de empaquetado PASS.
La publicacion requiere comparar configuracion actual, preservar el valor vacio
GOOGLE_NODE_RUN_SCRIPTS e invalidar de forma explicita el hash Firebase obsoleto.
Todavia no hay upload/PATCH ni prueba de coexistencia de invocaciones antiguas.

Actualizacion posterior: captura IQ6GET b4d0e7 PASS confirma configuracion/IAM,
fuente exacta y Ready100%; no mutaciones. Artefacto portable b858cb5 reproduce
ZIP10690194 con26fuente+12ZIP PASS. Publicacion sigue pendiente del launcher
revisado y su postflight, no de aquella comparacion ya completada.
Wiring notifier1c01538 aprobado root/independiente:266offline/noEmit y cinco
SDK posteriores PASS (lifecycle2/18,DELIVERY25/206,Consumers6/12,cancel4/24,
Scan6/11). La integracion y sus builds/gates nuevos permanecen pendientes;
no atribuirle los artefactos historicos del candidato3e4a1bc.

## 2026-10-14: NORMAL a1a aprobado; regresion ampliada pendiente

NORMAL47f9dd/728993 PASS para a1a295e:1018archivos/15099533bytes,
postflight fuente/deps intactos, treeEmpty=true/cloudCalls0. Runtimefdf9b217e8da4a78b787d1e63dde6b75;
complete SHA d7096774c5a81589071a0b35d232704a89fac77d634513f45344a03b07c98659.
Rootd057d6 confirma recibo y status limpio. No BUNDLE ni captura definitiva.

Gate ampliado5d2268:44suites/1663tests,1660PASS/3FAIL. Fallan fixtures
remediation-dispersion-notification-delivery-dispatch.test.cjs casos49-51 por db.runTransaction
undefined tras cambio interfaz; investigacion y fixQA en rama fuente, sin
eliminar oraculos. Policy PASS; cincoSDKPreparePASS; admission-wiringPrepare
FIXTURE_PIN_MISMATCH antesred en investigacion separada, no repin automatico.
Snapshots source/QA/donor iguales before/after. Evidencia privada en nuevo
worktree .firebase/effect-lifecycle-integration/offline-ba1f435d-6558-4b5d-af0e-23469d530fa8,
summarySHA bc8766e97063e6ca96ea632242220e2ff02de058fce0ffd793b40eced5f1bd6a.
Captura/bundle pausados especificamente hasta correccion de estos gates;
NORMALa1a conservado como evidencia del candidato probado, no de futuroHEAD.

IQ receipt: postflight413751 PASS descrito en RELEASE.md; ese despliegue ya no depende del launcher. Permanecen los riesgos IQ globales y publicacion Git pendiente de confirmacion del destino. Notifier QA40051ff integrado657cde7; rerun44/NORMALnuevo pendientes, fallos previos conservados.

## 2026-10-15: estado vigente del candidato notifier

Los gates posteriores reemplazan las dependencias locales anteriores: foundation32f6833
paso44suites/1663tests y seisSDK/51casos. Candidato164d066 integra tres endpoints privados
OFF y optimizacioncf41cb3. NORMAL1026files PASS; control oficial351exports/2462ms PASS
32778b conserva el limite7s/10s y el fallo CLI_TIMEOUT anterior. Bundle164 sigue en validacion;
no inferir resultado por completar la transformacion de archivos.

SDK ConsumersRuntime fuenteefd77 paso4casos/20refs tras corregir un oracle de revocacion;
primer fallo conservado. QA/documentacion commit9d1f19e. Dos archivos de su cierre difieren
realmente de164 (verificador OIDC compartido para Recovery y export de platformHeaders):
el gate privado sobre fuentes exactas164 paso4casos/20refs96b4d3 y75tests auth/RecoveryHTTP.
No hace falta modificar el artefacto congelado para ejecutar ese gate.

Infra15987aa y wrapper metadata tienen pruebas offline, pero aun no plan/apply ni recursos.
Fuente publicada del finalizador00017-jaz capturada por generacion1791655261723468:
su recorrido local sigue siendo legacy y no tiene admision V3. No equivale a notificaciones
globalmente apagadas. La inspeccion es estatica; refreshd5a84c confirmo mismos3hashes y
GOOGLE_NODE_RUN_SCRIPTS EMPTY. Evidencia V3 revisada con frescura acotada para bootstrap.
El ZIP contiene package build que referencia un script fuera del archivo; no suponer que se
ejecuto ni que el contenedor coincide byte por byte. No se invocaron handlers ni proveedores.

El verificador ZIP incremental5bc3052 esta probado aisladamente (22+45tests y6packslocales),
sin integrar en164. Puede fijarse como herramienta externa para verificar el paquete de release.
Siguen pendientes el gate completo aplicable, fuente exacta empaquetada, infraestructura/IAM,
indice listo y despliegue selectivo OFF. Productor/consumidores no se activan por estos avances.

Resultado bundle164: FAIL723970 sin timeout, Exit1/Jobempty y postflightPASS. Los364archivos
transformados terminaron antes del fallo BUILD_FAILED/REDACTED, sin artefacto instalado.
NORMAL preservado, sin retry; se investiga la invocacion esbuild con intermedios existentes.
Diagnostico aislado write:false (root11512e) reproduce ACCESS_DENIED en130ms sin outputs,
Jobempty y entradas intactas. Falta localizar la denegacion; no cambiar ACL ni controles a ciegas.
Bootstrap metadata841210 fallo BOOTSTRAP_HTTP, lockliberado/sin mutaciones. El lector anterior
perdio fase/status al propagar el error; diagnostico cerrado agregado y probado56tests antes
de un nuevo intento acotado. No hay plan/apply ni nueva infraestructura remota.

Actualizacion posterior: bootstrap corregido a19lecturas paso773ad5; el403 correspondia
al describe directo inaplicable a serviceagents. Sus bindings IAM se verificaron sin grants.
Render local19recursos PASS; evidencia historica ya requiere refresco antes de plan.
Infra d4cecaf restringe max_burst_size a queue.rate_limits,55testsPASS/revisionroot9a7609.
PLAN_ONLY aun offline: revisar persistencia de incertidumbre OAuth y campos after_unknown
no configurados antes de autenticar o ejecutar Terraform.
Transform esbuild sinteticoPASS y build observado e6437588e1e4435cbe4c55efee1a8754
confirma servicio nativo iniciado/cerrado0, pero ACCESS_DENIED153ms persiste.
La operacion denegada sigue sin identificar. errorCount0 del proyector antiguo no prueba
lista vacia: esbuild expone errors por getter que ese proyector no lee. Sin cambioACL/retryglobal.

Diagnostico estructurado5d8ce167c44f40cbbe5da529619b37c8/root2e28a5 identifica
READ_DIRECTORY_ACCESS_DENIED diez padres por encima de compiled (perfil fuera workspace),
seguido de RESOLVE_PATH_FAILED ./index.js existente. Esbuild0.28.2 recorre ancestros antes
de tsconfig; cambiar tsconfigRaw no evita esa recursion. Control local escalado en revision.
Renovacion remota3GET+19reads rechazada por auto-review antes de crear proceso: autorizacion
de acceso/captura no acreditada para reviewer. Confirmacion especifica asincrona pendiente;
sin auth/red/recibos nuevos y sin reintento por otra via. PLAN_ONLY permanece deshabilitado.

Control LOCAL escalado aprobado por herramienta: a4d6e2824de34c878d8ba112558f5dc2
PASS643ms con mismos inputs/opciones; source/donor/inputsintactos y Jobempty.
Confirma diferencia ambiental compatible con restriccion de lectura de ancestros del sandbox.
Sin cambiosACL/tsconfig ni outputs instalados; falta repetir fullBUNDLE+compare con esa
condicion de ejecucion. El rechazo cloud sigue independiente y no fue eludido.

Usuario confirmo expresamente las3+19lecturas y recibos locales. La siguiente solicitud a la
herramienta puede usar esa autorizacion nueva; no convierte plan/apply/CREATE en ejecutados.
Se corrige primero la admision privada vacia POSTFUNCTIONS para evitar que IAM deba existir
antes de que su unicoownerTerraform pueda crearlo. Bootstrap19config no cambia.

FULL BUNDLE164 resuelto en entorno local aprobado:9573cf6eb36644bdaacd5a8be1e0cb8a
PASS root994b04; install1027outputs y compare351/2429ms dentro del limiteoriginal.
Jobempty/source+donorintactos/NORMALarchivadointacto. Los fallos previos se conservan.
Pendientes:13predeploy restantes sobre este instalado, paqueteexacto, infraestructura y releaseOFF.

Estado actual: plan19CREATE generado en9ad679... pero validador rechazo computed
customrole.deleted; tambien requiere prueba exacta de defaultdeletion_policy SA/customrole.
Noapply; estado/ownerintactos/lockreleased/Jobempty. Solo analisisoffline del plan preservado.
Rulesalias candidato96 corrige2budgetoriginales pero falla legacy-only:note por presupuesto;
no publicable ni commit. Caracterizacion8reads pendiente lane de scoped13 activa.

Actualizacion: scoped13PASS y lane liberado. Caracterizacion8reads confirma BUDGET
legacy-only:note preexistente en ambos; nuevo helper nota revisado offline pendiente native.
Plan19CREATE ahora revisable offline bajo validator7e5cff4, evidenciaoriginal vencida y
sinapply. No repetir plan por fallo de representacion ya resuelto; aplicar solo savedplan
exacto con nueva evidencia y controlador revisado. ZIPhook14 no persistio por contrato
del test; preparar ZIPnuevo bounded con inventario independiente antes de release.

Actualizacion: helper Rules ya supera focused4 y candidate96budget0, regresion518pendiente.
ZIP nuevo bounded conservado/verificado1394 SHA f949c06d...; ya no falta paquete local.
APPLY sigue pendiente de revisar fixes de postflight/estado y renovar evidencia real;
CREATE/OFF no ejecutado. Versiones de secretos/actAs/privacidad heredada siguen siendo gates.
