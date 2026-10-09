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

## Hitos posteriores a las 20:00 UTC

Estas entradas actualizan el estado efectivo sin borrar los antecedentes anteriores. Evidencia remota comunicada por integracion; esta actualizacion documental no repite operaciones cloud.

- Fuente `d4298e09fe66`: publicados `streamPrivateDocument` revision `streamprivatedocument-00001-cig` a las 20:17:52.478459991Z y `getMyRestrictionStatus` revision `getmyrestrictionstatus-00001-hay` a las 20:18:07.522711461Z. ACTIVE/Ready, trafico 100% y HTTP401 sin autenticar PASS; no Hosting, reglas ni writer de restricciones en ese despliegue. Ver RELEASE-DOCUMENT-BACKEND.md.
- Inventario root seleccionado completado secuencialmente: uploads 1,446; elegibles 1,361; 1,357 padre canonico/Storage real <=32 MiB; 85 inactivos; cuatro entityId-only sin padre canonico; siete tamanos registrados desconocidos como dimension independiente. Entidades 23 (13 activas validas/10 inactivas), assets cero. Diagnostico posterior releyo 1,446, sourceCountMatched=true, cuatro candidatos y ocho lecturas de detalle: los cuatro SOLICITUD, padre MISSING, prefijo MATCH, AMBIGUOUS_OR_UNAVAILABLE, provenance UNVERIFIED. Sin reparacion ni creacion de padres; investigar historia/borrado/recuperacion. No afirmar todos los roots ni snapshot atomico.
- Sentinel: primera ventana HTTP204 INVALID_ENVELOPE y seis pares404 permanecen como fallo historico. Tras correccion de aliases, observer `00005-dgr` recibio dos HTTP200; RECORDED=1/DUPLICATE=1. Verificador exacto receipt200/incidente200, OBSERVE_ONLY_SINGLE_EVENT_VERIFIED, eventCount=1, authority=NONE y TTL valido. E2E sintetico y replay PASS. Cierre confirmado: canary `00006-6wv` Ready/DISABLED y sink apagado. Sin autoridad financiera, sin activacion de restricciones y sin certificacion de productores reales. Fuente de detalle: SENTINEL-ROLLOUT.md.
- Preflight Hosting offline: ZIP SSR vigente comparado con integracion `7b56c4c`, rutas app 56->57 sin perdidas y unica adicion `/descarga/documento`, estaticas 44->45, dinamicas 12->12; configuracion de rutas equivalente. Next.js 15.5.25->15.5.27 y Node22; no metadata suficiente para identificar SHA fuente productivo. No se extrajo configuracion privada ni se escribio en cloud. No equivale a prueba funcional completa del candidato posterior.
- Preflight Telegram comunicado por integracion: ocho modulos comparados, iguales excepto `actionTokens`; mecanismo de entorno puente y orden de drenaje documentados. No mensajes reales, deploy Telegram ni Hosting efectuados en este lote.
- Integracion remota confirmada `3fa5957`; frontend posterior `d08acda`, build en progreso al registrar. Estado temporal `pendingFrontendHashFix/browser`: verificaciones finales de hash/build y navegador pendientes, no promover a PASS por resultados anteriores. Objetivo integral permanece abierto; conservar los gates y limites especificos de cada lote.
