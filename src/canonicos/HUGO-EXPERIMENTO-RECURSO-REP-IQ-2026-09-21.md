# Experimento B: recurso específico de REP IQ

Estado inicial: `AP1C4U1E6` fue el único canario anterior y terminó `STOPPED` al interpretar campos ambiguos del listado de depósitos. Esta continuación no modifica aquella orden ni la política C. La Function `runHugoIqRepAttachmentExperiment` acepta una única orden `LOOKUP` para ese folio; comprueba el fingerprint del canario anterior, la aplicación y sus padres, root, permisos, perfil, Master, configuración y cuota B. Recupera el ID de depósito del plan local verificado y **no repite `GET /deposits`**.

La operación externa es una autenticación IQ si se necesita y **un `GET /deposits/complement/{id}`**. Se conserva status HTTP, tipo y tamaño del cuerpo, SHA-256, nombres de campos, presencia/tipo de `rep` y `can_request_rep` si aparecen en ese recurso, presencia de URL, forma HTTPS y coincidencia del error exacto. No se persisten token, URL firmada ni cuerpo bruto. La respuesta del listado anterior no se reconstruye: su presencia y valores exactos no fueron capturados.

Estados separados: `REP_GENERATION_UNKNOWN` permanece constante; `REP_ATTACHMENT_NOT_AVAILABLE` significa solo que el recurso no expone adjunto ahora; `REP_ATTACHMENT_AVAILABLE` significa `200` con URL; `REP_ATTACHMENT_AMBIGUOUS` detiene; `REP_VALIDATED` requiere descargar por GET el ZIP autorizado y validar XML timbrado, UUID, parcialidad, importes, saldos, moneda y PDF pareado. La descarga en memoria no guarda documentos ni marca `RECEIVED`. Un `400` con el mensaje exacto registra pendiente B y `nextCheckAt`; otra respuesta detiene sin reintento automático. Ninguna rama llama a solicitud de generación C.

El despliegue se limita a la nueva Function; la orden anterior queda `STOPPED`. No se amplía la cohorte ni se toca `AP1C6U1E2`.
