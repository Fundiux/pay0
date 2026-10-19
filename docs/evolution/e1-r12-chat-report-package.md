# R1.2 — Continuidad de reportes y descarga real

Estado: paquete preparado; no publicado. El commit de identidad del parche y la autorización de nuevos bytes están pendientes. La interfaz se prepara por separado desde su base publicada.

## Corrección

La secuencia «genera reporte utilidades cliente pc directo», «hola dame un reporte de utilidades del cliente pc directo del mes de septiembre», «septiembre», «2026-09-01 al 2026-09-30» conserva cliente y filtros mientras pide fechas explícitas. No consulta al modelo para estas aclaraciones. Los nombres completos, incluidos Banco de México y Banco de Septiembre, se preservan.

El reporte usa el handler canónico autorizado y sus importes calculados. Selecciona la coincidencia exacta o única entre filas autorizadas antes del recorte de presentación. Una coincidencia ambigua o ausente no exporta el conjunto completo. El resultado se entrega inline y como datos tabulares persistidos; la interfaz genera el XLSX real con su helper existente. Sin resultado ejecutado se bloquean afirmaciones de generación o descarga, incluidas promesas futuras.

La aclaración vence a los 30 minutos o cuatro turnos y se invalida al cambiar de root o tema. Compensadas permanece false por defecto y conserva la selección explícita. El artefacto tiene como máximo 250 filas y 350 000 bytes, números finitos y metadatos explícitos de recorte; no se presenta como exhaustivo cuando se alcanza el límite de escaneo. No cambia fórmulas ni agrega escrituras financieras.

## Artefacto aislado

- Destino único: `sendAgent007Message`; voz queda fuera de este paquete.
- Base capturada en lectura: revisión `sendagent007message-00017-nup`, estado ACTIVE.
- SHA256 de ZIP desplegado R1.1: `8472bd111b323231b827e13e495fbfb137e17bbcb8ff6d823ad2d6d95b33413a`.
- ZIP local: `.firebase/modular-release/r12-chat-report/sendAgent007Message-r12-report.zip`.
- SHA256 de ZIP R1.2: `4c28005eed1d3cd22dda824212aa136d979fe24ff91f79659999bb6eed2ef577`.
- Conserva las 796 entradas originales, manifests y dependencias. Cambian siete módulos JS y sus siete mapas: callables, firestoreHugoDataStore, contextBuilderV2, conversationCore, conversationState, reportSemantics y reportConnector.
- Excluye aprendizaje D y comparaciones R2. `sourceTree` es null: overlay selectivo sobre fuente desplegada, no despliegue del árbol integrado completo.
- Evidencia privada local: `baseline.json`, `manifest.json`, fuente aislada y runtime en el mismo directorio ignorado. No publicar metadatos completos ni variables.

El commit integrado contiene la implementación R1.2 sobre el árbol de trabajo que ya incluye D/R2. Ese árbol completo **no** es el origen del despliegue. La procedencia del artefacto se fija con `qa/patches/r12-chat-report.patch` (SHA256 `6082ec30ade160ea31e71548556857c0061664ad90524605000ba5f29ed5b712`): nueve archivos TypeScript, dos con cambios sólo de tipos. El `patchCommit` debe identificar el commit que contiene ese parche exacto.

`qa/scripts/build-r12-chat-overlay.mjs` reproduce el ZIP usando la fuente R1 original, el ZIP R1.1 verificado, el compilador original y un directorio nuevo. No lee `functions/src` integrado. Comprueba que la emisión del original coincide con el runtime base, aplica únicamente el parche versionado y exige el SHA final indicado arriba. Ejecución local:

```powershell
node qa/scripts/build-r12-chat-overlay.mjs .firebase/modular-release/e1-2026-10-19T15-47-39-867Z/r1-report-overlay/build-sendAgent007Message .firebase/modular-release/r1-token-usage-hotfix/sendAgent007Message-token-usage-hotfix.zip .firebase/modular-release/e1-2026-10-19T15-47-39-867Z/r1-report-overlay/node_modules/typescript .firebase/modular-release/r12-chat-reproduction
```

## Validación

- Fuente final: 16/16 pruebas de continuidad y reportes.
- Runtime aislado final sin hook: 21/21 pruebas de continuidad y persistencia tokenUsage.
- Regresión canónica R1 del runtime aislado: 5/5.
- Emulador Firestore real sobre runtime aislado final, sin hook: 1/1, incluyendo la secuencia completa, historial persistido y revocación de usuario; cero proveedores.
- Startup con red bloqueada: PASS, 342 endpoints cargados y rechazo del destino sin autenticación.
- Typecheck aislado `tsc --noEmit`: PASS. El build integrado final 45259 pasó y su lib final obtuvo 21/21 sin hook. Un build anterior había emitido reportSemantics antes del último sufijo; la prueba detectó ese desfase (20/21), corregido por el build final.

La reversión debe restaurar el ZIP R1.1 capturado y su configuración vigente. No se han invocado proveedores, Telegram ni acciones financieras de producción. La comprobación funcional con la cuenta del usuario sigue pendiente de publicación autorizada.
