# Registro automático desde comprobante: backend

Estado: LOCAL_VALIDATED_CANONICAL_PENDING. Paquete nuevo; no publicado ni autorizado. No altera el dossier de identidad78 ya publicado. La evidencia fuente es distinta de las pruebas del ZIP.

## Alcance

Dos destinos exclusivamente: parsePagoReceiptPdf y correctPagoReceiptSemanticField. Base publicada78; conserva index shim y bundle original,954 archivos originales salvo tres JS, y añade únicamente receiptOperationType.js. Cambian receiptIdentificationDomain, receiptIdentification y receiptPdfCallables. Semantics, learning, createPago, reglas, permisos e IAM quedan intactos. No hay export público nuevo.

Nombres únicos corroborados por el catálogo permiten identificación automática; normalización de razón social y omisión del cliente siguen el dominio final. La fecha local DMY se interpreta antes de decidir registro y la política de extracción4 refresca una vez la caché3 bajo la misma identidad conservando correcciones privadas. Se conservan flags de evidencia y validaciones monetarias; no se finge ejecución bancaria ni conciliación.

El tipo explícito conserva validación canónica existente de existencia/activo sin ampliar ni restringir su scope previo. Sin tipo se admite sólo una operación activa, categoría OPERACION, root actual o legacy sin root, catálogo máximo500. Cero/múltiples/exceso requieren revisión; no se inventa un tipo ni se infiere por SPEI. resolvedOperationTypeKey devuelve la clave canónica al frontend, incluso si quedan otros motivos de revisión.

## Identidad

Fuente final09df06a0084b9a11558213846e0ee4b4a1ed50cf. Base78f7403fa7011069eafc1a99bd01c4388bc40e075d450d224e4c8a7dff79056b. Patch completo4TS c8a78e4fc9762844a2005074f18680c59e04073301e25f33e357ce98954cf008. ZIP846b9c5c925a895b22ddf635530371f060eeed458371223264c992db3919ca43. Directorio privado receipt-drop-auto-candidate. Comparación derivada:1177 entradas/955 archivos;951 preservados,3 cambiados,1 añadido,0 borrados. Orden original preservado y nuevo módulo con metadata fija para reproducibilidad. sourceTree=null.

Receta nueva qa/scripts/build-receipt-drop-auto-overlay.mjs: ocho argumentos ZIPbase78, fuente baseline78, TypeScript, patch, SHApatch, commit origen, salida privada nueva y BUILD. Verifica tres emisores baseline antes de aplicar patch y rechaza fuentes adicionales. No copia lib raíz ni modifica recetas históricas.

## Evidencia y límites

Fuente raíz: NORMAL81133 EXIT0,62 pruebas fuente y27 de cuota/caché PASS; flujo público15 PASS en emulador fuente; identificación102 y creación canónica33 PASS, emuladores cerrados. No se atribuye esa evidencia al ZIP.

Startup y flujo exactos PASS, descritos abajo. Pendientes canónico literal npm ci, input, preflight GET y aprobación específica. No hay verificacion funcional productiva.

createPago sigue validando RFC presente contradictorio y todas sus reglas financieras. READY no garantiza éxito si existen conflictos posteriores, costos ausentes u otros requisitos canónicos. No se ejercen IQ, bancos ni proveedores reales. metricIdentifiedAutomatically heredado no prueba por sí solo OCR automático; evidence distingue selección manual.

## Entrega y reversión

Hosting del flujo DROP es un paquete separado; no está autorizado implícitamente por este backend. La UI debe adoptar resolvedOperationTypeKey sólo si no hay elección explícita y rechazar contradicción con el payload. La fecha corregida explícitamente por un usuario conserva precedencia según contrato del parser.

Reversión autorizada futura: sólo ambos endpoints a fuente78/configuración/IAM preservados, sin borrar análisis/correcciones/pagos ni alterar flags. Si se revierte la familia UI, coordinar backend antes de retirar la UI protectora para no dejar auto-registro legado ante contratos incompatibles. Conservar recibos/locks y reconciliar operaciones inciertas antes de repetir PATCH.

## Pruebas del ZIP exacto

Startup48174 EXIT0:354 exports/endpoints,352 referencias/descriptores preservados,2 registros iguales y2 denegaciones anónimas, red bloqueada antes de importar. Proof f9d4504932090f697ad6d988d875176231a5eed368a0528d9f11bf696a26ebb7. Sólo dependencias privadas certificadas del ZIP78, todos los archivos base y package/lock iguales, rutas físicas/cierre offline PASS. Es prueba adicional, no sustituye npm ci literal canónico.

Flujo completo40927 EXIT0: envelope qa/scripts/receipt-drop-auto-fullflow.cjs ejecuta el QA público raíz sin editarlo, vincula ZIP/runtime antes/después y conserva stdout/stderr.15 checks PASS: PDF real sin IDs/tipo con fecha05/06/2026, parse READY y clave canónica, createPago público, init/upload/finalize y replay sin segundo pago, CONCILIACION_PENDIENTE y aplicaciones0. Un pago SINTÉTICO creado en proyecto demo Firestore/Storage separado; cero llamadas productivas/proveedores. Proof05ad3916986f4891b9e24bfc9e5cfed802b89addfe9a110282d8618e1b91b69f. Se conservan warnings deprecación y secreto no configurado; no contienen valor ni se interpretan como envío real.

Regresión12945 EXIT0 en OTRO proyecto demo Firestore:33 comprobaciones documentales,8 monetarias, PDF sin RFC/cuenta/IDs/tipo READY/date2026-06-05/operaciónDEMO, cambio tras auto y correct conserva IDs, opciones ajenas/inactivas denegadas. Caché3 obsoleta refresca a4 una vez conservando identidad/createdAt/correcciones y versiones privadas de dos actores; siguiente lectura cacheHit. Flags amountVerified/executionConfirmed permanecen false. Cero pagos/solicitudes/aplicaciones creados, no se borró el pago del otro proyecto para conseguirlo. Proof072fa6b56c0a09e4d948c3799a12638372e1d840b2efbfe8f56232cdbca210d0. Emuladores cerrados.

Comparación estructural independiente raíz PASS en candidate/root-independent-preservation.json:3JS cambiados,1 módulo añadido,951 preservados,0 borrados, orden base intacto. No se afirma prueba de reglas de seguridad por usar Admin SDK en emuladores.
