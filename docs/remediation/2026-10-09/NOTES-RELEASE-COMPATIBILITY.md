# Publicación compatible de notas de dispersión

## Estado vigente — 2026-10-11, 01:47 UTC

Candidato local nativo v2 y barrido progresivo de ventana, rama feature/dispersion-notes-read-20261010 sobre 1e22b89 (anteriores5d735a0/7b837ac). Candidato revisado y autorizado para commit coherente; integración y despliegue siguen pendientes. El bundle independiente346 está fuera del lote; el callable nuevo mantiene manifest candidato347. Ninguna lectura histórica adicional ni escritura cloud.

| Gate del candidato vigente | Resultado |
|---|---|
| Functions build96999 | PASS |
| SDK/HTTP25061, demo loopback | 40/40 PASS; inner/outer0; emuladores cerrados |
| Next71743 | PASS,47páginas; baseline/critical guards PASS |
| Authorization policy | PASS cached-selector, sin modificar política |
| Hook/renderer fake-clock final | 27/27 PASS |
| Prototipo sweep puro | 12/12 PASS; no SDK claim |
| Memoria controller25554 | Tres escenarios PASS; procesos cerrados |
| React/DOM Chromium70240 | Tres escenarios PASS; browserClosed/serverClosed=true; external0 |
| Diff | diff --check PASS; revisión central autorizó commit, no publicación |

Los checkpoints y fallos anteriores aparecen al final como antecedentes, no como estado vigente. Las métricas siguientes son locales Windows: no certifican RSS total del navegador, CloudRun/Linux, producción ni Rules. Permanece pendiente integrar/revisar el artefacto exacto y ejecutar el preflight/rollout autorizado.

## Contrato actual y compatibilidad visual

El cursor v2 contiene ID exacto y updateTime. La transacción autorizada lee el ancla, exige versión actual y usa startAfter(snapshot) nativo. No convierte mapas, cadenas, números, null, booleanos o arrays a Timestamp. SDK real compara diez tipos mezclados con la consulta nativa y conserva el control negativo: el antiguo cursor artificial Timestamp podía saltar otro mapa. createdAt ausente continúa excluido por orderBy, igual que el listener anterior; no se afirma que todos los documentos se enumeren ni que se haya censado historia.

IDs con espacios se preservan íntegros; validación UTF8<=1500, sin slash ni dot/dotdot. Padre/aliases conservan sus reglas estrictas. La fecha visual es un descriptor cerrado NONE/STRING/MILLISECONDS/SECONDS/TIMESTAMP, sin mapas arbitrarios. Cadenas/operandos de arrays primitivos se interpretan en el navegador, no en zona horaria Node. Timestamp usa la fórmula del SDK WEB instalado: seconds*1000+nanos/1e6 y luego Date; fixtures comparan cinco fechas negativas/positivas contra Web Timestamp.toDate.

El listener anterior ordenaba ASC como conversación. El nuevo modal declara «más recientes primero» y preserva DESC nativo dentro de dos secciones observadas: recientes e historial cargado. No ordena displayDate ni afirma orden global atómico entre observaciones de momentos distintos. La UI indica última actualización por sección e historial pendiente.

Cada ciclo visible lee head y como máximo una continuación secuencial; después espera5s. Intervalo efectivo=head+sweep RPC latency+5s; no dos esperas ni peticiones superpuestas. Foco/envío refrescan. El barrido fija profundidad H cargada, conserva cursores/versiones y reemplaza al completarse esa ventana; sigue rotando aunque head esté estable. Altas nuevas no reinician el epoch, evitando starvation. Anclas cambiadas/borradas provocan rebase automático desde head. No se consulta toda la colección salvo que el usuario haya cargado toda esa profundidad.

Cargar anteriores usa el cursor publicado y se puede encolar durante head/sweep; sólo deshabilita cola, petición older o pérdida de alcance. Respuesta obsoleta no reduce la ventana ampliada. Ancla publicada inválida reconstruye H+50 solicitadas. Primera página cortada por bytes publica su cursor inmediatamente; staging conserva objetivo50. Error transitorio permite retry visible; revocación vacía secciones/cola y detiene polling. Recarga manual conserva su acción explícita, pero no es la única vía de actualización histórica. DTOs con ID/updateTime iguales reutilizan referencias.

## Consumidores y convivencia

| Consumidor | Evidencia | Implicación |
|---|---|---|
| Bundle anterior2613559 | onSnapshot notas, orderBy(createdAt,asc), sin limit; error vacía notas y console.error | Hosting no actualiza pestañas ya abiertas; no hay reload/versiongate automático |
| Modal candidato | Callable listClientDispersionNotes, scope UID/root/padre,50 por defecto/API<=100/sobre8MiB | Publicar endpoint antes de Hosting; sin fallback directo |
| Clientes alternos | Ningún otro consumidor de esta subcolección encontrado en fuente frontend inspeccionada | No demuestra inexistencia de scripts externos/versiones persistentes |
| Writers Admin | Writer manual de dispersión identificado; otros módulos usan notas de otras familias | Sin cambios financieros, de writers o Rules |

## Rules preservadas y autoridad

El archivo local de este worktree tiene SHA-256 LF `7863811b85a57ff7dde6e9d3c5925253a90371dfdf4c63fc3a60bebf5ed31876`. Coincide con la evidencia publicada de `FIRESTORE-RELEASE-PREFLIGHT.md` en fuente principal: ruleset `76fda1a0-4463-4106-80ff-1b4ea13d3a61`, actualización2026-10-10T17:24:21.300538Z. No se volvió a consultar producción en esta tarea; antes del release se debe repetir el preflight de metadata autorizado para detectar cambios posteriores.

Las reglas conservan lectura directa de padre/notas por accountAllowed, módulo wallet.dispersiones, funding USER y ramas existentes de propiedad/delegación. Las escrituras cliente de notas siguen prohibidas. Este release no retira ninguna rama ni incluye el experimento Rules fallido. Mantener estas reglas permite convivir a bundles antiguos; también mantiene sus brechas conocidas de linaje. Publicar la UI nueva no cierra S10 global.

El backend nuevo exige perfil/restricción actuales, root exacto del padre, guard USER y propietario actual o permiso viewBasic del resolver transaccional con linaje hasta16 ancestros. Revalida antes de devolver. No se usa rol del navegador. No todo permiso anteriormente admitido por una rama directa es autoridad válida bajo el resolver nuevo: pérdidas de permiso/otorgante deben denegarse. Tampoco debe fabricarse root para un padre histórico ausente. El writer actual tolera root vacío antes de escribir; eso no demuestra que existan tales padres ni autoriza aflojar el nuevo lector. Registrar/diagnosticar una incompatibilidad de datos si aparece, sin migración implícita.

## Writers inspeccionados

`functions/src/modules/financing/callables.ts:addClientDispersionNota` escribe auto-ID, text recortado/no vacío y<=2000 caracteres, autor vía `manualNoteAuthor`, createdAt mediante `FieldValue.serverTimestamp`. Después actualiza hasUnreadMsg/updatedAt del padre en otra escritura; no es watermark atómico. Campos de autor no tienen un máximo demostrado por este writer. El presupuesto de bytes preserva la nota entera y no aplica un supuesto límite histórico.

Búsqueda estática en `functions/src`: otros `.collection("notas")` pertenecen a solicitudes (`index.ts`, notes/callables, paymentApplications, solicitudStatusMonitorCallables) o pagos (`index.ts`, notes/callables, pagoDocuments, pagoDepositCallables). No se halló otro writer actual de notas de dispersión. Esto no acredita emisores retirados ni herramientas Admin externas.

## Recursos y evidencia reproducible vigente

Backend conserva autorización completa en dos transacciones, root/USER/linaje hasta16, lote4, sobre8MiB, concurrency1,256MiB, timeout60. Respuesta máxima8,388,490B<8,388,608B; ninguna nota truncada. HTTP real Functions Framework5.0.5/fullindex347 y cliente separado: high-water RSS Windows typical127.35MiB, caracteres escapados187.39MiB, ASCII162.53MiB, linaje131.86MiB. Máximo fullindex batch4 observado209.07MiB. Esto apoya el contrato local256/con1; no es una garantía estadística o medición Linux/CloudRun.

Controller Node:150×192KiB unchanged/changed y50×1048000B changed; JSON nuevo por RPC, max8MiB. Reutiliza150/150 referencias sin cambios; reemplaza150/150 y50/50 con nueva versión. Heap tras desmontaje/GC aproximadamente33–34MiB. Watchdog120s/hijo y heap512MiB son límites del proceso de prueba, no presupuestos del producto. WeakRef liberadas se observan sin exigir GC determinista.

React/DOM: script aislado extrae por AST una única NoteBubble, helper de fecha y contenedor JSX reales; hook/helpers/React/ReactDOM y Tailwind/root CSS compilados reales, sólo wrapper de transporte sintético. Hashes de fragmentos/helpers/CSS/bundle en log. Servidor y WebSocket sólo127.0.0.1; red externa bloqueada y service workers deshabilitados. Watchdog240s y heap renderer768MiB delimitan la prueba, no política de historial.

| React/DOM caso | Notas/texto por nota | Pico heap JS observado | DOM después de carga/revocación/desmontaje |
|---|---|---|---|
| Sin cambios |150×192KiB|75.39MiB|1067/13/11 nodos|
| Cambiadas |150×192KiB|86.19MiB|1067/13/11 nodos|
| Grandes cambiadas |150×1048000B|180.44MiB|1067/13/11 nodos|

Todos verifican orden/IDs, longitud íntegra del texto DOM, versiones, exclusión de peticiones simultáneas, pasada estable posterior, revocación y desmontaje. 28/28/190 RPC sintéticos respectivamente incluyen carga, refresco, repetición y denegación. Son costes del escenario, no factura. Medidas CDP incluyen antes/después de GC y cada entrega/commit. Heap JS NO incluye necesariamente toda memoria de strings DOM/Blink ni RSS de procesos: no concluir consumo total del navegador a partir de esta tabla. Es un modal aislado, no toda la aplicación ni una prueba Auth/ruta.

Comandos desde el worktree:

~~~powershell
# En functions/: npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File qa/scripts/remediation-dispersion-notes-emulator-run.ps1
# npm run build con PAY0_BUILD_ENV_FILE autorizado, sin imprimirlo
node scripts/verify-authorization-policy.mjs
node --test qa/scripts/remediation-dispersion-notes-ui.test.mjs
node qa/scripts/remediation-dispersion-notes-memory.mjs --run-synthetic
node qa/scripts/remediation-dispersion-notes-browser-memory.mjs --run-synthetic
~~~

Runner demo/loopback/denyall y Framework privado5.0.5 pineado según FIRESTORE-SERVER-READ-TRANSITION.md. Admin bypass no es RulesPASS. Logs privados ignorados: notes-native-functions-build.log, notes-native-sdk-http.log, notes-native-next-build.log, notes-controller-memory.log, notes-browser-memory-escalated.log, todos bajo .firebase/remediation-temp. Logs PowerShell pueden estar UTF16LE. Sin puertos/servidores propios abiertos al terminar.

## Checkpoints históricos y fallos conservados (superados; no estado actual)

- 1e22b89 exigía Timestamp real para evitar cursor de tipo fabricado; SDK44296 39/39 PASS, backend/UI56 PASS+1skip, build28527 PASS, tres IDs con espacios y exactamente80 lecturas autoridad/ancla nuevas. Ese contrato rechazaba map/string/null/número aunque el render anterior los tolerara; su gate de compatibilidad permanecía abierto. El candidato v2 sustituye esa restricción por cursor snapshot nativo; no clasifica aquellos formatos como inválidos de negocio ni migra datos.
- El preflight histórico autorizado por root observó10padres/0notas y muestra parcial, no concluyó tipos de toda la historia. No se necesitó ampliar censo para corregir el contrato determinista.
- Diseño previo actualizaba sólo head y requería recarga manual para borrar historia antigua. Quedó sustituido por barrido progresivo continuo. Prototipos B/membership/ordenación por pares se descartaron; no forman parte del producto.
- Gate UI inicialmente esperaba pending=false tras cuatro ciclos. Se corrigió a comprobar al menos dos pasadas completas bajo altas continuas: iniciar otra pasada pendiente no es starvation. Se conservaron expectativas de acceso/entrega.
- Oráculo inicial Admin Timestamp.toDate falló -999 vs -1000 para seconds=-1/nanos=1000: Admin redondea y no representa el antiguo listener Web. Se corrigió el oráculo al SDK Web instalado, y la fórmula productiva no hace floor.
- Next primer intento falló antes de compilar por variables ausentes en worktree. El intento71743 usó el wrapper existente con PAY0_BUILD_ENV_FILE de integración, sin copiar/imprimir valores; PASS47páginas.
- Browser primer intento sandbox falló antes de lanzar Chromium: esbuild no podía leer la dependencia React por junction (Access denied). El mismo gate ejecutado localmente con permisos ampliados pasó70240. Advertencia preexistente de clave esbuild duplicada en package.json se conservó sin modificar manifest ajeno.
- Los estados anteriores «SDK/memoria NO EJECUTADO» describían preparación. Quedan reemplazados por la tabla vigente; no se mantienen como gates abiertos actuales.

No aprobación de despliegue ni cierre S10 global. La integración final conserva sus gates y el plan siguiente.

## Orden propuesto y gates

1. Revisar y guardar el candidato nativo v2 completo. Sus gates locales están aprobados según la tabla vigente; repetir los gates del artefacto finalmente integrado Functions/frontend, política canónica y manifest exacto347 conservando los346 nombres previos. Preservar el contrato local lote4/8MiB/concurrency1/256MiB; las mediciones Windows no son observación de CloudRun/Linux. No mezclar este manifest con el release bundle346 en curso.
2. Preparar preflight remoto autorizado: snapshot de baseline del endpoint si existiera, runtime/SA/env/secretos sólo fingerprints, IAM, región, recursos y reglas/Hosting/rewrite actuales. Confirmar que el endpoint es realmente nuevo antes de elegir rollback. No leer tokens ni payloads operativos para esta verificación.
3. Despliegue selectivo único del callable `functions:listClientDispersionNotes`, us-central1, desde commit/artefacto pineado con hooks completos. No `functions` global, firestore, indexes ni storage. El selector es contrato de alcance, no una autorización para ejecutar ahora.
4. Postflight backend: ACTIVE/Ready/revisión exacta, recursos concurrency1/256MiB/timeout60 y política IAM esperada; verificar que los346 endpoints previos y Rules no cambiaron. Gates autenticados con datos sintéticos controlados en entorno aprobado: positivo owner/USER/delegado y negativo root/restricción/revocación; no crear notas financieras reales para probar. Validar índice creadoAt desc+ID desc del proyecto autorizado: emuladorPASS no prueba la configuración productiva.
5. Sólo tras backendPASS, publicar Hosting del mismo candidato integrado. firebase.json usa `hosting.source: .` y frameworksBackend: el scope puede incluir SSR/rewrite, no sólo archivos estáticos. Preservar release/tag/revisión previos y revisar los nombres generados antes de Execute. Mantener documentos/Telegram/restriction UI ya publicados; no regresar a un bundle antiguo por conveniencia.
6. Gate UI: apertura y paginación, envío por writer existente seguido de refresh (prueba falsa/local o entorno expresamente autorizado), hide/focus, cambio de cuenta, revocación, error genérico, recarga consciente, sesiones viejas aún abiertas. Observar errores/latencia/memoria/coste sin registrar texto, tokens ni IDs. El intervalo5s es provisional y puede ser menor frecuencia efectiva por tiempo de respuesta.
7. Retirada de lectura directa sólo como lote separado: evidencia de consumidores/versiones, estrategia de recuperación de sesiones antiguas y clientes alternos, Rules/cobertura/presupuesto con positivos. Ningún tiempo fijo ni HostingPASS demuestra extinción de bundles antiguos. Mientras tanto persiste el riesgo residual directo documentado.

## Rollback sin ampliar autorización

Antes de Hosting, si falla el backend nuevo, abortar rollout y conservar UI/reglas existentes; no declarar que se cerró su brecha. Después de Hosting, conservar endpoint compatible y una revisión ya validada de su misma autorización/contrato. No borrar el endpoint ni sustituirlo por consultas Admin sin guardas; dejar error recuperable es preferible a un fallback directo que omita la revocación actual.

Preparar un artefacto de rollback frontend que conserve todos los cambios de seguridad previos, la funcionalidad de notas y su transporte autorizado, con el mismo contrato de errores y un hotfix revisado. Una contención de emergencia requiere un incidente real y una justificación explícita independiente; no es la estrategia de rollback de este lote. Restaurar el bundle pre-notas devuelve a más usuarios al listener directo más débil y no cumple «sin regresión de autorización». Si fuese necesario un rollback global de Hosting por otro incidente, debe revisarse expresamente ese tradeoff y la compatibilidad de SSR/Telegram/documentos; no se aprueba aquí. No revertir Rules, writers financieros ni datos históricos para reparar un fallo de la nueva lectura.
