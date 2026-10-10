# Writer firmado de Logging: composición preparada y apagada

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
