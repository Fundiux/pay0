# Hugo: preflight de publicación acotada

Actualizacion2026-10-10: la compatibilidad historica descrita abajo ya esta
implementada en fuente dfbe7ae y probada en a751ec0:89sinteticos, phase4/5 y
15checks historicos con cuatro consumidores y tres retriesSDKcontrolados PASS.
BuildcentralFunctionsPASS. No reescribe historicos; exige fuente inequívoca en
transaccion. Ver HUGO-HISTORICAL-EVIDENCE.md. Integracion siguea71a8b8 congelada
por loteIQ y aun no incorpora ese helper; no publicar sus consumidores todavia.
Los parrafos inferiores que dicen propuesta/noimplementada son historicos.
Siguiente: integrar hunks preservando capacidades adicionales de conversacion
del worktree, verificar artefacto exacto y configuracion de cuatro exports.

Fecha: 2026-10-09. Revisión de fuente y metadatos; ninguna publicación, lectura de registros históricos, ejecución de modelos ni cambio de integración. Integración `c29260b` contiene `6de1af4` y `06e4527`; coordinación central informa build Functions, 57 pruebas sintéticas y emuladores fases 4/5 PASS. Esta revisión no repitió esos gates.

## Decisión

El lote exacto que publica las guardas completas consta de **cuatro exports**. No requiere publicar todos los callables Hugo ni todos los productores. Sin embargo, la fuente integrada **no resuelve la compatibilidad de observaciones históricas sin `sourceSystem`**. Publicar los cuatro ahora protege nuevas promociones, pero no puede anunciarse como continuidad operacional de las cohortes antiguas. Tampoco hay evidencia de que exista actualmente una cohorte completa elegible: no se consultaron documentos reales.

Recomendación: preparar primero compatibilidad verificable y sólo entonces publicar los cuatro consumidores. Mientras tanto sí existe un lote útil más pequeño: portar exclusivamente la corrección transaccional y de fechas finitas de `6de1af4` a un artefacto selectivo preservando capacidades desplegadas, y publicar **sólo `linkAgent007VerifiedExperience`**. Conserva el contrato histórico de identidad y corrige NaN/carrera; deja explícitamente pendiente el defecto de identidad completa de `06e4527`. No equivale a desplegar el HEAD actual, no cierra todo el hallazgo y necesita su propio diff/build/regresiones. Esta revisión no construyó dicho artefacto.

## Exports y alcance

| Export | Guardia publicada al desplegar fuente integrada | Dependencia relevante |
|---|---|---|
| `linkAgent007VerifiedExperience` | Promoción de memoria: identidad completa, cronología finita y relectura atómica | `FirestoreHugoDataStore.linkVerifiedExperience` |
| `createAgent007LearningExperience` | Nueva experiencia desde memoria verificada, identidad de las fuentes | `FirestoreHugoLearningStore.createFromVerifiedMemory` / `buildVerifiedExperience` |
| `createAgent007LearningDraft` | Borrador desde decisión y observación de la misma identidad | `createDraftFromDecision` / `buildDraftExperience` |
| `linkAgent007LearningOutcome` | Resultado terminal de la identidad del borrador | `linkOutcome` / `withOutcome` |

Referencias: `functions/src/index.ts:2949`, `modules/agent007/callables.ts:265`, `firestoreHugoDataStore.ts:157`, `firestoreHugoLearningStore.ts:17`, `:47`, `:103`, `hugoCore/evidenceIdentity.ts`. Búsqueda del repositorio no encontró otros invocadores de estos cuatro métodos de promoción. Diagnósticos, listados, trazas, purge, revisión humana y correcciones no necesitan redeploy para transportar estas guardas. El actor de los callables se autentica y autoriza en servidor; el cambio no concede autoridad financiera.

La promoción de memoria revalida las fuentes **antes** de devolver un resultado existente; por tanto incluso el replay de memoria con fuentes incompletas puede fallar. Los dos métodos `create*` de learning devuelven un registro determinista existente del mismo root **antes** de reconstruir sus fuentes: conservan ese replay, sin certificar de nuevo su procedencia. `linkOutcome` exige borrador pendiente e identidad completa. No se invalidan ni corrigen automáticamente memorias o aprendizajes históricos ya almacenados.

## Evidencia desplegada seleccionada

Consulta `gcloud functions describe --gen2 --region us-central1 --project pay-0-system` limitada a nombre, updateTime, entryPoint, storageSource y revisión. Nunca se imprimieron variables de entorno/configuración privada. Todos los objetos siguientes están en `gcf-v2-sources-751158244178-us-central1`, ruta `<export>/function-source.zip`.

| Export | Revisión | Generación fuente | updateTime UTC |
|---|---|---|---|
| linkAgent007VerifiedExperience | `linkagent007verifiedexperience-00002-fop` | `1790583858009779` | 2026-09-28 08:24:30 |
| createAgent007LearningExperience | `createagent007learningexperience-00002-kim` | `1790583858403624` | 2026-09-28 08:24:46 |
| createAgent007LearningDraft | `createagent007learningdraft-00002-sul` | `1790583861348821` | 2026-09-28 08:25:36 |
| linkAgent007LearningOutcome | `linkagent007learningoutcome-00002-qad` | `1790583861314161` | 2026-09-28 08:25:34 |
| requestClientDispersionIncident | `requestclientdispersionincident-00023-lix` | `1791574766265474` | 2026-10-09 19:41:35 |
| resolveClientDispersionIncident | `resolveclientdispersionincident-00023-yoy` | `1791574887309576` | 2026-10-09 19:41:41 |

Se descargaron por generación exacta únicamente ZIP de `linkAgent007VerifiedExperience` y `resolveClientDispersionIncident` a TEMP `pay0-remediation-20261009-sources/<export>-<generation>.zip`. Lectura interna limitada a cuatro fuentes: observer, dos stores Hugo y logActivity; no se abrieron `.env` ni configuración privada. No se atribuye el contenido de un ZIP a los otros exports sólo por compartir fecha.

Ambos artefactos contienen el mismo observer sin persistencia de `sourceSystem`, SHA256 de texto UTF-8 `fbd7ea33ee24fcd1dd8756714fee8419ecc7c2a5e74f08a44826c13c267e6e9a`; logActivity sí calcula el sistema, SHA256 `48f33f765ba84b9cbd55c30abebd4b71fdf6ea6c7e7f62a025eaed3b35b92fbd`. Store de memoria SHA256 `a814b49752b6ad4aab6222e8e1eafa283183bbee413e9f1a5bc0ce17128bdfbe`: promoción lee fuentes fuera de transacción (líneas 164–185 del artefacto), compara `Date.parse` sin finitud y no compara tipo/sistema. Store learning SHA256 `79f11669f252a5e5ca34af7e225c59378dc925e1657409ac6d8344ed4da8741a`. Estos hashes identifican los archivos leídos, no certifican todo el ZIP.

## Compatibilidad sin fabricar procedencia

La identidad estricta es `(sourceSystem, tipo canónico, entityId)` más root validado aparte. No basta igual ID ni una relación pago/solicitud. El observer nuevo escribe sistema explícito desde logActivity, pero se empaqueta dentro de cada productor: publicar un consumidor no actualiza sus copias antiguas.

Propuesta posterior, todavía **no implementada**: resolver legado sólo al promover, dentro de la misma transacción, usando `sourceActivityId` validado y fuentes backend de colecciones explícitamente permitidas. Exigir coincidencia de root, evento, identidad tipada y enlaces; conservar cronología de la observación y validar también timestamps originales sin exigir igualdad artificial entre server timestamps de escrituras separadas. Admitir sistema ausente únicamente si la fuente autoritativa aporta prueba inequívoca. Contradicción, fuente ausente o múltiples candidatos: rechazo explícito. Nunca asignar PAY0 por defecto, aceptar sistema del navegador ni reescribir observaciones históricas.

El contrato necesita cubrir `pay0ActivityLog`, `assetsActivityLog`, `tttActivityLog`, `hugoActivityLog` y la excepción **verificada por productor** de `activityLog`: `paymentApplications/service.ts:672` y `:703` pasan DocumentReference explícita a `logActivityTx`, que conserva esa colección. No buscar indiscriminadamente todos los logs ni confiar sólo en el prefijo del evento. Fijar presupuesto máximo de lecturas por fuente y probar ambigüedad, root/tipo/sistema distintos, referencias manipuladas, NaN y carrera transaccional. Una decisión sin identidad completa tampoco se debe rellenar por conjetura; requiere prueba vinculada o nueva revisión humana explícita.

La alternativa sin compatibilidad es publicar productores selectivos para una **cohorte nueva completa**, manteniendo operaciones antiguas de observación/consulta; esto no rescata promociones históricas ni elimina el gate de disponibilidad. No justificar el rechazo de todos los históricos como solución de compatibilidad.

## Productores selectivos: rutas que sí existen y trampas

* `applyPagoToSolicitud` y `applyPagoToSolicitudesAtomic` llaman `applyPaymentApplicationBatchAtomic`: producen `PAGO_APLICADO_A_SOLICITUD` (identidad PAGO) y, al completar saldo, `SOLICITUD_COMPLETADA` (identidad SOLICITUD). Son entidades distintas; no unirlas porque un log incluya `relatedEntityId`. Necesitan una observación inicial y decisión posteriores al cutover del productor correspondiente para formar una cohorte nueva completa.
* `createClientDispersion` y `createClientDispersionsMassive` producen `DISPERSION_REGISTRADA`; `resolveClientDispersionIncident` produce `DISPERSION_INCIDENCIA_RESUELTA`. La pareja acotada **createClientDispersion + resolveClientDispersionIncident** puede generar principio/resultado de una nueva dispersión, con decisión humana entre ambos, sin redeploy masivo. Cada export exige diff contra su artefacto actual y regresiones financieras propias; no proponer operaciones reales de dinero para probar Hugo.
* **No usar `requestClientDispersionIncident` como inicio supuesto:** emite `DISPERSION_INCIDENCIA_SOLICITADA` (`financing/callables.ts:2211`), mientras observer permite `DISPERSION_INCIDENCIA_ABIERTA`. El primero no genera observación con el observer actual. Añadir un evento sería un cambio separado, no consecuencia automática de desplegar el observer.
* `reconcileOperationRecovery` produce `OPERACION_RECUPERADA`; no es necesario publicar ni ejecutar recuperación financiera/documental para transportar las guardas consumidoras.
* `resolveAgent007Recommendation` crea decisiones PAY0 con vínculo de observación; no es parte necesaria del lote de cuatro. Su sistema fijo no demuestra compatibilidad multistema. `recordAgent007Observation` manual no equivale a fuente ACTIVITY_LOG y no debe usarse para inventar evidencia backend.

## Gates y rollback

1. Elegir explícitamente lote transaccional parcial o lote completo con compatibilidad probada. El comando futuro debe enumerar los exports, nunca `--only functions` global.
2. Comparar ZIP actual de cada export del lote; preservar capacidades y configuración sin imprimirla. Build del artefacto exacto y regresiones de legado verificable, rechazo ambiguo, replay y concurrencia. Para productores, pruebas de dominio adicionales sin proveedores/modelos.
3. Antes de afirmar disponibilidad, acordar evidencia agregada de elegibilidad histórica o una cohorte sintética aislada; no se hizo en este preflight. Publicar consumidores no cambia copias del observer de otros callables y esa limitación debe quedar en el cierre.
4. Conservar identificadores de artefactos/revisiones previos. Preferir corregir hacia delante una incompatibilidad; rollback de los consumidores reabre la debilidad conocida. No borrar ni alterar evidencia histórica para hacer pasar el release.

Resultado de esta tarea: sólo inspección y documento. Los metadatos y dos ZIP son evidencia remota de lectura; no hubo consultas de documentos, llamadas Hugo, ejecución de modelos/proveedores, pruebas de dinero ni despliegue.
