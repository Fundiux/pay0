# Evolución PAY0 — resultado local

Fecha: 2026-10-19. Estado global: **PARTIAL**. Etapa 0: **E0_PASS**. Los siete entregables E0-01 a E0-07 y el certificado están en esta carpeta. Rama: `feature/pay0-global-evolution-20261019`, creada desde `d5a46a9` para preservar los cambios acumulados. No hubo merge, push ni despliegue.

## Resultado por frente

| Frente | Reutilización y cambio real | Estado y límite |
|---|---|---|
| A | Core/router existentes; herramienta de reporte empresarial autenticado | INTEGRATION_READY local; operación empresarial real externa pendiente |
| B | Chat y voz usan el mismo handler y resumen de utilidades por cliente | INTEGRATION_READY; no certifica paridad total ni sesión Realtime real |
| C | Reporte canónico con fechas, límites y compensadas; fixtures verifican 37.45 y 136.45 | VERIFIED con datos sintéticos; no PDF/XLSX nuevo ni datos productivos |
| D | Elegibilidad de aprendizaje recalculada ante revocación, split protegido y supersesión | VERIFIED local; no entrenamiento remoto ni cambios de reglas financieras |
| E | Seguimiento, asignación e importación administrativa ya existentes; catálogo/evidencia probados | BLOCKED para E2E nuevo por emulador ocupado; no se presenta función existente como nueva |
| F | Una generación no reinicia presupuesto; fuente actual, scope y terminalidad revalidados | VERIFIED con transacciones simuladas; persistencia real pendiente |
| G | Guardia de claves duplicadas, manifest/lock/runtime/override en CI y candidato | VERIFIED local; complementa baseline de capacidades existente |
| H | Controles Sentinel, firma, cuota, duplicación y recuperación; guard histórico corregido | VERIFIED local; sin activación remota ni nuevas restricciones automáticas |
| I | Acciones MAT enlazan solicitudes/retornos a flujos web existentes; acceso corregido | INTEGRATION_READY parcial; requiere sesión PAY0 y E2E Telegram autorizado |
| J | Contratos Telegram probados; productor QR y dependencia de consumidor identificados | BLOCKED para recuperación real de canal externo |
| K | Node22 y siete componentes inspeccionables, seis locks; UUID voz corregido | VERIFIED local; identidad productiva UNKNOWN, migración Next mayor pendiente |

Los cambios están guardados en esta rama para revisión. No están fusionados con main ni publicados. Un estado VERIFIED de la tabla se limita a la prueba descrita; no equivale a COMPLETED global.

## Qué se desarrolló y qué se preservó

La herramienta de reporte reutiliza `getEarningsByClientReportHandler`: conserva autenticación, permisos, root, filtros y fórmulas. Declara inclusión/exclusión de compensadas y posible truncamiento. Fechas ambiguas o inválidas solicitan aclaración. El handler público existente se conserva. Su publicación futura exige coordinar **Functions y gateway**; publicar sólo gateway dejaría una herramienta rechazada por la versión anterior del backend.

Las consultas universales se copian y congelan profundamente en sus estructuras admitidas. Los registros de aprendizaje ya no conservan una autorización efectiva basada únicamente en elegibilidad almacenada y desactualizada.

MAT deja de tratar un conjunto de clientes vacío como acceso universal. La autorización pagina antes de limitar las seis tarjetas; se probó cliente 251. Rechaza vínculos revocados, cliente inexistente/root ajeno y ledger con root explícitamente ajeno. Conserva compatibilidad histórica con ledger sin metadata root, cuya pertenencia no se ha certificado. Sus botones sólo navegan a pantallas autorizadas; no crean solicitudes ni dispersiones automáticamente.

No se modificaron reglas Firestore/Storage, permisos canónicos, fórmulas financieras ni datos históricos. No se leyeron secretos para los informes ni se borraron sesiones. El Lote 1 y sus cambios pendientes se mantuvieron fuera de las modificaciones.

## Verificaciones

- `npm run build`: PASS, Next 15.5.27; compilación, tipos y 47 páginas estáticas.
- `npm --prefix functions run build`: PASS con Node 22.23.2. Se reconstruyó después de los cambios finales del parser.
- Inteligencia: **45/45**, sin skips; consultas, reportes, aprendizaje y voz. Incluye exclusión explícita de compensadas. Los resultados usan fixtures controlados, no una operación productiva.
- Operaciones/MAT/Telegram/catálogo administrativo: **33/33**, sin skips.
- Sentinel, reportes no confiables y JSON estricto: **27/27**; transporte firmado/KMS/metadata/servicio: **26/26**.
- Tecnología, consumidor UUID/Storage/gaxios y candidato: **17/17**.
- Gateway voz: **49/49**.
- Política de autorización, límites de ecosistema, guard de seguridad, contrato ejecutable Materialidad y `git diff --check`: PASS.
- Instalaciones reproducibles `npm ci` de gateway/E2E: PASS, 190 paquetes cada una. UUID 9.0.1 → 11.1.1; Storage y todos los demás paquetes se conservan.
- Auditorías de los seis lockfiles: cero hallazgos en el registro consultado. No implica ausencia absoluta de vulnerabilidades. Ver detalles y fuentes oficiales en [GK-technology.md](GK-technology.md).

Comandos de pruebas focalizadas:

```powershell
node --test --test-timeout=20000 evals/hugo/evolution-query-contract.test.cjs evals/hugo/evolution-reports.test.cjs evals/hugo/phase5-learning.test.cjs evals/hugo/phase6-hardening.test.cjs evals/hugo/voice-platform-regression.test.cjs evals/hugo/voice-authorization-matrix.test.cjs evals/hugo/voice-routing.test.cjs
node --test qa/scripts/evolution-recovery-mat.test.cjs qa/scripts/engineering-catalog.test.cjs qa/scripts/engineering-evidence.test.cjs qa/scripts/remediation-telegram-token.test.cjs
node --test qa/scripts/technology-baseline.test.mjs qa/scripts/uuid-consumer-compatibility.test.mjs qa/scripts/release-candidate.test.mjs
npm --prefix services/hugo-voice-gateway test
node scripts/verify-technology-baseline.mjs --installed
node scripts/verify-authorization-policy.mjs
node qa/scripts/audit-security-regression.mjs
node qa/scripts/check-materiality-canon.mjs
```

No se ejecutó `qa:pay0` como supuesto gate global, la suite Playwright completa, llamadas reales IQ/WhatsApp/Telegram, entrenamiento remoto ni un despliegue. Se corrigieron dos fixtures de voz que intentaban resolver perfiles fuera de su base simulada y dos aserciones históricas desactualizadas; no se desactivaron pruebas ni se relajaron autorizaciones.

## Bloqueos, riesgos y reanudación

1. **E/F persistencia E2E:** el intento con proyecto demo-pay0 y puerto 8185 se detuvo al detectar puertos 4400/4500/9150 ocupados. Se canceló únicamente nuestra espera, sin terminar procesos ajenos. Reanudar en un emulador libre y aislado. Alternativa usada: contratos y transacciones sintéticas, claramente identificadas.
2. **A/B/I:** faltan identidad/entorno autorizados para operaciones reales y Realtime. Reanudar con cuenta de prueba y proveedor habilitado. Las pruebas locales no satisfacen la aceptación productiva.
3. **J WhatsApp:** `src/app/whatsapp/page.tsx` → `src/services/whatsappQr.ts` → `documentDelivery/whatsappQrCallables.ts` crea comandos en `whatsappQrConnectorCommands`. No se encontró consumidor en archivos versionados. `whatsappRuntime.ts` exige heartbeat reciente (90 segundos). Reanudar con acceso autorizado al proceso externo; no borrar ni regenerar sesiones sin ese diagnóstico. Telegram real también pendiente.
4. **G/K publicación:** producción sigue UNKNOWN. Los hashes del árbol local no prueban el artefacto publicado. Reanudar con evidencia del despliegue, certificación y autorización específica para publicar. Rollback local: revertir los commits individuales mediante una nueva operación autorizada; no se realizó rollback ni reescritura de historia.
5. **K soporte:** planificar migración Next15→16 con pruebas, según política oficial; no se ejecutó migración mayor sin evaluación. La caché npm fuera del workspace produjo EPERM y podas opcionales; esos resultados se descartaron y se regeneraron locks en copia aislada/caché local. Ninguna poda se integró.

## Trazabilidad

- `c85e70f`: siete entregables y certificado E0.
- `be72108`: reporte compartido chat/voz.
- `41bc84c`: consultas inmutables y elegibilidad vigente.
- `5b0db91`: recuperación y acciones/acceso MAT.
- `6c10482`: regresión de seguridad alineada a contratos vigentes.
- `a0176e4`: guard tecnológico y corrección UUID.
- `73c1cb5`: exclusión explícita de operaciones compensadas.

El resumen final de la conversación identifica el último commit de cierre. Los artefactos de pruebas permanecen ignorados en tmp/output; no se incorporan al repositorio.
