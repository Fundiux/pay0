# Identidad documental: backend de registro

Estado: LOCAL_VALIDATED_CANONICAL_PENDING. Nuevo candidato con guardia servidor; sin input final ni autorización nueva. No desplegado. Input29dc/ZIPeaff anterior, aunque autorizado, quedó SUPERSEDED_NOT_DEPLOYED y no se ejecutará. Sus recibos se conservan aparte.

## Comportamiento y alcance

Sólo parsePagoReceiptPdf y correctPagoReceiptSemanticField, grupo receipt-learning-overlay, BUNDLED_V1, 354 exports. Tres JS: receiptIdentificationDomain, receiptIdentification y dos hunks PDF que transmiten selectedClientId/selectedCompanyId. Semantics, policy3, importes, flags, createPago, conciliación, reglas, permisos e IAM permanecen intactos.

Un nombre único sin señales fuertes queda como sugerencia: REQUIRES_REVIEW, CLIENT/COMPANY_SELECTION_REQUIRED y createPayload=null. Sólo IDs explícitos del catálogo activo autorizado producen READY manual; evidence distingue USER_SELECTED_AUTHORIZED_CATALOG_ENTRY, sin fingir corroboración OCR. Esto protege pestañas antiguas que auto-registraban cualquier READY. El matching fuerte anterior conserva auto con RFC/cuenta corroborados. Catálogo limitado a500; la advertencia por exceso conserva revisión.

READY no garantiza creación financiera: createPago sigue rechazando RFC presente contradictorio con PAGO_RECEIPT_RFC_MISMATCH. Este paquete resuelve RFC/cuenta ausentes; no ofrece bypass de conflictos. metricIdentifiedAutomatically sigue contando READY, incluso manual; evidence diferencia la elección. No se modifica esa métrica.

## Identidad y receta

Fuente final bb8d94b06d6f9ed25299fffeb4169ea256136c91. Base publicada/rollback6e0dffaa8af33582f09c7caa0f1a071f751cf1529e616f56e1dbd795c49224d0. Patch completo72080009dbd0d7c446532a8096c8033ea1898fd60d1cf71d0503e47477e68937. ZIP78f7403fa7011069eafc1a99bd01c4388bc40e075d450d224e4c8a7dff79056b en .firebase/modular-release/receipt-identity-candidate-v3. Preserva951 archivos,1176 entradas/conjunto/orden, sin entradas nuevas; tres JS cambiados. index shim y bundle original intactos. sourceTree=null.

Receta qa/scripts/build-receipt-identity-overlay.mjs: ocho argumentos ZIPbase, fuente baseline, TypeScript, patch, SHApatch, commit origen40, salida privada nueva y BUILD. Verifica tres emisores baseline antes del patch y exige patch de esos tres TS; BASELINE_ONLY no emite release. Nunca copia lib raíz completa. La fuente baseline está ligada a los emisores del ZIP6e0 y al pipeline anterior certificado.

## Evidencia y pendientes

Fuente raíz: NORMAL final,15 casos nuevos y78 con regresiones PASS; verify-authorization-policy PASS. Emulador fuente separado:98 identificación y33 creación canónica PASS, script0/cero acciones externas. No se atribuyen al ZIP.

Startup y QA exactos v3 PASS; sin claims heredados de eaff. qa/scripts/receipt-identity-startup.cjs carga package.main con red bloqueada,354 exports/352 referencias y2 denegaciones. Admite reutilización explícita de dependencias privadas sólo con ZIP anterior/proofSHA, todos sus bytes, package/lock, rutas físicas y cierre offline verificados. Esa prueba adicional no sustituye npm ci literal del verificador canúnico.

qa/scripts/receipt-identity-artifact.cjs exige ZIP/runtime iguales antes/después y Firestore demo. Casos previstos: name-only noREADY/nullpayload con sugerencias, IDs autorizados READY, desconocidos/ajenos/inactivos, cambio tras auto y corrección con IDs;33 regresiones documentales,8 monetarios, P3 y correcciones privadas/flagsfalse. Sin proveedores, datos reales ni escrituras financieras.

Pendientes: resultados exactos v3, reproducción/procedencia Git final, verificador canúnico literal, input y GET preflight nuevos; aprobación específica de nuevos bytes. La autorización histórica29 no se transfiere.

## UI y reversión

Plataforma prepara gate UI compatible con6e0 usando evidence.client/company y los IDs del createPayload del servidor; verifiedMatches/candidates son opcionales y no existen en6e0. La UI publicada SSR00612 no tiene selección documental. La entrega UI es independiente y requiere su autorización exacta. Orden flexible seguro: backend con guardia servidor puede publicarse antes de UI, con autorización propia; las pestañas antiguas no crean casos name-only y requieren la nueva UI para confirmar. UI compatible puede publicarse por separado. La guardia servidor además impide auto-registro de name-only en pestañas antiguas.

Rollback de familia: ambos backends a6e0 primero manteniendo UI gate; sólo después Hosting aSSR00612. Si sólo backend se publicó, no se revierte Hosting innecesariamente. Usar recibos scoped y configuración/IAM previos; conservar datos, análisis y correcciones. Ningún borrado ni cambio de flags ni rollback de chat/MEMORY. Reconciliar operaciones inciertas antes de reintentar PATCH.

Resultados exactos v3: startup PASS exit0, proof `e1760227832b37a174631d56c663f2368e76ed3842a5ba136af9bdb9e27d06a9`; package.main/Firestore real PASS exit0, proof `bd3e18187a346159d1944c836ab1df6b67f6761945288341a58402005b23fd39`. Oldtab protegido por nullpayload/SELECTION_REQUIRED; sugerencias de nombre y luego IDs explícitos READY. Se verificaron33 regresiones documentales,8 casos monetarios, cambio tras auto, IDs en correct, opciones ajenas/inactivas y P3/correcciones privadas/flagsfalse. Cero proveedores y escrituras financieras; emulador cerrado. Preservación independiente raíz PASS en root-independent-preservation.json.
