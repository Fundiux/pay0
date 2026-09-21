# Verificación del nombre real de `can_request_rep?` en IQ

La evidencia histórica aportada por el usuario muestra que `GET /deposits` usa literalmente la clave JSON `"can_request_rep?"`, con valores reales `true` y `false`, junto con `"rep": false`, `conciliation_status: "Conciliado"` y `operation_status: "En Operacion"`. No hay evidencia de que IQ devuelva `can_request_rep` sin signo. El adaptador anterior leía `row.can_request_rep`, por lo que obtenía `undefined` cuando la respuesta contenía únicamente la clave real. Los mocks anteriores habían ocultado el error al usar la misma clave incorrecta.

El parser tipado ahora lee exclusivamente `row["can_request_rep?"]`; `rep` sigue leyendo la clave literal `rep`. Distingue booleano, `null`, ausencia y otro tipo; no acepta un alias sin evidencia. La regresión usa ejemplos mínimos sanitizados basados en las estructuras históricas confirmadas y la observación productiva específica de AP1C4U1E6.

## Lectura productiva única del depósito de AP1C4U1E6

Después de comprobar evidencia local, root, actor, perfil, permisos IQ, Master Switch, configuración y cuota B, se desplegó únicamente `runHugoIqRepDepositFieldProbe`. La orden `iq-rep-deposit-fields-ap1c4u1e6-v1` se reclama una sola vez, abre sesión IQ y hace un único `GET /deposits` filtrado por ID. No invoca el POST de generación ni consulta o descarga el adjunto. El registro quedó `OBSERVED`.

IQ respondió HTTP 200 con una coincidencia exacta para el depósito `220483`: `operation_status = "En Operacion"`, `conciliation_status = "Conciliado"`, `rep = false` y `"can_request_rep?" = true`. La presencia y los tipos fueron capturados explícitamente. El fixture `qa/fixtures/iq-rep-deposit-ap1c4u1e6-2026-09-21.json` conserva solo esos campos, sin token, URL, datos personales ni respuesta bruta. El experimento B previo observó por separado que `GET /deposits/complement/220483` devolvía el 400 exacto de adjunto ausente en ese momento.

**Conclusión:** el bloqueo original `IQ_REP_REQUEST_STATE_REQUIRES_REVIEW` sí fue causado por el nombre incorrecto del campo para este depósito. Con el parser corregido, IQ indica `can_request_rep? = true` para AP1C4U1E6. Eso es evidencia productiva de la señal de elegibilidad de IQ, no una solicitud enviada ni un REP generado. La política C sigue bloqueando antes del POST hasta una decisión separada; no se ejecutó C, no se amplió la cohorte y AP1C6U1E2 no se tocó.
