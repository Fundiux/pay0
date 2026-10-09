# Registro de ejecución — 2026-10-09

- Leídos encargo completo, AGENTS y todas las fuentes obligatorias mediante revisión distribuida. Base preservada 1f694607, sin cambios rastreados pendientes al iniciar.
- Baseline remoto de solo lectura: proyecto pay-0-system concordante. Revisiones, reglas, colas y schedulers en BASELINE.md. Hosting cambió por publicación externa durante inspección.
- S02: reporte OBSERVE_ONLY, hash de ruta, deduplicación actor/minuto y sin contención ni mensajes. Cuatro pruebas PASS; 31a9f05.
- Gate materialidad: contrato ejecutable sin Markdown archivado; documentos, parcialidades y scope PASS; 6507598.
- S10: vigencia, scope y revocación coherentes en backend/reglas; UI conserva temporalidad. Recuperadas guardas productivas omitidas. 243 comprobaciones emuladas PASS; 6859938. Revocación transitiva sigue abierta.
- OCR: recuperada semántica/cache/aprendizaje del artefacto desplegado; cuotas actor/root y máximo cinco páginas. Memoria identificada por root, legacy solo lectura y sin promoción. Once pruebas PASS; a43658b.
- Telegram: generation del objeto, acceso actual, lease y tres intentos. Seis pruebas PASS; 6a894d0. Productor webhook y consumidor requieren el mismo lote.
- Dependencias: locks sincronizados, audit completo/producción cero y smokes UUID/gRPC/ExcelJS/Sharp PASS; d66555b.
- Frontend build PASS con 46 páginas; Functions build PASS. No acreditan automáticamente cambios posteriores ni merge.
- Inventario AST: 406 identidades históricas relacionadas; horarios/retry exactos y reglas por ruta/método. Tres pruebas PASS; no certifica autorización dinámica.
- IQ-504: proveedor falso reprodujo dos POST después de efecto con respuesta504. Corrección exige conciliación antes de replay: 17 escenarios PASS; 36270fb. Sin efectos externos.
- S06: generación/hash servidor y finalización transaccional; ocho pruebas PASS también en integración. Tipos opacos conservados como UNRECOGNIZED_TYPE. Sin antimalware.
- Sentinel: núcleo OBSERVE_ONLY con persistencia limitada y diez pruebas PASS. Sin export/deploy ni autoridad financiera.
- S01: guardia trustedRestrictionV1, seis pruebas PASS; writer/recovery en curso. Bloqueo heredado ignorado; cobertura HTTP/workers/rules pendiente.
- Merge aislado de main 094472f en integración. Resueltos conflictos conservando avances de ambas líneas y guards de release; corregidas duplicación getJsZip y dependencia corporativa perdida. Prueba corporate19 aserciones y reactividad8 PASS.
- Instalación limpia npm ci --ignore-scripts del candidato integrado PASS: Functions439 y frontend457 paquetes. Deprecated no equivale a nueva vulnerabilidad; audit fijado por lock.
- GitHub main 7dfcd8a, protected=false y ninguna regla de rama devuelta por API autenticada. Se mantiene publicación normal, sin force-push.

- Hito remoto: integración 6b8d2f7e35cb publicada en su rama; S02 revision00012-zal ACTIVE y rechazo no autenticado401 verificados. Artefacto fuente coincide; binding heredado requiere redeploy secrets vacío. Detalles exactos HANDOFF.md.
- Hito Sentinel: proyecto aislado/API/repositorio creados; recuperación DNS sin recreación. Servicio/ingesta todavía no activos. Reglas candidatas no publicadas: dos límites de evaluación y brechas Storage pendientes.
