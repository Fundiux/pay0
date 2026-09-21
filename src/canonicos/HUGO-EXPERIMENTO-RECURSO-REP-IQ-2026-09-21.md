# Experimento B: recurso específico de REP IQ

Estado inicial: `AP1C4U1E6` fue el único canario anterior y terminó `STOPPED` al interpretar campos ambiguos del listado de depósitos. Esta continuación no modifica aquella orden ni la política C. La Function `runHugoIqRepAttachmentExperiment` acepta una única orden `LOOKUP` para ese folio; comprueba el fingerprint del canario anterior, la aplicación y sus padres, root, permisos, perfil, Master, configuración y cuota B. Recupera el ID de depósito del plan local verificado y **no repite `GET /deposits`**.

La operación externa es una autenticación IQ si se necesita y **un `GET /deposits/complement/{id}`**. Se conserva status HTTP, tipo y tamaño del cuerpo, SHA-256, nombres de campos, presencia/tipo de `rep` y `can_request_rep` si aparecen en ese recurso, presencia de URL, forma HTTPS y coincidencia del error exacto. No se persisten token, URL firmada ni cuerpo bruto. La respuesta del listado anterior no se reconstruye: su presencia y valores exactos no fueron capturados.

Estados separados: `REP_GENERATION_UNKNOWN` permanece constante; `REP_ATTACHMENT_NOT_AVAILABLE` significa solo que el recurso no expone adjunto ahora; `REP_ATTACHMENT_AVAILABLE` significa `200` con URL; `REP_ATTACHMENT_AMBIGUOUS` detiene; `REP_VALIDATED` requiere descargar por GET el ZIP autorizado y validar XML timbrado, UUID, parcialidad, importes, saldos, moneda y PDF pareado. La descarga en memoria no guarda documentos ni marca `RECEIVED`. Un `400` con el mensaje exacto registra pendiente B y `nextCheckAt`; otra respuesta detiene sin reintento automático. Ninguna rama llama a solicitud de generación C.

El despliegue se limita a la nueva Function; la orden anterior queda `STOPPED`. No se amplía la cohorte ni se toca `AP1C6U1E2`.

## Resultado real

Se desplegó solamente `runHugoIqRepAttachmentExperiment` en `pay-0-system/us-central1` y se lanzó una orden B para `AP1C4U1E6`. El fingerprint local coincidió con el canario detenido; Master, permisos, perfil y cuota B permitieron una nueva sesión. Se hizo **un GET** al recurso específico, sin repetir el listado de depósitos.

IQ respondió `HTTP 400`, `application/json`, objeto con única clave `errors` y único mensaje exacto `El depósito no tiene ningún REP adjunto`. El cuerpo tenía 56 bytes y SHA-256 `05d2404eff35ed73f26820bef7a5c3bb03d4012bd19098b874074408d91af3a4`; coincide con la serialización de `{"errors":["El depósito no tiene ningún REP adjunto"]}`. El fixture `qa/fixtures/iq-rep-attachment-ap1c4u1e6-2026-09-21.json` conserva esa respuesta sanitizada. El recurso no incluyó `rep`, `can_request_rep` ni URL; esto **no aclara la representación de esos campos en el listado de depósitos anterior**.

Clasificación: `REP_GENERATION_UNKNOWN` + `REP_ATTACHMENT_NOT_AVAILABLE`. No hubo descarga ni XML/PDF. No se ejecutó POST de generación. El seguimiento quedó `PENDING` para lectura B, con `nextCheckAt` aproximadamente 24 horas después de la consulta; el experimento quedó `PENDING_B`, sin reintento automático de esta orden. `/hugo` antes y después: 60 recorridas, 5 detectados, 0 procesados, 5 pendientes, 0 errores. La distribución cambió de cuatro `PENDING_PROVIDER_CONTRACT` a tres más un `PENDING`; `AP1C6U1E2` sigue en `WAITING_IQ_APPLICATION`.

El contrato real respalda clasificar **ausencia de adjunto en ese recurso y momento** para este status/cuerpo. No demuestra ausencia de generación ni elegibilidad C. Hay evidencia suficiente para proponer que el adaptador B consulte primero el recurso específico y trate este `400` exacto como pendiente B, manteniendo todos los demás resultados como ambiguos. Antes de repetir el flujo completo, esa modificación debe separarse del preflight de C, probarse y desplegarse; no se repite esta orden de experimento.
