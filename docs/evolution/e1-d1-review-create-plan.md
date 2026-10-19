# D1 — propuesta de creador acotado para revisión supervisada

Estado: **PLAN_ONLY_REQUIRES_EXPLICIT_CREATE_AND_IAM_APPROVAL**. Se implementó un runner específico con pruebas simuladas y se prepararon baseline, input y plan locales. No se creó un endpoint, modificó IAM, activó el gate ni ejecutó un despliegue. No se modificó `create-recovery-review-functions.mjs` ni sus inputs.

## Artefacto y dependencia

Único destino del creador: `reviewAgent007LearningRule`, proyecto `pay-0-system`, región `us-central1`. No actualizará `sendAgent007Message`, voz, reglas o datos.

Archivo existente `.firebase/modular-release/d1-after-r2-candidate/d1-after-r2.zip`: SHA256 `55c5c45aaab2a1603499a058605f4f38522e5092d2159957097566ac9b6dd077`. Procedencia: R2 `83baf34e6e7c3f52c90d820ef18a555da8d2aba854bbb8dc552b72be44c36bfe` más patch D1 `744e16e5f5166acd3fbeb5a60d674a59245f4287db7cf01d318a17856418e9ae`, commit `21eba53611dde560b446b273f3a32562897e587e`, `sourceTree:null`. No sustituir por las fuentes D2 actuales ni por el árbol integrado completo.

Evidencia existente del ZIP: startup 343 exports, conserva los 342 previos, rechazo anónimo en chat/revisión, gate OFF; 20 comprobaciones en emulador, 61 regresiones y typecheck. Estas pruebas no certifican configuración o IAM del endpoint todavía inexistente.

Crear únicamente el endpoint de revisión con gate OFF **no depende de que R2 esté publicado**. Antes de preparar su input se necesita una baseline propia: padre de configuración listo y exacto, destino ausente y ninguna operación activa. El origen R2 del ZIP es procedencia, no una condición sobre el chat productivo. En cambio, actualizar después `sendAgent007Message` con el overlay D1-after-R2 sí exige que ese chat conserve la revisión y SHA de fuente R2 esperadas; ese paso pertenece a otro ejecutor/paquete.

## Runner propuesto

Archivo independiente `scripts/create-supervised-learning-review.mjs`, con lista cerrada de **un** nombre y modo predeterminado de plan local. No importa ni modifica la función `buildCreatePlan` del creador E ni cambia su whitelist. Sus contratos de dos endpoints siguen rechazando este destino. El nuevo archivo conserva los mecanismos revisados de ese flujo en una implementación separada.

El runner verifica rutas privadas sin symlink, hashes de input/plan/archivo/baseline, subida con generación exacta, lock exclusivo, journal durable, reconciliación de creación incierta, postflight y rollback de invocación. El plan fija además hashes del controlador y de sus dos helpers; una modificación invalida el plan anterior. La preparación usa creación exclusiva del archivo de plan, sin sobrescribirlo.

El input debe fijar el ZIP D1 exacto, commit/patch/base de su procedencia, `gateMode:OFF`, baseline propia y dos proofs. `startupProofFile`/`behaviorProofFile` deben estar bajo el directorio privado y `startupProofSha256`/`behaviorProofSha256` vinculan sus bytes al input/plan. Se comprueba cada SHA antes de parsear JSON, tanto en preparación como ejecución, y ambos proofs deben declarar la misma `sourceIdentity`. Los proofs históricos sin ese campo no se aceptan directamente: falta producir y revisar la evidencia de identidad correspondiente, conservando su procedencia. Los contadores declarados por sí solos no bastan.

## Configuración e IAM

Plantilla explícita: `getControlCenterEngineering`, ya usada como origen de configuración en el paquete E. Antes de emplearla, recapturarla. El runner exige su nombre y servicio exactos, Node22, callable sin trigger, servicio listo y política de invocación observada. La configuración objetivo declara `entryPoint=reviewAgent007LearningRule`, timeout 30 s y memoria 256 MiB. Sólo conserva campos permitidos de identidad, red, escalado, runtime y build; omite estado, URL, revisión y source del padre. Rechaza referencias o volúmenes de secretos no vacíos en esa plantilla; no introduce secretos nuevos.

El creador sólo permitirá el gate `HUGO_SUPERVISED_RULES_ENABLED` ausente o explícitamente `false`. Rechazará `true` y cualquier valor ambiguo. **La autorización para crear y dar invocación pública no incluye activar aprendizaje.** La actualización de código de chat y el cambio posterior de gate son operaciones separadas con sus propios artefactos/aprobaciones.

IAM candidato: `roles/run.invoker` para `allUsers` sólo en `reviewagent007learningrule`, necesario para el transporte callable, con autorización lógica Firebase en el handler. El contrato lógico es usuario autenticado, superadmin vigente y root revalidado por servidor; no copiar del runner E la descripción `reportes/view`, que no corresponde a este handler. Rechazar políticas existentes inesperadas y no conceder roles de proyecto ni permisos a otros servicios.

## Secuencia y reversión

1. Verificar padre de configuración y ausencia del destino mediante lectura; preparar y revisar el plan completo sin mutaciones. No consultar ni exigir el estado de chat R2 para crear este endpoint apagado.
2. Con autorización específica para crear el endpoint y su invocación pública, publicar el ZIP D1 exacto con gate OFF. Comprobar identidad/configuración/IAM, source hash, rechazo anónimo y gate apagado. No aprobar ninguna regla real.
3. Actualizar chat con su paquete D1 separado y gate OFF, cuando corresponda; conservar R2. El creador no realiza este paso ni añade ese nombre a su scope.
4. Sólo tras disponer de interfaz o procedimiento de revisión humana aprobado, datos legítimos y autorización de activación, preparar el cambio explícito de configuración de gate. D2 no se incluye implícitamente en este archivo D1.

Rollback del creador: revalidar que función/servicio/IAM coinciden con su journal, retirar únicamente `allUsers` del binding de invocación que él agregó y verificar el resultado. Conservar endpoint, otros bindings y todos los documentos/ledger. No apagar el gate de chat ni revertir R2 desde este runner. Una respuesta incierta exige reconciliación, no repetir una creación ni borrar un destino existente.

## Pruebas requeridas antes de implementar ejecución

`node --test qa/scripts/supervised-learning-review-create.test.mjs qa/scripts/e1-operations-create-plan.test.mjs`: **48/48 PASS**, cero skips, de las cuales 27 corresponden al runner nuevo y 21 preservan el creador E. Prueban otro destino/duplicados, pins del ZIP/commit/patch, destino existente, deriva del padre, gate ON/ambiguo, secretos no revisados, política inesperada, ruta fuera de privado, junction, alteración de proof antes de parsearlo, identidad de proof distinta, pins del plan, concurrencia, respuesta incierta sin recreación, reanudación y rollback limitado. El caso positivo demuestra también que no se exige un recurso chat R2 para crear review apagado. Toda la red está sustituida por IO de prueba.

## Paquete local preparado

Directorio privado: `.firebase/modular-release/learning-review-create/`. La captura de sólo lectura confirmó padre `getcontrolcenterengineering-00001-cij`, destino ausente, cero operaciones activas, cero referencias/volúmenes de secretos y gate ausente. El plan nuevo fija el gate del destino a `false` y sólo propone `allUsers` como invoker del nuevo servicio.

| Archivo | SHA256 |
| --- | --- |
| `baseline.json` | `47e6cc83296861d0de288089a15263c83d72646b162ad5a3e682f419ac513866` |
| `input.json` | `098b11dffbc8927b624e1733a359444a294e483c9bf4efffe4ebfd7bb1467143` |
| `create-plan.json` | `a58252a5f24835cbaf49133074bd3800d02b4dc780e4b9e6202e362dec327bbb` |
| `startup-verification.json` | `2e0f275f5c8fc3355726cb4525d1eb616e575c81ff9120a8a70077a1160e8c3b` |
| `behavior-verification.json` | `b593f7994752c1fa6084e1c2b41ebc2547edacb74a1b1b7ee7fde5566c4b4e8d` |

Los dos proofs son envolturas locales de identidad de la evidencia original ya revisada; no afirman una nueva ejecución de sus pruebas. Conservan todos los resultados y añaden `sourceIdentity` e `identityBinding`, con ruta y SHA del original. Antes de producirlas se verificaron el ZIP exacto `55c5…`, los originals `bfbe97c878bdb92c961aef09de70637e6a08fa9c5d04285e5ae30206438a04a2` (startup) y `61789ae49b7a5a6f02643a5402c80e42220e92e2df68e504707d12d4439541e4` (comportamiento). Los originales no se modificaron.

`local-validation.json` confirma regeneración idéntica del plan, hashes de proofs, identidad, scope único y gate OFF; cero llamadas de red y escrituras productivas durante esa validación. La captura de metadatos anterior sí usó GET autenticados, sin leer documentos. El ejecutor repetirá las verificaciones de recursos y ausencia justo antes de cualquier mutación.

Pendiente: revisión final del paquete y autorización específica de creación/IAM. Tener runner y plan no equivale a endpoint creado ni gate habilitado. La actualización posterior de chat D1 mantiene su precondición R2 y su aprobación independiente.
