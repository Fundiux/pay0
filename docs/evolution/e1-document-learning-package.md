# Aprendizaje documental de María — integración local

Estado: LOCAL_VALIDATED_INTEGRATION_PENDING. Sin despliegue, activación de reglas ni llamadas a proveedores. El montaje en Hugo y los builds compartidos finales se coordinan con la integración de texto/voz.

## Alcance

`src/components/hugo/HugoReceiptLearning.tsx` reutiliza `parsePagoReceiptPdfFile`, `correctPagoReceiptSemanticField` y `ReceiptEvidenceSummary`. Permite seleccionar un comprobante, analizar, revisar evidencia/procedencia, corregir y confirmar el guardado únicamente después de respuesta canónica. Volver a analizar el mismo documento recupera el overlay del mismo usuario; no convierte patrones candidatos en reglas globales.

El flujo usa el parser inline existente: no crea pagos ni solicitudes. La carga documental persistente existente `initPagoDocumentUpload` → upload con metadata → `finalizePagoDocumentUpload` requiere pago previo y no se usa para inventar un pago durante la previsualización. No hay escrituras directas de Storage.

La autorización real permanece en ambos callables (`pagos.create`, rol autorizado y root canónico). El componente limpia documento, edición y avisos al cambiar UID/root/rol/estado y descarta respuestas asíncronas anteriores. El guard de UI no concede permisos. Una lectura legacy sin identidad/versionado queda sólo de consulta.

## Evidencia local

- `node qa/scripts/e1-operations-document-learning-browser.test.cjs`: PASS, ocho grupos de comprobaciones con componente/editor/wrapper reales y transporte Firebase sintético. Cubre lectura/corrección, rechazo sin falso acuse, recuperación de corrección, payload/versionado, cambio UID/root con respuesta anterior de lectura y correcci?n, respuesta legacy y restricción de rol. Sólo invoca los dos callables documentales; no certifica un navegador autenticado productivo.
- `node qa/scripts/e1-operations-emulator.mjs qa/scripts/e1-operations-document-learning-emulator.cjs`: PASS, 33 comprobaciones, exit 0 y cierre del emulador. PDF textual sintético real, parser real y Firestore local. Verifica persistencia/relectura, separación de actor/root, revocación, sesión requerida, versión obsoleta, otro documento sin autocorrección y cero pagos/solicitudes/paymentApplications. `providerCalls:0` en lecturas; red externa bloqueada. No prueba reglas Firestore: llamadas al backend administrativo con auth sintética.
- Antes del emulador, el test coteja emit de TypeScript y JS compilado de `receiptPdfCallables`, `receiptLearning` y `receiptSemantics`; no sustituye los builds finales de integración.

La memoria documental existente puede devolver orientaciones CANDIDATE o CONFIRMED según evidencia y estado; el componente muestra ambos estados sin prometer confirmación ni aprendizaje global. El overlay exacto está vinculado al usuario y análisis.

## Pendientes acotados

Montaje y builds frontend/Functions compartidos finales; verificación de correspondencia LIVE de ambos callables mediante metadata/ZIP de generación fija. No se ha publicado ni probado con documentos reales. Si el backend productivo difiere del contrato local, la entrega debe declarar la dependencia concreta antes de presentar la UI como paquete independiente.
