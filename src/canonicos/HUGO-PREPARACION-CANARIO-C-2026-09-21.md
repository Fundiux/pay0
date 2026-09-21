# Preparación del primer canario C: AP1C4U1E6

## Evidencia y elegibilidad

La auditoría local previa clasificó las cuatro aplicaciones históricas como `REP_REQUEST_NOT_SENT_BY_PAY0`, con las limitaciones allí declaradas. Solo AP1C4U1E6 tiene además una observación real de `GET /deposits/complement/{id}`: HTTP 400 con el mensaje exacto de que no hay REP adjunto actualmente. La aplicación IQ y el depósito quedaron identificados, pero estos hechos no autorizan generación.

`can_request_rep` aparece en el código de PAY0 únicamente en `preflightIqComplement`. Se lee sin normalización del objeto recibido de `GET /deposits`; no hay una capa nuestra que lo calcule, aunque tampoco se conserva el cuerpo real que pruebe su presencia en IQ. Entró en el adaptador inicial (commit `2b6b209`) como comparación estricta con `true`; el documento inicial dijo “disponibilidad para solicitar”, sin citar contrato IQ. Los fixtures que prueban `false`, `null` o ausencia son sintéticos. El primer canario real solo registró `can_request_rep !== true`, sin capturar presencia ni tipo. El GET específico del adjunto no incluyó ese campo. No se encontró contrato, OpenAPI, implementación anterior validada ni respuesta real que defina sus valores o relación con los estados del depósito. La búsqueda pública de documentación primaria tampoco produjo una fuente. `rep` tiene la misma falta de semántica contractual. Ninguno es autoridad C.

La ruta `POST /deposits/{depositId}/complement` se conoce por el adaptador existente. No hay evidencia local de estados admitidos, rechazo inequívoco, token de idempotencia soportado por IQ ni garantía de no duplicación del proveedor. El adaptador solo reconoce HTTP 200 con `{message:"success"}` como aceptación; esto es un criterio local, no una especificación completa de IQ.

**Decisión actual:** AP1C4U1E6 no es elegible para C. La lectura B de adjunto ausente y la ausencia local de C anterior son necesarias, pero no demuestran que IQ acepte o deba recibir una generación. Incluso un `can_request_rep === true` queda bloqueado con `IQ_REP_REQUEST_ELIGIBILITY_UNVERIFIED`. Si no es `true`, permanece `IQ_REP_REQUEST_STATE_REQUIRES_REVIEW`. No se creó ni desplegó una ruta de canario C histórico.

La mínima comprobación antes de habilitar C es una definición verificable de IQ para `can_request_rep` y para `POST /deposits/{id}/complement`: significado y posibles valores del campo, condiciones del depósito, respuesta de éxito, rechazos inequívocos y tratamiento de solicitudes repetidas. También hace falta una lectura B actual del depósito identificado que conserve presencia/tipo/valor de los indicadores y valide identidad y estado; aun así, esa lectura sola no sustituye el contrato. Justo antes del POST, Hugo deberá volver a comprobar root, aplicación, fuente fiscal, permisos, perfil, Master Switch, configuración, cuota C, ausencia de adjunto B y ausencia de cualquier intento C local o externo conocido. La autorización futura será para un solo POST de AP1C4U1E6.

## Identidad y write-once

La clave lógica nueva es `SHA-256(rootId + ':IQ:' + depositId + ':REQUEST_REP')`. No contiene perfil. El job conserva perfil y actor de ejecución; `SENDING` añade `attemptProfileId`, `attemptActorUid` y `attemptedAt`. Al encolar, la transacción busca jobs existentes del mismo root/proveedor/depósito, incluidos los anteriores cuya ID incorporaba el perfil; reutiliza el único encontrado y bloquea una multiplicidad. Antes del POST, otra transacción exige que sea el único job de ese depósito, `PREPARING`, sin `attemptedAt` ni `requestedAt`, y persiste `SENDING`. Una reejecución, cambio de perfil o job duplicado no supera ese paso.

| Resultado del intento único | Estado PAY0 | Reenvío automático C |
| --- | --- | --- |
| HTTP 200 y `message: success` | `REQUESTED`; después B espera adjunto | No |
| Rechazo inequívoco anterior a enviar, por compuertas o autenticación previa | `PAUSED`/`BLOCKED`, con motivo | No hubo POST; una nueva evaluación exige todas las compuertas |
| HTTP 401 del POST | `UNKNOWN` (`IQ_REP_REQUEST_HTTP_401`) | No; no hay prueba de que el POST no produjera efecto |
| Otro HTTP, cuerpo ambiguo, timeout o desconexión después de iniciar envío | `UNKNOWN`, con código sanitizado | No |
| Caída después de `SENDING`, antes o después del envío | `UNKNOWN` al detectar interrupción | No |

`UNKNOWN` permite únicamente observación B y conciliación de evidencia; no vuelve a ejecutar C. La política local impide un segundo POST automático. No puede garantizar que IQ nunca produzca dos REP por canales externos ni demostrar idempotencia del servidor IQ sin su contrato.

## Pruebas y frontera

El smoke del emulador usa `fetch` cerrado a la red salvo respuestas falsas controladas. Cubre identidad estable, dos aplicaciones concurrentes, ejecución concurrente/doble scheduler, job heredado, cambio de perfil, `can_request_rep === true` sin contrato, `401` sin reautenticación/segundo POST, timeout con `UNKNOWN` y reintento/reinicio sin segundo POST. La reserva transaccional persiste antes de invocar el adaptador. No hubo POST real, despliegue ni cambios de producción.

La cohorte sigue siendo exclusivamente AP1C4U1E6. AP1C6U1E2 permanece fuera de C. El siguiente paso no es ejecutar el POST: es obtener la evidencia contractual de elegibilidad y preparar una ruta histórica controlada que se detenga justo antes de C para la revisión final.
