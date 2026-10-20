# Registro documental antes de conciliación

Estado: DEPLOYED_NOT_VERIFIED. Usuario confirmó que desaparecieron las dos barreras por amountVerified/executionConfirmed. El registro completo sigue INCOMPLETE por CLIENT/COMPANY_INSUFFICIENT_IDENTITY_SIGNALS, identificado como bloqueo distinto. Publicación autorizada y verificación técnica independiente PASS; no se afirma registro completo ni conciliación verificados.

## Comportamiento

Un comprobante con importe positivo utilizable puede recibir una propuesta de registro pendiente aunque amountVerified o executionConfirmed sean false. Ambos indicadores conservan su significado; no se fuerzan a true. Se retiran únicamente esas dos barreras, sus avisos bloqueantes y sus reviewReasons generales. La confianza por campo y executionStatus=UNCONFIRMED siguen visibles en la evidencia.

Se conservan fecha válida/verificada, identidad corroborada, acceso cliente/empresa/root, MXN, forma de pago, tipo de operación, versión actual, deduplicación y transacción. Saldo/comisión/IVA se excluyen antes de buscar importe prioritario, etiquetado o sugerido; importes contradictorios o malformados no proporcionan un monto registrable. No se usa el primer monto contradictorio como pago.

La política de extracción pasa de 2 a 3 conservando readerVersion y analysisId. La primera lectura reprocesa el original y actualiza sólo extracción/metadatos mediante merge; conserva createdAt, correcciones y versiones de todos los actores. La siguiente lectura usa caché. No se crean identidades nuevas ni se borran correcciones.

createPago ya registra CONCILIACION_PENDIENTE, posting PENDING, saldo disponible cero y conciliación nula. La aplicación automática exige CONCILIADO/APLICADO_PARCIAL, POSTED y disponible positivo. Adjuntar el comprobante sí conserva el flujo IQ existente: puede encolar creación/búsqueda si la automatización del root está habilitada. La conciliación requiere evidencia externa IQ conciliada y no terminal, no estos flags del parser. Este paquete no promete desactivar esa automatización ni crear un registro sin efectos operativos posteriores.

## Artefacto e identidades

- Destinos exclusivos: `parsePagoReceiptPdf`, `correctPagoReceiptSemanticField`; grupo `receipt-learning-overlay`, BUNDLED_V1.
- Fuente de las correcciones: `898ce34`, que incluye ad0cbcb y migración V3/filtrado monetario final.
- Commit de composición/receta/patch/QA: `2de7c45ab69400068001e39f0a5c5865d0506a9b`; sourceTree=null.
- Base LIVE/rollback: `f88b88d75f8b99737d7b0b72364eb2a7fc4cbb9784175d4750cbf71f3876513f`.
- Patch completo tres TS: `d40b6930a212ba9237ea965bdd3db5a75f77f9af443ec37da1bc957ab3be73e7`.
- ZIP candidato: `6e0dffaa8af33582f09c7caa0f1a071f751cf1529e616f56e1dbd795c49224d0`.
- Input: `4f4a803363069833a5c33f7eaa828aad699c3daebf20bd079d1972b03076318b`.
- Baseline previa a publicaci?n: `778f5e158c26a95c67f6ad77cee3be0447752cafb46eacaf02e3d0e004d4cf18`.

Input privado: `.firebase/modular-release/receipt-registration-candidate-v2/release/input.json`. Estado esperado previo: parse `00016-qoc`, correct `00005-qej`. Conserva orden y conjunto de 1176 entradas, cambia sólo tres JS, preserva 951 archivos byte a byte y no añade entradas. index shim, bundle original, manifests/lock y otros 352 exports permanecen intactos. No se copiaron fuentes raíz completas con cambios ajenos de selección de identidades. Tres emisores baseline coinciden antes de aplicar hunks. Reproducción independiente de la receta dio el mismo ZIP; raíz cotejó preservación y un revisor independiente cotejó los tres TS/hunks.

Receta versionada: `qa/scripts/build-receipt-registration-overlay.mjs`, argumentos ZIP f88, módulo TypeScript y nuevo directorio privado. Reconstruye la fuente PDF f88 desde sus commits/patch previos auditados; usa domain baseline 8af329e8 y semantics 4c3dcb90. El patch nuevo se aplica sobre esas fuentes verificadas. El patch almacenado conserva sus bytes sin modificación por filtros Git. El candidato previo fb651… está SUPERSEDED_NOT_FOR_RELEASE por el caso saldo total; no se autoriza ni se presenta como prueba final.

## Evidencia y límites

- Raíz: NORMAL final PASS y 63 pruebas source PASS. Emulador raíz separado: 93 identificación, 49 correcciones y 33 creación canónica, cero llamadas externas. Corresponde a integración fuente, no a mutaciones ejecutadas desde el ZIP.
- ZIP: startup real desde package.main, 354 endpoints, 352 referencias/descriptores preservados, dos registros idénticos y dos denegaciones anónimas. Red bloqueada antes de importar. Recibo `661404766b916015323b04624a10328bde038f52062215296db49a81776c9415`. Se reutilizó sólo una copia privada de dependencias certificadas f88 tras package/lock y todos sus bytes de archivo base iguales, rutas físicas y cierre npm offline PASS; no se atribuye nueva instalación a esa prueba adicional. Fallo previo de igualdad entre prototipos ResetValue de dos SDK se conserva; se corrigió sólo el comparador QA a metadata JSON, sin cambio de producto.
- ZIP: package.main y callables reales con Firestore demo/PDFs sintéticos: 33 regresiones documentales, ocho casos monetarios y migración real policy2→3. Comprueba ausencia de las dos barreras con ambos flags false, mismo analysisId, correcciones/versiones de dos actores y createdAt preservados, lectura posterior cacheHit y aislamiento. Recibo `a3fe98304ec605ccb3e2639ad8914a85cd016a477c0ee7ee4108588b06a4ebed`. Emulador cerrado, cero proveedores o escrituras financieras.
- Suplemento: 63 fixtures ejecutan JS del runtime con sus fakes de dependencias existentes. ZIP/runtime comparados antes/después y sustituciones reales de los tres módulos verificadas por hash. Alcance MODULE_ONLY, no package.main ni autorización productiva. Recibo `d4fcf947f46cd6d94ad1b27d24f8d3fda4ae80a756eabc05c642cf3c821605c2`. Se conserva el primer fallo del adaptador TypeScript; no se cuenta como PASS.
- Verificador canónico real, archivo inmutable `qa/scripts/verify-scoped-functions-artifact.cjs`: PASS exit 0, **npm ci --omit=dev literal** en runtime privado nuevo; 354 endpoints y dos denegaciones. Sin interceptar instalación ni fabricar proof. Recibo `e2b8966c4492d8c35f77aeb85fabe42c4319a3c310b95d7204b812a498ff2d2d`, `release/artifact-verification.json`. assertArtifactProof del controlador valida el contrato.
- Preflight exclusivamente GET, 2026-10-20T17:38:01Z: fuente descargada f88, recurso/configuración/Run/IAM iguales a baseline, cero operaciones activas y cero datos de negocio/mutaciones. Recibo `ba761610fa256e8dbfd8aec3f37defbef0d949206cfcf1a39fdcc9c1aff4db55`, `release/fresh-preflight-e8151aa3-cad5-49b4-a607-1d7a008bf784.json`. No garantiza frescura futura; el ejecutor vuelve a comprobar antes de mutar.

## Entrega y reversión

No requiere publicar UI nueva ni crear Functions. Usar únicamente el controlador scoped existente y el input/hash anteriores, después de autorización explícita. No tocar estados financieros, pruebas de ejecución, saldos, cuotas o flags para sortear validaciones. Conservar recibos/locks; una operación incierta exige reconciliación antes de reanudar, sin repetir PATCH a ciegas.

Reversión: restaurar sólo los dos destinos a sus fuentes f88 preservadas y configuración/IAM anteriores mediante sus recibos individuales. No revertir Hosting, chat, MEMORY ni borrar pagos, análisis o correcciones. Un rollback parcial puede volver a bloquear propuestas hasta restaurar ambos endpoints. El parser f88 reconoce política 2; registros V3 quedan conservados y una lectura tras rollback puede reextraer el documento, incluido posible OCR. No se degrada el dato V3 para aparentar cacheHit ni se promete el mismo coste de lectura anterior.

Después de publicar: verificar fuente exacta, ACTIVE/revisiones, configuración/Run/IAM y rechazo anónimo. El usuario deberá comprobar el registro pendiente y la conciliación real por los flujos autorizados. Publicado sin ese recorrido significa DEPLOYED_NOT_VERIFIED; las pruebas sintéticas no certifican IQ, banco ni datos productivos.

## Publicación verificada

2026-10-20T18:04:54Z: parse `parsepagoreceiptpdf-00017-wev`, correct `correctpagoreceiptsemanticfield-00006-jol`, ambos ACTIVE. Dos fuentes descargadas iguales al ZIP 6e0 completo; runtime/Run/IAM preservados, generaciones observadas, revisiones listas, dos HTTP 401 UNAUTHENTICATED y cero operaciones activas. Cero documentos de negocio leídos y cero mutaciones por el verificador.

Proof `575e0c6fd18ad2700416b434ead92344ce74fa41f7c5ebf8e9f42002c8d3f6b1`; baseline publicada `8fa3903aba4d64d86e0396d9dc1402048ee181df0759c7b107a60561c6e6ed49`; provenance `7c1c7a257abcd9f205ed5babbf3c72a71c1f99aec89ed7e92a4fb4e90dc1e6b7`; summary `86b93469e8fa1f709f1105e5477daf66f1608c7fe197b70e359b27b97a292356`. Directorio privado: `release/independent-post-publication-6eefc6b8-96d9-4f5f-bb5e-f12371079168/`. Sigue pendiente el recorrido autenticado de registro y conciliación; no se certifican IQ ni banco por estas comprobaciones.

## Seguimiento de identidad

El usuario confirmó la ausencia de las dos causas retiradas; permanece un bloqueo independiente de identidad de cliente/empresa. No se copian datos del comprobante. La fuente integrada tiene selección explícita de candidatos que el ZIP 6e0 no incluía: `receiptIdentificationDomain`, `receiptIdentification` y dos hunks de `receiptPdfCallables`. La selección existente exige candidato corroborado y no resuelve por sí sola ausencia de señales. La siguiente entrega necesita un contrato de identidad seguro y pruebas propias; no forma parte de la publicación aquí certificada. Deberá preservar policy3, correcciones por actor, validaciones monetarias y ausencia de las dos barreras anteriores. No se preparó ni publicó otro artefacto como parte de este seguimiento.
