# Dependencias y problemas abiertos

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
