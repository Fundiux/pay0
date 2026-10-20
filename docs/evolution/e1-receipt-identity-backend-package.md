# Identidad documental: backend de registro

Estado: LOCAL_VALIDATED_CANONICAL_PENDING. Artefacto provisional; sin input listo, autorización ni publicación. La fuente final incluye una corrección de tipado pendiente de identificación definitiva. No confundir con el paquete de registro anterior ya publicado.

## Superficie y compatibilidad

Overlay exclusivo de `parsePagoReceiptPdf` y `correctPagoReceiptSemanticField` sobre LIVE6e0. Cambian tres JS: receiptIdentificationDomain, receiptIdentification y dos hunks de receiptPdfCallables para transmitir selectedClientId/selectedCompanyId. No cambia receiptSemantics, policy3, extracción monetaria, flags de evidencia, conciliación, creación de pagos, permisos, IAM, reglas ni exports.

La selección manual se resuelve en el servidor sobre catálogo autorizado del root actual. Una elección no equivale a corroboración bancaria. Los detalles definitivos y los límites deben certificarse con las pruebas de la fuente final y del ZIP. No se admite atribuir la selección a los controles manuales de pago de la UI anterior.

La UI publicada SSR00612/ZIP39e no envía estas selecciones documentales. El backend puede prepararse por separado; la nueva selección requiere el paquete Hosting independiente de Plataforma. Orden de publicación: ambos endpoints backend completos antes de Hosting. Orden de reversión de la familia: UI primero a SSR00612 y después backend a6e0; evita dejar una interfaz que envía selecciones contra un servidor que las ignora. Conservar datos y correcciones; no borrar análisis ni pagos.

## Receta y pruebas pendientes

`qa/scripts/build-receipt-identity-overlay.mjs` recibe ocho argumentos: ZIP6e0, fuente baseline, módulo TypeScript, patch completo tres TS, SHA del patch, commit origen de 40 caracteres, nuevo directorio privado y modo BUILD. BASELINE_ONLY verifica emisores sin emitir ZIP de release. BUILD rechaza pins provisionales y patch fuera de los tres módulos. Preserva conjunto/orden de1176 entradas y951 archivos; requiere receiptSemantics intacto. sourceTree es null.

`qa/scripts/receipt-identity-startup.cjs` carga package.main, comprueba354 exports/352 referencias originales y dos rechazos anónimos, con red bloqueada antes de importar. La copia privada de dependencias certificadas y sus pruebas de rutas/cierre son evidencia adicional; no sustituyen el npm ci literal del verificador canónico.

Pendientes antes de DEPLOYMENT_PENDING: fuente final/build NORMAL, patch final y reproducción; pruebas exactas de selección/autorización y regresiones de P3/importes, startup, verificador canónico literal, input con procedencia final y preflight GET fresco. Sin datos productivos ni proveedores.

## Identidades locales

Base publicada `6e0dffaa8af33582f09c7caa0f1a071f751cf1529e616f56e1dbd795c49224d0`. Patch completo `aa7603dc839c6b43729d45d386c3fe638448b906c845bf82836fe9f4d4279a0e`. ZIP `eaff0dc7d7ca0f78ccbb0d9ceeb1cee0f8aeaaf5c753ef22eab77ffd4b6fd0f1`, en directorio privado `receipt-identity-candidate-v2`. La primera composición sobre 466a57a y la final sobre 9f153b0 emiten el mismo ZIP: las dos anotaciones de tipos desaparecen al compilar. Las fuentes y sus hashes finales se conservan por separado; no se atribuye el origen anterior a la entrega final.

## Evidencia exacta del candidato

Arranque exacto PASS: 354 exports/endpoints, 352 referencias preservadas, dos registros y dos rechazos sin autenticación; red bloqueada antes de importar. Proof `4dcef8b8b30fef94a6dfff5527580b9d730fcec3e8b9137a736a7d27be8a4806`. Se probó el runtime de la primera composición, cuyo ZIP es byte a byte igual al final; `startup-equivalence.json` vincula identidad final, manifest y prueba sin repetirla.

Package.main real y Firestore demo PASS, launcher exit0 y emulador cerrado: nombres sin RFC/cuenta llegan READY; desconocidos requieren selección autorizada de ambos; opciones ajenas/inactivas son rechazadas; cambio tras auto y corrección conservan IDs seleccionados. Se conservan 33 comprobaciones documentales, ocho casos monetarios, migración P3, correcciones/versiones privadas y flags false. Cero proveedores o escrituras financieras. Proof `ded7ff27b44c8365fa0104095cdfb6b28692662c4335fcb4498d17d78c26e49e`.

Limitación de métrica heredada: metricIdentifiedAutomatically cuenta READY también cuando la elección fue manual; no es una medida fiable de automatismo. La evidencia distingue USER_SELECTED_AUTHORIZED_CATALOG_ENTRY y no afirma corroboración OCR. No se modifica esa métrica en este paquete. La evidencia fuente raíz es separada: NORMAL final PASS, identificación97 y creación33 PASS; el launcher PowerShell1 por stderr deprecación se conserva y no se presenta como exit0, mientras los scripts/emulador informaron0.
