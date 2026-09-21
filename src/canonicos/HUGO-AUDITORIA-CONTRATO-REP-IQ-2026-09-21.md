# Auditoría del contrato IQ para REP de pago

Fecha: 2026-09-21. Alcance: código, documentación, fixtures y bitácoras locales; lectura de Cloud Logging del canario. **No se hizo ninguna nueva llamada a IQ ni se modificó la política desplegada.** El canario `iq-rep-read-ap1c4u1e6-v1` permanece `STOPPED`.

## Mapa de recursos y evidencia

| Recurso | Uso comprobado en PAY0 | Qué demuestra |
| --- | --- | --- |
| `POST /users/sessions` | Autenticación HTTP; el canario registró sesión abierta. | Solo acceso autenticado; no genera REP. |
| `GET /deposits` con búsqueda de ID | `complementProviders.preflightIqComplement`; otros lectores de depósitos en `pagoDepositHttpReconcileA52` e `iqExecution`. El canario encontró una coincidencia exacta. | Identidad y estado del depósito. No hay contrato encontrado para `rep` ni `can_request_rep`. |
| `GET /payment-applications` | Diagnóstico y ejecución de aplicaciones IQ; plan/intento local corroboran aplicación. | Aplicación de pago, no archivo REP. |
| `GET /deposits/complement/{depositId}` | `complementProviders.availableIqComplement`. La nota canónica de 2026-09-20 describe `200` con URL y `400` con mensaje exacto de ningún REP adjunto. El canario **no lo invocó**. | Es el recurso específico conocido para consultar un REP adjunto y su URL. Falta una respuesta productiva observada en este caso. |
| `POST /deposits/{depositId}/complement` | `requestIqComplement`; ruta de generación C. | Acción externa distinta. No se usó en el canario ni está autorizada para el histórico. |
| URL de Active Storage y ZIP | `boundedDownload`, `importIqComplement`, `validateRep`, `saveComplementDocuments`; probado con simuladores. | La URL permite intentar recuperar. Solo XML timbrado validado y PDF pareado verifican el REP aplicable. No hay descarga IQ real exitosa registrada. |

Se revisaron `COMPLEMENTOS-AUTOMATICOS-2026-09-20.md`, `IQ-HUGO-SEGUIMIENTO-2026-09-20.md`, adaptadores IQ de depósitos/aplicaciones, suites de emulador, auditorías locales y archivo operacional preservado. No apareció una especificación oficial de IQ, fixture de respuesta REP real, semántica documentada de `rep`/`can_request_rep` ni implementación anterior que hubiera descargado y vinculado correctamente un REP IQ real. La búsqueda pública tampoco encontró documentación primaria pertinente. Cloud Logging no conserva el cuerpo de la respuesta del canario.

## Observación productiva y límite del fixture

La bitácora productiva prueba: una coincidencia exacta del depósito, `conciliation_status = Conciliado`, `operation_status = En Operacion`, `rep !== true`, `can_request_rep !== true`, sesión abierta y `IQ_REP_REQUEST_STATE_REQUIRES_REVIEW`. No capturó si los dos campos estaban ausentes, en `false`, en `null` o con otro valor. El archivo `qa/fixtures/iq-rep-canary-ap1c4u1e6-observation.json` preserva **esa observación sanitizada**, no una reconstrucción ficticia del JSON de IQ. Las variantes ausente/`false`/`null` son vectores sintéticos de regresión, no hechos observados sobre IQ.

## Estados observados o descritos

| Estado IQ o respuesta | Evidencia disponible | Qué podemos afirmar | Qué no podemos afirmar | Acción segura de Hugo |
| --- | --- | --- | --- | --- |
| Depósito del canario: `Conciliado`, `En Operacion`, ambos predicados REP distintos de `true` | Bitácora del canario y rama exacta del adaptador | Hay depósito coincidente y la política actual no interpreta esos campos. | Presencia exacta de campos, REP generado, archivo disponible o solicitud permitida. | `STOPPED`; conservar caso y no ejecutar C. |
| Depósito con `rep === true` | Solo rama implementada; sin respuesta real conservada | El listado reportaría literalmente ese indicador. | Que el archivo exista, sea descargable o corresponda al pago. | Consultar recurso REP específico bajo B; validar contenido si da URL. |
| Depósito con `can_request_rep === true` | Solo rama implementada; sin contrato del proveedor | El listado reportaría literalmente ese indicador. | Que IQ acepte una solicitud C o que el REP esté ausente. | No habilitar C histórico; exigir contrato/evidencia separada. |
| `GET /deposits/complement/{id}` → `200` y URL HTTPS | Contrato escrito en nota interna y parser `iqAvailability`; solo pruebas simuladas | IQ ofrece una URL de REP adjunto para ese depósito. | XML timbrado correcto, parcialidad/UUID/importes o PDF válido. | Descargar dentro de B, validar y verificar vínculos antes de `RECEIVED`. |
| Mismo GET → `400`, error exacto «El depósito no tiene ningún REP adjunto» | Nota interna y parser; solo pruebas simuladas | Ese recurso informa que no hay REP adjunto disponible en ese momento. | Que nunca se generó un REP, que IQ permita solicitarlo, o que otros recursos no lo tengan. | `PENDING` de recuperación con evidencia y siguiente consulta B; jamás pasar automáticamente a C. |
| Mismo GET → otro estado/cuerpo, URL inválida o múltiples archivos candidatos | Reglas defensivas del adaptador | Resultado no clasificado. | Existencia, ausencia o correspondencia fiscal. | `STOPPED` y revisión; no marcar `RECEIVED`. |

## Respuestas a las tres preguntas

1. **REP generado:** no hay fuente canónica demostrada para el estado de *generación*. Un `200` con URL en el recurso específico y un XML timbrado válido sí prueban que existe un REP recuperable y aplicable; un `400` de «no adjunto» no prueba que nunca se haya generado.
2. **Disponible para consulta/descarga:** el mejor recurso específico identificado es `GET /deposits/complement/{id}`. Su `200` con URL permite intentar la descarga; la disponibilidad efectiva y pertinencia se prueban después con ZIP, XML/PDF y hashes. El listado del depósito no sustituye esa consulta.
3. **IQ permite solicitar generación:** no hay fuente canónica demostrada. `can_request_rep` es un nombre de campo usado como condición en nuestro adaptador, sin definición documentada ni respuesta histórica que pruebe su alcance. Esta pregunta pertenece a C y queda pendiente.

## Consulta mínima y cambio propuesto, aún no implementado

La mínima observación adicional para el caso detenido es **una sola consulta autenticada `GET /deposits/complement/{depositId}`**, con perfil y permisos B vigentes, sin repetir el listado del depósito. Sanitizar y conservar código HTTP, forma del cuerpo, presencia de URL y razón de error; nunca token, URL firmada completa ni documentos. Un `200` habilitaría descarga/validación B; el `400` exacto permitiría afirmar solo «sin REP adjunto disponible ahora» y programar nueva lectura B. Otra respuesta mantendría `STOPPED`. Esa consulta es B: método GET, no crea REP ni modifica IQ. Su autorización no implica C.

Propuesta para revisión posterior: separar `inspectDepositForIdentity` de `lookupAttachedRep`. El primero valida ID y condiciones operativas sin usar `rep`/`can_request_rep` para decidir disponibilidad; el segundo clasifica exclusivamente la respuesta del recurso REP. Mantener `requestGeneration` con política C independiente y sin inferir elegibilidad de los resultados B. Antes de desplegar, confirmar con IQ la semántica oficial del endpoint y los dos campos, y probar que el GET específico es inocuo. **No se cambia todavía el adaptador o la política** para acomodar el canario.

Regresiones necesarias: fixture de observación real limitada, valores ausente/`false`/`null` sin inferencias, `200` con URL, `400` exacto, otros 4xx/5xx/cuerpos, URL inválida, ausencia de POST C en cualquier rama B, identidad del depósito, root/perfil/permiso/cuota y ZIP ambiguo. La prueba local incorpora las primeras variantes y el contrato simulado del recurso REP; faltan fixtures reales del GET específico. No es seguro repetir el canario hasta contar con esa evidencia y aprobar la modificación de B.
