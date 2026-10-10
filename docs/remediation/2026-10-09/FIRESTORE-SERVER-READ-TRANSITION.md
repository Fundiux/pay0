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

No existe un campo mantenido por todos los writers que certifique cambios de la colección. `addClientDispersionNota` agrega documentos pero no mantiene versión/watermark de notas en el padre. Un notModified basado sólo en la fecha última ocultaría cambios/borrados; un hash de la página reduciría bytes pero no esas lecturas. No se cambian writers financieros ni se presenta esa falsa optimización. Antes de generalizar a otras familias, revisar frecuencia/consumo observado y un contrato de invalidación completo.
## Tamaño de respuesta legacy — gate de release abierto

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