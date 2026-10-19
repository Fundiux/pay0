# R1.3 — cliente citado, reinicio conversacional y formato de reporte

Estado: candidato local, no publicado. Debe publicarse primero la UI compatible con PDF, que conserva XLSX histórico; después el backend, tras validar ambos artefactos y obtener autorización. R1.2 permanece congelado.

## Comportamiento

El parser elimina comillas y puntuación delimitadora del nombre de cliente, preservando su contenido. El caso `reporte de utilidades del cliente pc directo», del 2026-09-01 al 2026-09-30 y lo quiero en formato pdf` selecciona la fila canónica autorizada del cliente y conserva PDF al pedir el reporte nuevamente. Las pruebas usan datos sintéticos; no registran importes de la conversación productiva.

Los saludos independientes y la petición de una nueva conversación cancelan el reporte pendiente y los filtros de comparación. Responden de forma determinista, sin volver a consultar el reporte. Una aclaración de cliente ya no acepta cualquier mensaje como nombre.

Un pedido nuevo sin formato solicita PDF o Excel (XLSX) antes de consultar datos. La elección se conserva durante las aclaraciones de fechas y cliente. `reportExport.format` es opcional para compatibilidad: los mensajes históricos sin ese campo siguen siendo XLSX. Los nuevos artefactos declaran PDF o XLSX y un `fileName` con la extensión correspondiente. El backend entrega y persiste las filas canónicas; la UI genera el archivo al pulsar descargar. No se crean archivos de Storage ni se recalculan fórmulas financieras.

La prueba con Firestore real detectó que `merge:true` conservaba filtros omitidos dentro de `conversationState`. La escritura usa ahora `mergeFields:Object.keys(conversation)` para reemplazar ese mapa completo dentro del batch existente y preservar campos superiores ajenos. La prueba confirma que un saludo borra el pendiente, unas fechas posteriores no recuperan el cliente y un metadato ajeno permanece intacto. No se añade serialización entre turnos concurrentes: continúa la semántica existente de última escritura.

Se conservan autorización, root, compensadas, límites de escaneo, 250 filas y 350 000 bytes. No hay nuevos endpoints, dependencias ni escrituras financieras. La protección contra afirmaciones de archivos inexistentes contempla también PDF. Un resultado vacío no ofrece archivo ni promete una descarga.

## Procedencia aislada

- Base: ZIP R1.2 publicado en `sendagent007message-00018-sav`, SHA256 `4c28005eed1d3cd22dda824212aa136d979fe24ff91f79659999bb6eed2ef577`.
- Candidato: `.firebase/modular-release/r13-chat-report/sendAgent007Message-r13-report.zip`, SHA256 `a33ed9badb033a48a061a38ddb8295fd20f0aa5dedb567b37e423e7c37d68496`.
- Parche: `qa/patches/r13-chat-report.patch`, SHA256 `ecf080518e69b2dd12935d65b63f0c26a43c4852a2f01273c760edc08f9a5028`.
- Cambia cinco fuentes TypeScript; toolRouter sólo cambia tipos. En el ZIP cambian cuatro módulos JS y sus mapas (ocho entradas); las otras 788 entradas se preservan. No se incluyen aprendizaje D ni comparaciones R2.
- Backend: `sourceCommit: 0b17cfc6423ab4005c6d30087e50aa90ddd5e748`, `sourceTree: null`; el árbol integrado no representa este overlay. Input preparado: `.firebase/modular-release/r13-chat-report/release-sendAgent007Message/input.json`, SHA256 `5b2b517edf7a5c9ce5904cecb9617ebcd58a205b28796842eaf2f19be5933097`. Los hashes del input y ZIP se comprobaron contra los archivos locales.

La receta `qa/scripts/build-r13-chat-overlay.mjs` usa la fuente R1.2 aislada y verificada, su ZIP exacto, el compilador original y un directorio nuevo. No lee las fuentes integradas de Functions. Se comprobó que reproduce el mismo hash de ZIP desde cero.

## UI aislada final

- Fuente: `.firebase/modular-release/r13-maria-report-source`, rama `r13-maria-pdf-format`, commit `13620b74516843b232747904b606b34d0747f986`, sobre R1.2 `80a5e373a5829509fc3de16191e2ab1cd9ff789f`.
- Conserva las dos correcciones EUI de `a334817` y la base productiva `c1738b4`. El delta R1.3 contiene solamente `src/services/agent007.ts` (tipo de formato), `src/components/hugo/HugoReportAttachment.tsx` y `src/lib/hugoReportPdf.ts`. Excluye el wrapper D no publicado, MAT y revisión E.
- Build PASS: `.firebase/modular-release/hosting-13620b745168-2e88fdfd-6bcd-4eac-b902-bfbb13ac4efc/build.json`, SHA256 `59567695ca9d214848024627642882d627e333dfa41872e357465b4e4c43aae8`; build ID `JGEmwEIcQTq6aPSBUyDaK`.
- PDF y XLSX: PASS sobre la fuente exacta del clon en burbuja y página, con descargas reales y fixtures sintéticos. Los recibos `qa-pdf/ui-source-proof.json` y `qa-xlsx/ui-source-proof.json` están junto al build. Comprueban importes canónicos, cambio de usuario/root, descarte de respuestas tardías y cancelación de descarga pendiente.
- PDF sintético: 35 clientes con nombres largos, siete páginas inspeccionadas, nueve importes, filtros y límites visibles, filas sin partir y paginación sin recortes. La inspección visual está registrada en `tmp/e1-hugo-report-download/pdf-visual-proof.json`.
- No hay ZIP SSR ni input de publicación preparados para esta UI. Se requiere reconciliar E y capturar una baseline productiva fresca antes de preparar y verificar el runtime SSR con los guards vigentes. El input R1.2 anterior no certifica esta UI.

## Verificación y pendientes

- Diálogo y casos nuevos: 14/14 sobre fuente.
- Contexto, aprendizaje, hardening y comparaciones existentes: 34/34 sobre fuente.
- Runtime aislado sin hook: 27/27 (diálogo más persistencia tokenUsage).
- Reproducción del ZIP: PASS.
- Firestore Emulator real sobre runtime final: 1/1, incluyendo nombre citado con mes, persistencia del formato, reinicio y preservación de metadatos ajenos.
- Startup final con red bloqueada: PASS; 342 exports cargados y rechazo anónimo del único destino.
- Build NORMAL de Functions `94019`: PASS. Su `lib` final, sin hooks, obtuvo 64/64 regresiones de contexto, aprendizaje, comparaciones, autorización, tokenUsage y diálogo R1.3.
- Firestore Emulator independiente sobre esa `lib` final: 1/1 PASS; terminó con código 0 y cerró sus procesos.
- UI PDF: el responsable frontend reporta PASS de ambas superficies, siete páginas, filas sin partir, nueve importes canónicos y cancelación por identidad. Esta comprobación no constituye publicación.
- Build de integración frontend `85981`: PASS, con el helper PDF final y compatibilidad de historial XLSX.
- Pendientes: baseline productiva fresca tras reconciliar E, preparación SSR de la UI, verificación confinada del runtime exacto, autorización de los nuevos bytes y verificación funcional posterior a una publicación autorizada. El build UI no constituye un paquete de publicación completo; R1.3 no está publicado.

Logs privados: `tmp/r13-report-source-tests.log`, `tmp/r13-source-regressions.log`, `tmp/r13-exact-artifact-tests-final.log`, `tmp/r13-exact-emulator-final.log`, `tmp/r13-startup-final.log`, `tmp/r13-compiled-regressions-final.log` y `tmp/r13-compiled-emulator-final.log`. El preflight productivo debe comprobar nuevamente la revisión y fuente R1.2 antes de una actualización autorizada. La reversión restaura esa fuente y su configuración; no elimina mensajes ni auditoría. No se invocaron proveedores ni acciones financieras reales.
