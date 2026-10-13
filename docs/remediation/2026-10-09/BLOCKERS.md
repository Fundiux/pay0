# Dependencias y problemas abiertos

Actualizacion2026-10-13: Hosting ya tiene release4cfd958c9a8694ae/SSR00590-gik Ready100 y pruebas parciales fuente5/assets15/browser publico PASS. Siguen distintos dos problemas: launcher61879 fallo tras RELEASE_ACCEPTED (causa final no reproducida) e inventario completo rechaza caches Webpack grandes (causa demostrada). No redesplegar para verificar; conservar ZIP/recibos y preparar exclusion especifica para el proximo artefacto. La validacion parcial no cierra equivalencia completa ni flujos autenticados. Ver HOSTING-61879-RECONCILIATION.md.

SDK DELIVERY8casos PASS, pero dispatch/transport/continuation/supervision/HTTP y configuracion de vida DELIVERY no estan conectados. No activar admision hasta cerrar continuidad y agregacion/auditoria sin doble envio legacy. A1 esta reparado e integrado; A7B necesita contrato actual para snapshots/lifecycle/evidencia de release, no restaurar archivos ausentes arbitrariamente. Estos frentes tienen trabajo local ejecutable y no son bloqueo global.

Historico conservado debajo; las afirmaciones de estado anteriores corresponden a sus cortes.

Actualizacion2026-10-11: el prerrequisito de lectura historica para la cohorte
del notificador paso en Firestore cloud aislado a48min, misma ancla y limpieza
verificada (NOTIFICATION-CLOUD-READTIME-EVIDENCE.md). Sigue pendiente conectar
admision, dispatcher y entrega con autoridad actual/fences; el adaptador y la
admision permanecen inertes. Esto no cierra DOC-DISPERSION-REPLAY.

Notas de dispersion integradas/pushed9a729e3: bundle347 y matriz40/16recursos
PASS39008. Callable creado revision00001-mug/generation1791691748273508;
401 sin autenticar PASS74b0e6. Hosting pendiente por ZIP:1251 hashes esperados
coinciden,327 extras detectados (315maps normales y12auxiliares). El packer
anterior validaba subconjunto; correccion exacta/ignore/stream en worktree
aislado, sin borrar archivos locales. Siguiente: integrar gate revisado,
update-only con mismo runtime y verificar ZIP independiente antes de Hosting.
Experimento Rules e3ea3dd fallido permanece excluido; S10 no queda cerrado.

Candidato separado solicitud-notes7a913c3: normal348/16recursos PASS, HTTP
bundle PASS7 y132208KiB, pero matriz bundle39/40: stress instrumentado batch8
large alcanzo267832KiB sobre256MiB. Probe31827 reprodujo fallo en ambos:
old267544KiB/current266928KiB; no demuestra regresion por extraccion. Se
implementa contador exacto de bytes JSON del DTO cerrado para evitar strings
temporales expandidos; oracle y matriz completa pendientes. No ampliar memoria
ni quitar caso. Todos los casos batch4 pasaron, lo cual
no convierte la matriz completa en PASS ni autoriza integrar este candidato.

| Punto | Evidencia / causa | Trabajo que continúa | Condición de publicación/cierre |
|---|---|---|---|
| Integración Git | 108/13 commits divergentes; merge aislado conserva ambas historias. Se detectaron y corrigieron duplicados TypeScript y un helper de reglas. | Builds y pruebas del candidato integrado. | Release guards, emuladores y frontend build del commit exacto. |
| Drift productivo | Hosting cambió por acción externa durante baseline. OCR, reglas y CSF publicados tenían capacidades ausentes de HEAD inicial; ya recuperadas en candidato. | Lotes independientes con fuente exacta y rollback preservado. | Nuevo preflight por componente antes del deploy. |
| S01 frontera completa | Guardia actual no cubre todavía todos los HTTP/workers ni Storage directo; límite Storage de dos consultas. | Writer/recovery preparados sin export y revalidación de trabajos en curso. | No activar restricciones hasta cobertura y recuperación verificadas. |
| S10 derivadas | Límites otorgante implementados; revocación transitiva y TOCTOU de setter pendientes. | Diseño de autorización documental canónica. | Demostrar revocación descendiente sin depender de limpieza. |
| S06 parsers | Hash servidor no demuestra ausencia de malware. Tipos opacos explícitamente no analizados. | Finalización transaccional probada; plan en FILES.md. | Aislamiento de parsers, límites de expansión y promoción según riesgo. |
| Sentinel | Compute/Appspot/cloudservices con Editor de proyecto; detector no debe usar identidad compartida. | Servicio aislado, IAM y preflight en implementación. | Identidad sin acceso financiero, persistencia aislada y pruebas negativas. |
| Calibración | No existe ventana de observación nueva ni evidencia de falsos positivos. | OBSERVE_ONLY permitido al pasar controles técnicos. | Automatismos de contención siguen desactivados hasta evidencia real. |
| Respaldo | Firestore PITR y delete protection deshabilitados; restauración no demostrada. | Cambios de código/reglas no destructivos. | Sin migración destructiva hasta respaldo y recuperación probados. |

Ninguno de estos puntos detiene los frentes independientes. No se han ejecutado efectos financieros reales ni mensajes de prueba a destinatarios.

## 2026-10-13: arranque CLI e integracion IQ

Capturas NORMAL35761 (8501 ms) y85598 (62464 ms) fallan STARTUP_LIMIT de7000, sin baseline. Diagnostico instrumentado3371 ms no sustituye gate. Timestamps del segundo manifiesto apuntan a un tramo posterior de59,5 s; no distinguen parsing, scheduling u otra causa. Comparacion funcional offline e8b35f5 PASS347->348 exacto (b2b06c), schema distinto con normalStartupPassed:false. No repetir capturas a ciegas ni relajar limites. Siguiente: candidato empaquetado sin instalar y diagnostico separado si hace falta; publicacion dependiente sigue pendiente.

IQ retorno canonico corregido d5bafca, integrado c21a2b7, unit30 y SDK4 casos PASS; no despliegue. Binding DELIVERY99 pruebas/build PASS, SDK adaptado pendiente y productor inactivo. A7B conserva entradas historicas ausentes; no fabricar cierre ni equivalencia de snapshots.
