# Identidad documental: backend de registro

Estado: DEPLOYMENT_PENDING. Paquete final probado y autorizado específicamente por el usuario, con identidad exacta y reversión preparadas; ejecución pendiente de la UI protectora descrita abajo. La corrección de tipado está integrada y su build final pasó. No confundir con el paquete de registro anterior ya publicado.

## Superficie y compatibilidad

Overlay exclusivo de `parsePagoReceiptPdf` y `correctPagoReceiptSemanticField` sobre LIVE6e0. Cambian tres JS: receiptIdentificationDomain, receiptIdentification y dos hunks de receiptPdfCallables para transmitir selectedClientId/selectedCompanyId. No cambia receiptSemantics, policy3, extracción monetaria, flags de evidencia, conciliación, creación de pagos, permisos, IAM, reglas ni exports.

La selección manual se resuelve en el servidor sobre catálogo autorizado del root actual. Una elección no equivale a corroboración bancaria. Las pruebas de fuente y ZIP se detallan abajo con sus límites. No se atribuye la selección a los controles manuales de pago de la UI anterior.

La UI publicada SSR00612/ZIP39e no envía estas selecciones documentales y registra automáticamente cualquier READY. Por eso el nuevo backend depende de publicar y verificar PRIMERO la UI compatible con6e0: conserva el auto previo con RFC/cuenta corroborados y permite revisar/seleccionar los casos nuevos de nombre o elección manual antes del botón explícito. Después se publican ambos endpoints backend. La reversión segura restaura PRIMERO ambos backends a6e0 mientras se conserva ese gate UI; sólo después puede volver Hosting aSSR00612. Nunca dejar eaff ante el auto-registro de la UI anterior. Conservar datos y correcciones; no borrar análisis ni pagos.

## Receta y pruebas

`qa/scripts/build-receipt-identity-overlay.mjs` recibe ocho argumentos: ZIP6e0, fuente baseline, módulo TypeScript, patch completo tres TS, SHA del patch, commit origen de 40 caracteres, nuevo directorio privado y modo BUILD. BASELINE_ONLY verifica emisores sin emitir ZIP de release. BUILD rechaza pins provisionales y patch fuera de los tres módulos. Preserva conjunto/orden de1176 entradas y951 archivos; requiere receiptSemantics intacto. sourceTree es null.

`qa/scripts/receipt-identity-startup.cjs` carga package.main, comprueba354 exports/352 referencias originales y dos rechazos anónimos, con red bloqueada antes de importar. La copia privada de dependencias certificadas y sus pruebas de rutas/cierre son evidencia adicional; no sustituyen el npm ci literal del verificador canónico.

Las comprobaciones backend requeridas están terminadas y la autorización específica está recibida. Falta autorizar/publicar/verificar la protección Hosting antes del backend, y después verificar el recorrido funcional autenticado. La entrega Hosting deberá comprobar compatibilidad con6e0 y esta API. No se usaron datos productivos ni proveedores.

## Identidades locales

Base publicada `6e0dffaa8af33582f09c7caa0f1a071f751cf1529e616f56e1dbd795c49224d0`. Patch completo `aa7603dc839c6b43729d45d386c3fe638448b906c845bf82836fe9f4d4279a0e`. ZIP `eaff0dc7d7ca0f78ccbb0d9ceeb1cee0f8aeaaf5c753ef22eab77ffd4b6fd0f1`, en directorio privado `receipt-identity-candidate-v2`. La primera composición sobre 466a57a y la final sobre 9f153b0 emiten el mismo ZIP: las dos anotaciones de tipos desaparecen al compilar. Las fuentes y sus hashes finales se conservan por separado; no se atribuye el origen anterior a la entrega final.

## Evidencia exacta del candidato

Arranque exacto PASS: 354 exports/endpoints, 352 referencias preservadas, dos registros y dos rechazos sin autenticación; red bloqueada antes de importar. Proof `4dcef8b8b30fef94a6dfff5527580b9d730fcec3e8b9137a736a7d27be8a4806`. Se probó el runtime de la primera composición, cuyo ZIP es byte a byte igual al final; `startup-equivalence.json` vincula identidad final, manifest y prueba sin repetirla.

Package.main real y Firestore demo PASS, launcher exit0 y emulador cerrado: nombres sin RFC/cuenta llegan READY; desconocidos requieren selección autorizada de ambos; opciones ajenas/inactivas son rechazadas; cambio tras auto y corrección conservan IDs seleccionados. Se conservan 33 comprobaciones documentales, ocho casos monetarios, migración P3, correcciones/versiones privadas y flags false. Cero proveedores o escrituras financieras. Proof `ded7ff27b44c8365fa0104095cdfb6b28692662c4335fcb4498d17d78c26e49e`.

Limitación de métrica heredada: metricIdentifiedAutomatically cuenta READY también cuando la elección fue manual; no es una medida fiable de automatismo. La evidencia distingue USER_SELECTED_AUTHORIZED_CATALOG_ENTRY y no afirma corroboración OCR. No se modifica esa métrica en este paquete. La evidencia fuente raíz es separada: NORMAL final PASS, identificación97 y creación33 PASS; el launcher PowerShell1 por stderr deprecación se conserva y no se presenta como exit0, mientras los scripts/emulador informaron0.

## Input, canónico y preflight

Commit de receta/patch/QA `061ea6c72e750a0712fc8009d1c679f14cb1c803`, sourceTree=null; origen de reglas `9f153b0903f06582c5a52ae16d03700520c9be19`. Input privado `receipt-identity-candidate-v2/release/input.json`, SHA `29dc108183025eafd60c09a448572d4134195ab35bd0962e294fd7ff3e387c41`. Base/rollback6e0 y patch completo aa760 anteriores. Baseline publicada `8fa3903aba4d64d86e0396d9dc1402048ee181df0759c7b107a60561c6e6ed49`. Destinos exclusivamente parsePagoReceiptPdf/correctPagoReceiptSemanticField; BUNDLED_V1, grupo receipt-learning-overlay.

Verificador canónico inmutable PASS exit0: npm ci --omit=dev literal en runtime privado nuevo, 354 endpoints y dos denegaciones sin autenticación. Proof `002780c825e3876ccd2170dafb6afa1cd3178d0d602dfae9fd4b39b1b7cb4265`, archivo release/artifact-verification.json. Sin interceptar instalación; la reutilización adicional del startup anterior no sustituye este paso.

Preflight GET 2026-10-20T18:46:11Z PASS, fuente descargada6e0, revisiones previas00017-wev/00006-jol, configuración/Run/IAM iguales a baseline, cero operaciones activas y cero lecturas de negocio/mutaciones. Proof `ac9f758c2e28d5946993f1e866cf468702e7c76aeb18228927ba79a56bc28a7e`, release/fresh-preflight-bb0614f2-7ac5-4d3d-9504-6b15eba797a3.json. El ejecutor debe repetir frescura antes de mutar; este recibo no autoriza publicación ni garantiza ausencia futura de drift.

Reversión backend: restaurar sólo ambos destinos al ZIP6e0 y configuración/IAM previos conservados en baseline/recibos, manteniendo primero la protección UI. Sólo después de restaurar ambos endpoints puede revertirse Hosting aSSR00612. No tocar datos, corregir flags, borrar análisis ni revertir chat/MEMORY. Conservar y reconciliar operaciones inciertas antes de reanudar; nunca repetir PATCH sin conocer su resultado.

Autorización específica posterior del usuario: concedida para input29dc y reversión, sin ampliación a Hosting. Bytes backend intactos. Ejecución pendiente de la autorización, publicación y verificación de la UI protectora compatible; no se vuelve a pedir aprobación para estos mismos bytes de backend.

Límite de creación financiera: este paquete resuelve ausencia de RFC/cuenta y selección de catálogo autorizado. createPago permanece intacto y rechaza un RFC detectado presente que contradice al cliente/empresa mediante PAGO_RECEIPT_RFC_MISMATCH. Una selección puede producir identificación READY sin garantizar que la creación final sea aceptada. No se ofrece bypass de contradicciones, aceptación de mismatch ni éxito financiero por READY. La UI de selección sigue pendiente como paquete Hosting independiente; la autorización de este dossier sólo comprende dos Functions.
