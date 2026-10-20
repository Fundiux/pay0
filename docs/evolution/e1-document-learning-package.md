# Aprendizaje documental de María — integración local

Estado backend: DEPLOYMENT_PENDING, sólo los dos endpoints documentales. UI completa: INTEGRATION_PENDING en composición separada. Sin despliegue ni activación. Montaje integrado por el responsable de Hugo. Frontend raíz posterior al ajuste de tipo: PASS, sesión 68126, 47 rutas; acredita la base actual y no el futuro texto durable. Backend aislado: tsc PASS exit 0.

## Alcance

`src/components/hugo/HugoReceiptLearning.tsx` reutiliza `parsePagoReceiptPdfFile`, `correctPagoReceiptSemanticField` y `ReceiptEvidenceSummary`. Permite seleccionar un comprobante, analizar, revisar evidencia/procedencia, corregir y confirmar el guardado únicamente después de respuesta canónica. Volver a analizar el mismo documento recupera el overlay del mismo usuario; no convierte patrones candidatos en reglas globales.

El flujo usa el parser inline existente: no crea pagos ni solicitudes. La carga documental persistente existente `initPagoDocumentUpload` → upload con metadata → `finalizePagoDocumentUpload` requiere pago previo y no se usa para inventar un pago durante la previsualización. No hay escrituras directas de Storage.

La autorización real permanece en ambos callables (`pagos.create`, rol autorizado y root canónico). El componente limpia documento, edición y avisos al cambiar UID/root/rol/estado y descarta respuestas asíncronas anteriores. El guard de UI no concede permisos. Una lectura legacy sin identidad/versionado queda sólo de consulta.

## Evidencia local

- `node qa/scripts/e1-operations-document-learning-browser.test.cjs`: PASS, ocho grupos de comprobaciones con componente/editor/wrapper reales y transporte Firebase sintético. Cubre lectura/corrección, rechazo sin falso acuse, recuperación de corrección, payload/versionado, cambio UID/root con respuesta anterior de lectura y corrección, respuesta legacy y restricción de rol. Sólo invoca los dos callables documentales; no certifica un navegador autenticado productivo.
- `node qa/scripts/e1-operations-emulator.mjs qa/scripts/e1-operations-document-learning-emulator.cjs`: PASS, 33 comprobaciones, exit 0 y cierre del emulador. PDF textual sintético real, parser real y Firestore local. Verifica persistencia/relectura, separación de actor/root, revocación, sesión requerida, versión obsoleta, otro documento sin autocorrección y cero pagos/solicitudes/paymentApplications. `providerCalls:0` en lecturas; red externa bloqueada. No prueba reglas Firestore: llamadas al backend administrativo con auth sintética.
- Antes del emulador, el test coteja emit de TypeScript y JS compilado de `receiptPdfCallables`, `receiptLearning` y `receiptSemantics`; no sustituye los builds finales de integración.

La memoria documental existente puede devolver orientaciones CANDIDATE o CONFIRMED según evidencia y estado; el componente muestra ambos estados sin prometer confirmación ni aprendizaje global. El overlay exacto está vinculado al usuario y análisis.

## Pendientes acotados

Input exacto validado; verificador canónico y preflight GET terminaron PASS. Falta autorización específica de publicación del backend. Hosting completo se compone por separado. No se ha publicado ni probado con documentos reales. Revisión independiente estática de receta/alcance favorable.

## Correspondencia LIVE y overlay

Captura de metadata y ZIP de generación fija exclusivamente para ambos endpoints el 2026-10-20T05:23:59Z, sin invocación autenticada ni documentos de negocio. parsePagoReceiptPdf revision 00015-faf y correctPagoReceiptSemanticField revision 00004-fam comparten ZIP SHA256 `6615bb840530acf6dc31f2f86e988210f5505d2d17a0b4c05850c0c0eb2eb713`. LIVE sólo corrige cuatro identificadores y no retorna versión/overlay recuperable por usuario. UI sola no completa el ciclo.

La receta `qa/scripts/build-document-learning-overlay.mjs` exige ese ZIP exacto, módulo TypeScript y directorio privado nuevo. Reconstruye emisores históricos y exige equivalencia con LIVE antes del patch completo `qa/patches/document-learning-overlay.patch`, SHA256 `26aa99e2e947c6576766d7130f9fa26e048233f3cb9fbecc37752c99b4bd1559`. El patch incluye los tres módulos TS y la nueva entrada TS acotada.

Emisores base: receiptPdfCallables `8af329e8cd6cded58d817fc8813fba7f84138ac2`, receiptLearning `a43658bab18004eff45cf944d35a93ca59a90f81`, receiptIdentification `d630dc541498c360626908a213060c8ae0d936e5`. Corrección/overlay provienen de `4c3dcb90857ee3e7f22edd38f9d43bfe7b7abdc1`; la adaptación conserva identificación LIVE salvo revalidación transaccional de correctionVersion. No porta selección/candidatos ni cambia creación de pagos.

ZIP candidato activo SHA256 `f88b88d75f8b99737d7b0b72364eb2a7fc4cbb9784175d4750cbf71f3876513f`: 1176 entradas; cuatro JS cambiados (los tres módulos y lib/index.js), una entrada añadida y 949 archivos originales idénticos, sin borrados. El bundle index original se conserva byteidéntico como lib/receipt-learning-baseline-index.js, SHA256 `1450ba9d3a3e9859f0b159ffc2405ac321914c47e135bec43c095c7f749ca821`, en el mismo directorio. La nueva entrada copia todos sus descriptores/getters y sustituye sólo los dos handlers; conserva 352 referencias/descriptores de exports ajenos. Manifiestos, lock, autorización, semántica, cuota, `.debug/compiled` y código financiero conservan bytes LIVE. No hay TS dentro del ZIP original; emisores externos verificados desde Git. sourceTree null: ZIP base y patch completo.

El candidato anterior 3fdcc10… queda SUPERSEDED_MODULE_ONLY: comprobó los módulos pero el index productivo es un bundle y no consumía esos reemplazos. Nunca fue publicado ni preparado para aprobación. Las pruebas actuales cargan package.main y exigen por identidad que sus dos exports correspondan a los handlers parcheados; no reutilizan la evidencia de módulos como si acreditara la entrada activa.

Instalación única con npm ci --ignore-scripts y manifiesto/lock LIVE; QA reutiliza esa instalación compatible explícitamente. El tsc privado completo, incluida la nueva entrada, terminó exit 0. No escribió functions/lib compartido. El test exacto desde package.main coteja todos los bytes del ZIP antes/después y pasó las 33 comprobaciones, exit 0 y cierre. Startup conserva 354 exports, registro de los dos endpoints y 352 referencias/descriptores originales; ambos endpoints rechazan llamadas anónimas con red bloqueada. Warning Firebase setGlobalOptions al cargar base/candidato juntos preservado; registro explícito STARTUP_EXIT=0, sin convertir stderr ciegamente en PASS.

La fixture legacy adicional de las 33 comprobaciones usa los cuatro identificadores sin expectedCorrectionVersion: ocho reintentos idénticos crean una corrección/versión; siguientes avanzan a versión 4; retry previo conserva ID/versión; stale explícito y root ajeno se rechazan. Es un análisis sintético sembrado, distinto del PDF real principal.

La frontera de servicio cambia sólo ParsedPagoReceipt.learningContext.patternKey a opcional: los items canónicos no lo retornan y UI no lo usa. La UI publicada también requiere los deltas existentes de editor ReceiptEvidenceSummary.tsx y contrato/wrapper pagoReceipt.ts de 4c3dcb9; su composición preserva la base vigente y no se resuelve sólo con esa línea de tipo.

Receta: `node qa/scripts/build-document-learning-overlay.mjs <ZIP-LIVE-6615> <modulo-typescript> <directorio-privado-nuevo>`.

QA exacta admite PAY0_DOCUMENT_FUNCTIONS_ROOT, PAY0_DOCUMENT_SOURCE_ROOT, PAY0_DOCUMENT_ARCHIVE, PAY0_DOCUMENT_ARCHIVE_SHA y PAY0_DOCUMENT_PROOF_FILE, dentro del workspace. Browser admite PAY0_DOCUMENT_UI_ROOT/PAY0_DOCUMENT_UI_OUTPUT. Startup admite runtime base, runtime candidato y proof. Transporte browser sintético no equivale a persistencia real emulada.

## Publicación y reversión propuestas

Superficie futura: UPDATE de parsePagoReceiptPdf y correctPagoReceiptSemanticField con el mismo ZIP; Hosting revisado por separado. Sin nuevos exports, reglas, índices ni dependencias npm. Cada Function exige baseline/config/IAM propios y preflight fresco. No se ha ejecutado mutación.

Orden: ambos backend primero, preservando compatibilidad legacy; después UI completa. Omitir expectedCorrectionVersion toma versión vigente al comenzar y revalida en transacción: puede devolver conflicto controlado; no reinicia contador. Si UI llega antes, su guard legacy mantiene sólo lectura hasta recibir contrato versionado.

Rollback: restaurar ambos endpoints al ZIP original exacto 6615… con configuración/IAM originales verificados; después UI previa si corresponde. Si sólo uno se actualiza, reconciliar la operación y restaurar/completar sólo con autorización, sin presentar ciclo completo. No borrar análisis, correcciones, memorias ni evidencias. El código antiguo deja overlays persistidos sin consumo, sin alterar pagos. Preservar fuentes previas sin ocupar rutas reservadas del ejecutor.

## Identidad lista para autorización del backend

Fuente/patchCommit `1cad29004aa7b34c788edcf06c2f14e26e703f01`, sourceTree null, base ZIP 6615…, patch completo 26aa…, ZIP activo f88b…. Grupo `receipt-learning-overlay`, buildMode BUNDLED_V1: bundle original preservado más entrada normal mínima, no reconstrucción completa del bundle.

Input privado `document-learning-entry-certified/release/input.json`, SHA256 `c6fce02da91280818acb2993cb9512266bfd301f11cfbc722509b9d4ece5c69d`; baseline propia SHA256 `d9d23f85f14780633bb74e7038db44a5dbfe6c9a138b4d7a7d62fb9fe6106c0f`, capturada 2026-10-20T05:49:25Z. Sólo parsePagoReceiptPdf y correctPagoReceiptSemanticField.

Verificador canónico `verify-scoped-functions-artifact.cjs`: PASS exit 0, instalación nueva con dependencias de producción, 354 endpoints cargados y dos denegaciones anónimas, proof SHA256 `817a4fefb3db0425557580baef74e461be2051d7af0d773bc52c3a2f4c304335` a las 05:55:16Z. Complementa la prueba de negocio de 33 checks desde package.main y el startup de preservación de referencias/descriptores.

Preflight exclusivamente GET: PASS a las 05:54:30Z, recursos/configuración/Run/IAM idénticos a baseline y cero operaciones activas; receipt SHA256 `fe0f98a25de6bf716dd0ac1662d5cbf22f67d6430a25cb5cdd57414229b91b2c`. Es evidencia de ese instante; el ejecutor debe revalidar antes de mutar. No autoriza deployment ni hace durable la futura corrección de texto/voz.
