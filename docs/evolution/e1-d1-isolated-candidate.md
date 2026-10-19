# D1 — candidato aislado de aprendizaje supervisado sobre R2

Estado: **LOCAL_CANDIDATE_NOT_DEPLOY_READY**. No se desplegó, creó un endpoint, cambió IAM ni activó el gate. El orden previsto es R1.3 → R2 → D1. Publicar el antiguo candidato D1 sobre R1.3 después de R2 retiraría R2; esta composición evita ese reemplazo.

## Identidad y alcance

- ZIP privado: `.firebase/modular-release/d1-after-r2-candidate/d1-after-r2.zip`, SHA256 `55c5c45aaab2a1603499a058605f4f38522e5092d2159957097566ac9b6dd077`.
- Base R2: SHA256 `83baf34e6e7c3f52c90d820ef18a555da8d2aba854bbb8dc552b72be44c36bfe`, que conserva R1.3.
- Once fuentes D tomadas de v6: ZIP `3326853f44c3071e767d8cc4d6a07cdc543fc85435c9029e424520823557da1e`; parche adaptado `744e16e5f5166acd3fbeb5a60d674a59245f4287db7cf01d318a17856418e9ae`.
- Origen D: `5d07dc02edef7e24fb1619b1c34d5db6298c323f`. Corrección de permisos almacenados: `41bc84c295dcff8909efb28954ab3e6246254b0e`. Son procedencias de deltas, no del árbol completo del ZIP. `sourceTree: null`; no hay input de despliegue ni commit inventado para el parche adaptado.
- Destinos propuestos: actualizar `sendAgent007Message` y crear `reviewAgent007LearningRule`. Se excluyen voz, UI administrativa, reglas, índices y cambios de permisos. El creador de endpoints de recuperación está limitado a otros nombres y no sirve para crear este endpoint.

Las once fuentes son `src/index.ts`, `src/modules/agent007/callables.ts`, `firestoreHugoLearningRuleStore.ts`, `firestoreHugoLearningStore.ts`, `hugoCore/conversationCore.ts`, `hugoCore/learningContract.ts`, `hugoCore/learningStore.ts`, `observationEvidence.ts`, `hugoCore/evidenceIdentity.ts`, `hugoCore/experienceBuilder.ts` y `hugoCore/learningGovernance.ts`; los nombres abreviados comparten `src/modules/agent007/`. El manifest privado conserva las rutas completas.

## Prerrequisitos y comportamiento con gate apagado

El parche inicial de siete fuentes no bastaba: R1.3 carecía de `observationEvidence` y `evidenceIdentity`, y su `buildVerifiedExperience` no recibía la identidad completa. Se añadieron esos tres prerrequisitos y los mapeos de procedencia del store. `paymentApplications/domain` y `activityLog/systemBoundary` permanecen byte a byte; sus exports existentes satisfacen las dependencias. No se copiaron módulos financieros completos.

El gate `HUGO_SUPERVISED_RULES_ENABLED`, ausente por defecto, controla la revisión y aplicación de reglas. **Apagarlo no neutraliza todos los cambios:** `createDraftFromDecision`, `createFromVerifiedMemory` y `linkOutcome` exigen identidad coherente de sistema, tipo e identificador. `learningGovernance` vuelve a comprobar la elegibilidad vigente antes de aceptar un permiso almacenado. El fallo de conservar ese permiso tras proteger una experiencia se reprodujo contra R1.3 y se corrigió sin ampliar permisos.

Los flujos válidos de borrador, experiencia verificada y enlace de resultado persisten con el gate apagado. Los casos de sistema o tipo ajeno se rechazan sin modificar la experiencia. Las observaciones históricas sin `sourceSystem` requieren resolución transaccional al activity log: referencia exacta, root, evento, identidad y tiempos coherentes. El camino legacy `activityLog` exige `activitySchemaVersion: 2`, `atomicBatch: true` y referencias válidas de aplicación/reserva. No se reescriben observaciones ni se inventa procedencia.

La regla sólo recomienda revisar documentación de una solicitud pendiente. Requiere experiencias y resultados verificables, aprobación humana vigente y ámbito propio; caduca y puede revocarse. No modifica solicitudes ni realiza operaciones financieras.

## Evidencia del artefacto exacto

- Auditoría independiente: once fuentes D idénticas a v6 y 282 fuentes R2 restantes preservadas; index y callables conservan el AST de declaraciones ajenas. ZIP: 783 entradas iguales, 13 cambiadas, seis nuevas y ninguna eliminada. Manifiestos y lockfiles preservados.
- Runtime: 802 archivos cotejados byte a byte con el ZIP. Las dependencias de QA se reutilizaron mediante junction local tras comparar package/lock; no se afirma instalación hermética nueva.
- Typecheck aislado de la fuente compuesta: PASS. No se compiló ni modificó el árbol Functions compartido.
- Regresiones: **61 PASS** — 53 de contexto, aprendizaje, hardening, métricas y R1.3; ocho de reportes R2. Una expectativa antigua omitía `format: XLSX`; se usó la versión revisada `9204e90`, sin cambiar el producto.
- Firestore Emulator: **20 TAP PASS** — siete de reglas, seis de persistencia/concurrencia/elegibilidad/revocación, cuatro de creación y resultado con gate apagado y rechazo de identidad ajena, dos flujos R1.3 con gate apagado/encendido, uno de persistencia R2. Proyecto `demo-pay0-e1-27772`, puertos aislados, salida 0 y emulador cerrado.
- Startup con red bloqueada y gate apagado: **PASS**, 343 exports (342 previos más revisión), rechazo anónimo de ambos destinos. Se reutilizó el contrato del probe de `verify-scoped-functions-artifact.cjs`.
- Evidencia privada: `manifest.json`, `review-structure.json`, `behavior-verification.json` y `startup-verification.json` dentro de `d1-after-r2-candidate`; logs `tmp/d1-final-regressions.log`, `tmp/d1-r2-report-regressions-final.log` y `tmp/d1-r2-typecheck.log`.

Las pruebas usan fixtures y handlers reales con autenticación sintética. No certifican Firebase Auth productivo ni reglas de clientes: el Admin SDK las omite. No hubo envíos ni escrituras productivas.

## Reproducción local

La receta versionada `qa/scripts/build-d1-after-r2-overlay.mjs` recibe cuatro argumentos: directorio de fuente R2 verificada, ZIP R2 exacto, módulo TypeScript del lock preservado y directorio de salida nuevo. Aplica `qa/patches/d1-after-r2-learning.patch`, coteja el emisor de la base y reproduce el mismo ZIP; no lee fuentes Functions integradas. No sobrescribe una salida existente.

```powershell
node qa/scripts/build-d1-after-r2-overlay.mjs $R2Source $R2Zip $TypeScriptModule $NewOutput
$env:PAY0_D1_ARTIFACT_DIR = $NewOutput
node qa/scripts/e1-operations-d1-exact.cjs --regressions
node qa/scripts/e1-operations-emulator.mjs qa/scripts/e1-operations-d1-exact.cjs
$env:PAY0_D1_BASE_RUNTIME = $VerifiedR2Runtime
node qa/scripts/e1-operations-d1-exact.cjs --startup
```

Los runtimes necesitan las dependencias del manifest/lock preservados. Puede reutilizarse una instalación local sólo tras comparar ambos archivos; nunca se incluye esa junction en el ZIP. El runner verifica el ZIP y cada archivo extraído antes y después, y genera copias de los fixtures versionados con imports dirigidos al runtime aislado. La prueba adicional `e1-operations-d1-gate-off.test.cjs` comprueba persistencia y rechazo de identidades ajenas con el gate apagado. No sustituye ni transpila módulos de producto en las pruebas.

## Índices y condiciones de publicación

El análisis de planes productivos, sin ejecutar consultas, pasó para las dos formas exactas: reglas por root/schemaVersion/status con límite 21 y experiencias por root/domain/taskType con límite 101. `output/d-publication-plan/query-plan-only-proof.json` registra HTTP 200, cero documentos y cero consultas ejecutadas. No se añadieron índices. Esto valida planificación, no autorización ni suficiencia de experiencias reales.

Antes de crear un input publicable deben confirmarse R1.3 y R2 vivos y recapturarse bytes/configuración. Crear el nuevo endpoint requiere un plan propio y aprobación explícita de configuración/IAM. El gate permanece apagado; activarlo requiere autorización separada. No hay interfaz de revisión en este paquete. La reversión debe preservar R2/R1.3 y datos/ledger; no usar el antiguo ZIP D1 basado sólo en R1.3.
