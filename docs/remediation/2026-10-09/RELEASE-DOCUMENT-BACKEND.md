# Backend documental y recuperación publicados

Candidato integración d4298e09fe66, publicado también a origin/integration/pay0-remediation-20261009. Despliegue acotado de dos endpoints nuevos, sin Hosting, reglas ni writers. Preflight confirmó404 para ambos.

| Endpoint | Revisión | Estado | Actualización UTC | Source generation |
|---|---|---|---|---|
| streamPrivateDocument | streamprivatedocument-00001-cig | ACTIVE/Ready, tráfico100% | 2026-10-09T20:17:52.478459991Z |1791576988505421|
| getMyRestrictionStatus | getmyrestrictionstatus-00001-hay | ACTIVE/Ready, tráfico100% |2026-10-09T20:18:07.522711461Z|1791576988537229|

No bindings de secretos. POST vacío no autenticado devuelve401/unauthenticated para puente y401/UNAUTHENTICATED para callable. No se descargaron documentos de producción durante postflight. Ningún writer de restricciones exportado.

Validación: Functions build y frontend47páginas PASS; discovery346 estricto4.229s antes del lote y2.317s en predeploy; reglas96, descargas42/14tipos/3roles y8denegaciones en demo; contratos chunk/revocación/generation/accountchange y recuperaciónUI PASS. El primer gate documental falló por iniciar con IDpay-0-system; el guard previo a escrituras lo detuvo. package.json ahora fija demo-pay0-document-access, suite completa y predeploy posteriores PASS. No se relajó guard ni expectativa de autorización.

Recuperación: consumidores productivos existentes todavía usan transporte anterior. El endpoint legacy sigue disponible. Si el nuevo backend presenta un fallo antes de Hosting, detener rollout del frontend y corregir hacia adelante; no cambiar datos financieros ni borrar evidencia. Después de Hosting, preservar backend compatible hasta revertir consumidores. Las reglas directas y tokens históricos no se retiraron en este lote.

Inventario inicial privado: bootstrap proyectó rootId de100uploads (sin faltantes), un root en la muestra. Lote de100metadatos:94estatus elegibles,93padres canónicos válidos y6inactivos/no finalizados;1entityId-only sin padre canónico. Metadata Storage93objetos confirma tamaño<=32MiB en bucketcanónico; ninguna descarga de contenido. No es inventario total ni cierre de compatibilidad. Comparación del resolver anterior muestra rechazo previo del caso sin padre; falta terminar cobertura histórica y familias entidad/assets antes de Hosting.
