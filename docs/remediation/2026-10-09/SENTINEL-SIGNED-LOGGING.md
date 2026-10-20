# Writer firmado de Logging: composición preparada y apagada

Actualización 2026-10-10: la factoría exige ahora una ventana fija explícita y la
composición preparada conserva una sola instancia. Suite actual: 102 checks PASS,
network=0, realCredentials=0, productionPort=DISABLED. El build central previo
corresponde al writer anterior; esta modificación TS queda congelada pendiente
del próximo build central. No se ejecutaron builds ni cambios remotos aquí.

## Ventana finita y composición preparada

La configuración exige exactamente `window: { issuedAtMs, startsAtMs, endsAtMs }`,
con enteros seguros no negativos, issued <= starts < ends y ends-issued <=1hora.
No se calcula ni renueva ningún límite a partir de Date.now. Las tres cifras se
capturan al construir la factoría; mutar luego el objeto original no cambia la
ventana. Antes de starts retorna DISABLED sin credenciales, firma ni Logging.
Desde ends cierra permanentemente esa instancia. Un retroceso respecto al mayor
reloj ya observado, o un reloj inválido, también la cierra permanentemente; avanzar
de nuevo no la reabre ni reinicia cuotas.

Se vuelve a comprobar la ventana antes de obtener credenciales, después de
obtenerlas, antes/después de firmar, antes de cada petición metadata/KMS/Logging,
y antes de devolver ACCEPTED. La expiración durante una fase devuelve WRITE_FAILED
y no inicia la fase siguiente. Una escritura ya procesada puede existir aunque
expire la ventana antes de confirmar: no hay reintento automático. El reloj de
ventana y los AbortSignals son controles cooperativos; no constituyen un límite
duro de CPU ni una garantía de cancelación retroactiva del proveedor.

`getPreparedSignedLoggingComposition` construye una única instancia por módulo,
sin I/O, y devuelve la misma para el mismo objeto de configuración. Otro objeto
se rechaza en vez de reemplazar la instancia, extender su ventana o reiniciar sus
budgets. La factoría directa sigue disponible para pruebas; el futuro wiring debe
obtener la composición una sola vez fuera del handler. Este accessor no está
conectado a listUsers ni exportado desde index; el puerto productivo sigue DISABLED.
Reiniciar el proceso reinicia cuotas locales, pero conserva los límites absolutos
que debe suministrar el despliegue revisado. No se afirma presupuesto global.

Pruebas añadidas: ventana ausente/inválida/>1hora, inicio inclusivo y fin exclusivo,
mutación de configuración, intento de reabrir tras expirar, retroceso de reloj,
expiración tras credential/KMS/Logging, ausencia de fase posterior, composición
inerte estable, rechazo de nueva configuración y cuotas compartidas entre accesos.

Estado: código local nuevo, sin consumidores productivos, activación, IAM, KMS/metadata/Logging reales ni cambios en publisher/listUsers. El puerto exportado signedLoggingObservationPort devuelve siempre DISABLED y no admite bandera de entorno o booleano de activación. La factoría separada createPreparedSignedLoggingWriter existe para pruebas y una composición futura que requiere revisión explícita; no se importa desde un handler.

## Datos y autoridad

Se reutilizan los tipos ObservationResource y ObservationResult del publisher existente sin cambiar su código. El contexto contiene exclusivamente rootId/actorUid del backend; el futuro consumidor deberá obtenerlos de auth verificada y perfil recién leído. El writer no autentica un objeto sólo porque tenga esos campos. Root único y actores se comprueban contra la cohorte fijada en configuración.

Se captura configuración de recurso/audiencia/clave al crear la factoría. Project/function/type/origin son constantes pay-0-system/listUsers/AUTHORIZATION_DENIED/SERVER_AUTH_DECISION. Se genera randomUUID internamente por intento, usado tanto en la tupla como insertId. Occurred/issued se fijan al comienzo y expiración24h; el canonicalizador valida la tupla antes de cualquier I/O. No acepta un eventId, revision, proyecto, bytes a firmar o logName suministrados en el contexto.

Entry lleva schema PAY0-SECURITY-SIGNED@1, context y exactamente signedBytesB64/signatureB64 del adapter KMS. No incluye event libre alternativo. Resource cloud_run_revision con project/service/revision/configuration fijados y location us-central1; labels de runtime siguen siendo afirmaciones del productor y requieren sus gates previos. No hay autoridad financiera ni promoción de restricciones.

## Presupuesto único y cancelación

El controlador exterior comienza antes de obtener la credencial y fija750ms como máximo para metadata+KMS+Logging+body completo. Sus señales hijas sólo pueden acortarlo. La credencial se lee una vez por intento, se copia y se reutiliza para KMS y Logging; no se persiste ni comparte entre intentos. Se usan los adapters aprobados de metadata y KMS sin cambios: CRC32C request/response, versión exacta y canonicalización permanecen en el firmante.

Cada fase comprueba cancelación antes de I/O y antes de confirmar resultado. El AbortSignal se propaga a fetch y readers; responses tardías de un fetch que ignore abort cancelan body y no generan ACCEPTED. finally aborta el controlador, elimina timer/listener y libera inflight. No se suman tres presupuestos750ms consecutivos ni se usa sólo un Promise.race sin señal.

Un timeout puede ocurrir tras una firma o escritura real ya procesada; WRITE_FAILED no significa que el proveedor no recibió nada. No hay reintentos automáticos, replay financiero ni recuperación del intento de negocio.

## Logging y límites

Destino único POST https://logging.googleapis.com/v2/entries:write, logName fijo projects/pay-0-system/logs/pay0_security_observation, una entrada y partialSuccess:false; redirect:error. Request completo <=8192bytes. La API oficial declara respuesta exitosa vacía: se acepta status200 con body vacío, o el objeto JSON vacío usado para esa representación, sin contenido adicional. Cuando hay body JSON se exige content-type apropiado, UTF8fatal y <=1024bytes declarados/efectivos. El error no incluye tokens, IDs ni texto de proveedor. Véase [entries.write](https://docs.cloud.google.com/logging/docs/reference/v2/rest/v2/entries/write).

Antes de metadata se reserva1inflight,6intentos/minuto y20intentos por instancia de factoría, incluidos intentos fallidos. Son límites locales en memoria: reiniciar proceso o construir otra factoría los reinicia. Una futura integración debe crear una sola instancia por proceso y conservar ventana finita/cohorte; no se afirma cuota global durable ni protección total del gasto.

## Pruebas y gates

Suite qa/scripts/remediation-sentinel-signed-logging.test.cjs ejecutada tras liberar discovery IQ: PASS71 comprobaciones, network=0, realCredentials=0, productionPort=DISABLED. Build central pendiente. Sólo puertos fetch/credenciales fake; cubre entry/tupla/CRC, UUID interno, puerto DISABLED aunque env intente habilitarlo, contexto inválido sin I/O, budgets antes de costes, respuesta Logging inválida/vacía, deadline acumulado durante metadata+KMS, abort y body tardío, y recorrido completo con metadata fake seguido de KMS y Logging fake.

No se modifican loggingWriter.ts, publisher.ts, authorizationDenied.ts, listUsers, sink, config runtime, IAM o export index. Pendientes antes de activar: prueba/build central, revisión de SA/clave/algoritmo y permisos efectivos, configuración de runtime y trust manifest receptor, integración firmada del transporte del observer, ventana finita, medidores de latencia real y rollback. La existencia de esta factoría no satisface esos gates.
