# D — publicación separada del aprendizaje supervisado

Estado: **LOCAL_VERIFIED_NOT_DEPLOYED**. Plan de artefacto, sin construcción nueva, instalación, creación de endpoints ni activación. La capacidad y pruebas existentes se describen en [e1-d-supervised-learning-status.md](e1-d-supervised-learning-status.md).

## Diferencia concreta frente a R1.3

Fuente D: `5d07dc02edef7e24fb1619b1c34d5db6298c323f`. Los módulos nuevos de reglas y cambios del contrato/store conservan esos mismos bytes en HEAD. No copiar el `callables.ts` ni `conversationCore.ts` completo actual: contienen cambios posteriores de reportes que no pertenecen a D.

El ZIP R1.3 preservado, SHA256 `a33ed9badb033a48a061a38ddb8295fd20f0aa5dedb567b37e423e7c37d68496`, no contiene `firestoreHugoLearningRuleStore.js`, `reviewAgent007LearningRule` ni `resolveSupervisedRule`. Eso es una exclusión deliberada, no una capacidad publicada que deba reconstruirse.

Se generó el parche D exacto de siete fuentes desde el commit original: `output/d-publication-plan/d-only-source.patch`, SHA256 `16fa7cefb97937784659861ec0ef377faa93bff753c84f85ec0ff098fc6884e4`. La comprobación correcta desde raíz con `git apply --check -p2 --directory=.firebase/modular-release/r13-chat-report/source` **falla en `conversationCore.ts:54`**. La primera ejecución desde un subdirectorio no validó correctamente el destino y se descarta. Hace falta adaptar únicamente el contexto del hunk y revalidar todas las declaraciones ajenas; no copiar el Core integrado completo. No se modificó la fuente R1.3 ni se acredita compatibilidad del parche aún.

| Fuente | Cambio D permitido |
| --- | --- |
| `src/index.ts` | Exportar únicamente el nuevo `reviewAgent007LearningRule` |
| `src/modules/agent007/callables.ts` | Import y handler de revisión; conservar todos los handlers existentes |
| `src/modules/agent007/firestoreHugoLearningRuleStore.ts` | Nuevo store de aprobación, revocación y resolución |
| `src/modules/agent007/firestoreHugoLearningStore.ts` | Delegación `resolveSupervisedRule` |
| `src/modules/agent007/hugoCore/conversationCore.ts` | Consulta de regla y respuesta determinista con precedencia existente preservada |
| `src/modules/agent007/hugoCore/learningContract.ts` | Tipos de eventos de activación/revocación/invalidación |
| `src/modules/agent007/hugoCore/learningStore.ts` | Método opcional del contrato |

Los imports requieren `experienceBuilder`, `learningEvaluation`, `learningStore`, `observationEvidence`, `authGuard`, Firebase y módulos Node. La revisión de inteligencia identificó que `observationEvidence.ts` no está en la fuente R1.3 y que `buildVerifiedExperience` no es equivalente al integrado. Por ello el parche de siete fuentes aún no cierra sus dependencias: operaciones debe reconciliar los prerrequisitos exactos, delimitar su delta y probarlos, sin copiar transitivos completos del árbol integrado. No hay nuevas dependencias npm ni secretos propuestos. Las pruebas del árbol integrado no certifican las versiones transitivas del futuro overlay.

## Estado remoto observado, no supuesto

Consulta de metadatos del 2026-10-19 20:33 UTC, sin invocar handlers:

- `reviewAgent007LearningRule`: ausente.
- `sendAgent007Message`: ACTIVE, revisión `sendagent007message-00018-sav`; gate ausente.
- `delegateHugoVoiceTurn`: ACTIVE, revisión `delegatehugovoiceturn-00010-caj`; gate ausente.

En ese instante R1.3 todavía era candidato. El paquete D debe recapturar la fuente y configuración después de la publicación R1.3 y verificar que coinciden con el artefacto aprobado; no usar esta observación como autorización sobre una revisión futura. Evidencia privada: `output/d-publication-plan/live-metadata.json` y `r13-source-inspection.json`.

## Paquetes publicables propuestos

**D1, chat supervisado y revisión.** Dos endpoints seleccionados: actualizar `sendAgent007Message` y crear `reviewAgent007LearningRule`. Este último declara región `us-central1`, timeout 30 s y memoria 256 MiB; su handler autentica mediante el actor existente y el store relee superadmin/root dentro de la transacción. La creación necesita un plan propio que fije IAM, identidad y configuración: el creador de endpoints de recuperación está limitado a sus dos nombres y no debe reutilizarse saltando esa restricción.

Preparar un overlay sobre la fuente real de chat R1.3; conservar lock, runtime, opciones, secretos, IAM y todos los exports previos. Compilar sólo el delta revisado con el compilador del manifest preservado; comparar AST de declaraciones ajenas y bytes de archivos no cambiados. La salida esperada comprende index, callables, nuevo store, store existente y core, con sus mapas; los cambios de tipos no justifican reemplazar más módulos runtime. Registrar `PRODUCTION_OVERLAY_V1`, hash de archivo base y hash de parche real aplicado, sin declarar un checkout integrado completo.

**Gate independiente.** `HUGO_SUPERVISED_RULES_ENABLED` debe ser exactamente `true` tanto en el endpoint de revisión como en el consumidor chat para administrar y aplicar reglas. Publicar código manteniendo el gate ausente deja la capacidad apagada. Su activación es un cambio explícito de configuración que requiere autorización; no debe camuflarse como actualización sólo de fuente. No activar voz incidentalmente.

**D2, voz opcional y separada.** El código integrado de voz usa el mismo Core/store, pero su revisión productiva no recibe el overlay de chat. Incorporar D en voz requiere su propia fuente base, comparación, artefacto, pruebas y gate. No es necesario desplegar voz para ofrecer D1 en chat y no se incluye por defecto.

**Interfaz.** El wrapper `reviewAgent007LearningRule` existe en el árbol integrado, pero no hay página o componente administrativo que lo use. La UI R1.3 y el candidato admin/MAT lo excluyen. No presentar revisión humana accesible desde esa UI: una futura interfaz supervisada es otro delta. Nunca aprobar reglas automáticamente ni inventar IDs de experiencias.

## Datos, pruebas y aceptación

Se reutilizan `agent007LearnedRules`, `agent007LearningLedger` y experiencias existentes. No se cambian reglas Firestore ni se migran datos. La configuración local tiene índice de experiencias root/domain/taskType; el nuevo lookup de reglas filtra root/schemaVersion/status. Debe verificarse su resolución contra los índices reales antes de activar: el emulador no certifica índices de producción. No agregar índices o permisos preventivamente sin evidencia.

Metadatos consultados el 2026-10-19 20:38 UTC, sin leer documentos: el índice de experiencias rootId/domain/taskType existe `READY` (`CICAgPigl4sK`) y coincide con el archivo local. Para reglas se observó únicamente rootId/createdAt `READY` (`CICAgNj4kZ4K`); no hay un compuesto exacto rootId/schemaVersion/status en la configuración local ni en la respuesta consultada. Esto no demuestra que la consulta falle: no se ejercitó combinación de índices ni query real. Mantener pendiente esa validación antes del gate. Evidencia filtrada a esas dos colecciones: `output/d-publication-plan/index-metadata.json`, SHA256 `f2086efffad3d6c2dac6a3ff7df12a649847fc76c1f4939497c6ebfe9c8fd037`.

El coordinador cerró después la validación del plan de ambas consultas mediante Explain con `analyze:false`: **PLAN_PASS**, HTTP 200, cero documentos devueltos y cero consultas ejecutadas. La consulta de reglas combina los índices simples rootId, status y schemaVersion; experiencias usa el compuesto rootId/domain/taskType. Evidencia: `output/d-publication-plan/query-plan-only-proof.json`, 2026-10-19 20:39 UTC. No hace falta proponer otro índice para esos planes observados. Este resultado resuelve la planificación de índices; no certifica legitimidad de datos, permisos del runtime, rendimiento ejecutado ni comportamiento del artefacto D.

Evidencia reutilizada: **7 pruebas de emulador** para aprobación/revocación/evidencia, y **64 regresiones** del build NORMAL informado en el paquete R1.3. No se volvieron a ejecutar ni se atribuyen al futuro ZIP D. Para aprobar ese ZIP se necesitan las mismas pruebas contra el artefacto exacto, startup con gate apagado, luego fixtures sintéticos con gate activo y casos de rol/root revocados, contradicción, expiración, pérdida de evidencia, idempotencia y solicitud intacta. Verificar que los reportes, formatos, reinicio de tema y selección de cliente R1.3 siguen iguales con el gate apagado y activo.

Alcance máximo: recomendar `VERIFY_DOCUMENT_BEFORE_DECISION` sobre una solicitud pendiente con evidencia exacta. No confirma que falten documentos, no determina la causa, no modifica solicitudes ni realiza operaciones financieras. La recomendación caduca a las 24 horas y la revocación se conserva en el ledger.

Reversión operativa: apagar el gate de chat detiene la aplicación; apagar el gate de revisión también impide revocar mediante ese endpoint, por lo que no sustituye la revocación humana de reglas. Conservar datos/ledger; una reversión de código debe revalidar fuente/configuración/IAM y preservar cambios R1.3 posteriores. Ninguna publicación o escritura de negocio fue realizada para este plan.
