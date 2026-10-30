# Registro automático desde comprobante: backend

Estado: **INCOMPLETE / PAUSED_BY_USER**. La prueba funcional posterior fallo: el flujo requiere seleccion manual adicional y devuelve «La identificación cambió; vuelve a revisar el comprobante. [400]». La deteccion de duplicados no quedo confirmada. El usuario ordeno detener este frente y terminar los demas antes de retomarlo, tanto para archivo como imagen. No se haran nuevos desarrollos, diagnosticos o despliegues de esta familia ahora. La publicacion tecnica anterior se conserva como historial; no acredita cierre funcional.

## Resultado y alcance

Dos destinos exclusivamente: parsePagoReceiptPdf y correctPagoReceiptSemanticField, grupo receipt-learning-overlay, BUNDLED_V1,354 exports. Tres JS existentes cambian: receiptIdentificationDomain, receiptIdentification y receiptPdfCallables; se añade únicamente receiptOperationType.js. Semantics, learning, index shim, bundle original, createPago, reglas, permisos e IAM se preservan. Sin exports ni Functions nuevos.

Nombres únicos corroborados por el catálogo permiten identificación automática; normalización de razón social y omisión del cliente siguen el dominio final. La fecha local DMY se resuelve antes del registro, incluida «Fecha de operación:» y su valor en líneas separadas.05/06/2026 produce2026-06-05; fechas contradictorias o no resolubles requieren revisión. Policy4 refresca una vez la extracción3 bajo la misma identidad, preservando createdAt y correcciones/versiones privadas de todos los actores. No se convierten flags de confianza o ejecución a true ni se afirma conciliación bancaria.

Tipo explícito: existencia/activo y scope canónicos anteriores, sin fallback a otro tipo. Sin selección se resuelve sólo una opción activa categoría OPERACION del root actual o legacy sin root; límite500. Cero/múltiples/exceso requieren revisión. No se infiere SPEI ni se inventa un default. resolvedOperationTypeKey devuelve la clave canónica, incluso si quedan otros motivos de revisión; createPayload conserva operationTypeKey habitual.

## Identidad y reproducción

Fuente final002671f999390ff737ce5d02be0a9f6d2cee96c8. Base publicada/rollback78f7403fa7011069eafc1a99bd01c4388bc40e075d450d224e4c8a7dff79056b. Patch completo4TS9babe8011e12608ffe47d02b9c386b5aada4349611e817333a2c7ffda3f4e6d2. ZIPa052fafbe33ce77e4972092a4b244365f46000628dcd01301e5ed8a0eb032373, en receipt-drop-auto-candidate-v2. sourceTree=null.

Counts derivados:1177 entradas/955 archivos,951 archivos preservados byte a byte,3JS cambiados/1 añadido/0 borrados. Orden completo de entradas base preservado; único módulo añadido con metadata fija1980. Comparación estructural independiente raíz PASS en candidate-v2/root-independent-preservation.json. La primera sonda de revisión raíz abortó al detectar varios ZIP; la comparación válida usó el archivo base exacto receipt-identity.zip de hash78.

Receta qa/scripts/build-receipt-drop-auto-overlay.mjs: ZIPbase78, fuente baseline78, TypeScript, patch, SHApatch, commit origen, salida privada nueva y BUILD. Verifica emisores de los tres módulos existentes antes del patch y allowlist exacta de cuatro fuentes. No usa lib raíz ni modifica recetas históricas.

## Evidencia exacta v2

Startup44009 EXIT0:354 exports/endpoints,352 referencias/descriptores preservados,2 registros y2 denegaciones anónimas; red bloqueada antes de importar. Proofa43135aadba478bfb7d27668906355f06662af2d96b8f5fcdce53b7df82b1b2f. Sólo dependencias privadas certificadas, ZIP previo846 verificado y proofec51d8ebd091f364825a3e4e4b4607542a1db3b743dcb7c10e5c9d34f766f298, package/lock iguales, rutas físicas/cierre offline PASS. Esa prueba adicional no sustituye npm ci literal canónico nuevo.

Flujo público exacto92601 EXIT0:15 checks PASS con PDF real, etiqueta de fecha separada, sin IDs/tipo, parse READY/fecha canónica/tipo, createPago público, init/upload/finalize público y replay sin segundo pago, CONCILIACION_PENDIENTE/aplicaciones0. Un pago SINTÉTICO en proyecto demo Firestore/Storage, cero producción/proveedores. Proof9f8ef4711b4716be8fffab60ee5fbdbfcf0fc4d4754f07616bc2ff369fc2cf5e. Envelope verifica ZIP/runtime y QA público antes/después; publicQaSha2560edb2b5ed6b2f8f3d1ebdc27674a771bb5d561feff0ebdf1504be9ea0a3a32ac. Se conservan warnings deprecación y secreto no configurado, sin valor ni envío real. No se atribuye cero escrituras financieras a este caso.

La regresión adicional corre en OTRO proyecto demo Firestore y exige colecciones financieras vacías; no borra el pago del fullflow. Incluye33 comprobaciones documentales,8 monetarias, fecha split sin IDs/tipo, selección/corrección/aislamiento y caché3→4 preservando actores. Resultado final: segundo intento PASS exit0; primer intento FAIL exit1 por transacción cerrada, preservado y descrito abajo.

Fuente raíz separada: NORMAL final63368 EXIT0,30 pruebas de fechas y27 de cuota/caché PASS; revisión independiente del fix PASS. No se atribuyen esas suites fuente al ZIP. El fixture fuente09df anterior y el ZIP846 no cubrían el bug final de etiqueta separada y no son el artefacto final.

## Límites, UI y reversión

createPago preservado puede rechazar RFC presente contradictorio, costos ausentes y demás reglas financieras; READY no garantiza creación ante esos conflictos. No se ejercen IQ, bancos ni proveedores productivos. metricIdentifiedAutomatically heredado cuenta READY incluso manual; evidence distingue selección. Admin SDK en emuladores no certifica reglas de seguridad.

Backend puede entregarse con aprobación propia sin esperar Hosting; su publicación sola no completa DROP→AUTO para el usuario. La UI publicada anterior requiere el paquete UI separado que adopta resolvedOperationTypeKey y elimina barreras locales ya resueltas por el servidor; no se autoriza implícitamente aquí. La UI debe preservar elección explícita y rechazar contradicción con el payload servidor. La base UI externa se reconcilia por su propietario, sin alterar este ZIP.

Reversión futura autorizada: restaurar sólo ambos endpoints a ZIP78/configuración/IAM preservados, sin borrar análisis/correcciones/pagos ni cambiar flags. Coordinar cualquier rollback Hosting como familia, manteniendo la UI protectora hasta verificar la reversión backend. No revertir chat/MEMORY ni dar por aplicado el dinero. Conservar recibos/locks y reconciliar operaciones inciertas antes de repetir PATCH.

## Regresión intermitente declarada

Primer intento9535 EXIT1: shared33 abortó con Firestore INVALID_ARGUMENT Transaction is invalid or closed; no se cuenta PASS. Logs del emulador localhost62609: inicio17:34:09 local, HTTP2 17:34:23, lock timeouts desde17:34:32 e invalid/closed desde17:34:36. No hay checkpoints para identificar el await exacto; el escenario de8 correcciones legacy concurrentes existe, pero su atribución al fallo no está probada. No se afirma cold-load ni causa infraestructura. Diagnóstico5ff4e862aeb7ac02a482dfe184a8bde0717fa887504e4bbdf6dc666a0b9580c1.

Única repetición autorizada79628 en proyecto fresco: mismo ZIP/código/QA y assertions, PASS exit0; sin tercer intento.33 checks compartidos,8 monetarios, fecha split y tipo único canónico, aislamiento/correcciones/cache3→4 y0escrituras financieras. Proofb9ab698b77414dc3f11d8ab77369238ad14c54062d16308df15595d2a86b8714. El caso8 concurrentes del intento PASS conserva un correctionId y versión1; no es garantía universal de concurrencia ni PASS agregado sin fallos.

Comparación AST de fuente PDF respecto78: transacción de corrección idéntica; transacción de caché sólo cambia las dos constantes de política3 a4. Control de retry intacto. Proofc97ae43d10ace44a7dfc3ab43221ea0775db6b511b5ed87767bffc7abb90776d. Causa última del fallo no establecida; riesgo de error intermitente de confirmación bajo contención declarado. No se cambió producto para obtener el PASS.

Reproducción de receta en directorio nuevo EXIT0 produce el mismo ZIPa052; hashes de patch Git raw/filtered se comprueban antes del commit. Input final, canónico literal y GET fresco terminados; autorización recibida y publicación terminada; pendiente prueba funcional productiva del usuario.

## Input final, canónico y frescura

Commit de receta/patch/QA fd4a15d870f2350fd2917a79b02a3e72d0bc0ed1; fuente final002671f999390ff737ce5d02be0a9f6d2cee96c8; sourceTree=null. Input privado receipt-drop-auto-candidate-v2/release/input.json SHA686509c42b59b69f27c5f11781e251ec7a5376890e21d6b8dcca9b13684a7200. Scope exclusivo parsePagoReceiptPdf/correctPagoReceiptSemanticField, BUNDLED_V1/955 archivos. Base78/patch9babe/ZIPa052 completos arriba; baseline previa7933ff5e48ba642500a7fca48cfdbd928b10928387b4003babb5e6b8aae19efb.

Canónico inmutable qa/scripts/verify-scoped-functions-artifact.cjs:8405 EXIT0/PASS, npm ci --omit=dev literal en runtime privado nuevo,354 endpoints y2 denegaciones. Proofc965fff05980f852fde8bc4f6d958c81a13ef6980e304855bafe2994004ca446, release/artifact-verification.json. No se reemplazó la instalación por un interceptor ni por reuse no admitido. assertArtifactProof independiente raíz PASS.

Primer GET25322 EXIT1 por una operación activa global; antes pasaron los asserts de fuentes/configuración/Run/IAM, pero no hubo recibo PASS ni0ops. La inspección acotada siguiente observó0activas; la operación concluyó antes de identificar su target. No se atribuye tipo, actor ni causa. Logs y observación se conservan; no hubo retry loop.

Única captura completa posterior81229 EXIT0/PASS2026-10-21T00:09:26Z: dos fuentes descargadas78, revisiones00018-zab/00007-qud, configuración/Run/IAM iguales a baseline, driftfalse y0operaciones activas. Cero lecturas de negocio/mutaciones. Proof9adc7c4a26c163ed94a97f09f9460d16e3e10181843dee461b0ab5d9006acd7c, release/fresh-preflight-66e827fb-67d3-4d4f-837c-10dc47becf2c.json. El ejecutor debe revalidar frescura antes de mutar; este recibo no garantiza ausencia de cambios futuros ni autoriza despliegue.

La aprobación solicitada es sólo backend y debe mencionar la intermitencia1FAIL/1PASS, el fullflow15 con un pago sintético y la dependencia de nueva UI para el objetivo DROP→AUTO del usuario. Publicar backend no constituye COMPLETED del recorrido. Hosting se reconcilia y autoriza por separado sobre su baseline productiva fresca.

## Publicación autorizada y postverificación

Usuario autorizó expresamente los bytes input686509c42b59b69f27c5f11781e251ec7a5376890e21d6b8dcca9b13684a7200/ZIPa052fafbe33ce77e4972092a4b244365f46000628dcd01301e5ed8a0eb032373 y rollback78. El ejecutor raíz14677 concluyó EXIT0, ambos CONFIGURATION_VERIFIED: parsepagoreceiptpdf-00019-tec y correctpagoreceiptsemanticfield-00008-xew. Fuentes78 previas preservadas; reversión NO utilizada. Sin otras Functions ni Hosting incluidos en esta publicación backend.

Postverificador independiente95239 EXIT0/PASS2026-10-21T00:32:33Z: ambas fuentes descargadasa052 exactas, ACTIVE, revisiones listas y generaciones observadas, configuración de runtime/Run/IAM preservada, dos HTTP401 UNAUTHENTICATED y0operaciones activas. Cero documentos de negocio leídos y cero mutaciones del verificador. Proof012e7134ff8aec7ed8853fbd98d1e352ef3435980a8522972d6ba5ddfdfa9467; baseline publicada08c255f1c1fa8b62197e84ffe9bc4784a658ab54a670c3741ae0b614edd91f24. Recibos y ZIPs descargados en release/independent-post-publication-8cf3a3c1-370d-4764-8c2d-379796487e70.

La verificación técnica no convierte el recorrido del usuario en COMPLETED. La nueva UI se autoriza/publica por separado; tras ella sigue pendiente comprobar el DROP real y el resultado canónico desde una sesión autorizada. No se ejercieron datos productivos, proveedores ni conciliación real. No hubo rollback ni nuevas consultas tras el postverificador registrado.
