# D: entrega parcial exacta de consulta y revocación autorizada

Estado: **DEPLOYED_NOT_VERIFIED — instalación parcial verificada técnicamente; consulta autenticada pendiente**. Los tres paquetes fueron autorizados y publicados secuencialmente. Quedaron disponibles el diagnóstico y el endpoint que admite REVOKE autenticado con gate OFF; no se aprobaron ni revocaron reglas reales como prueba. APPROVE y aprendizaje activo permanecen apagados. No se actualizó chat. D global sigue INTEGRATION_PENDING y no se declara operación humana completa antes de comprobarla con una sesión autorizada.

## 1. Componentes y vigencia, sin activar

| Componente exclusivo | Input SHA256 | Plan o proof SHA256 |
| --- | --- | --- |
| Crear sólo `reviewAgent007LearningRule`, gate OFF y REVOKE disponible | `9ddac34f4ecd6c9c0152ede973f10f77f472a108baabc1082397b1d14100a0b1` | Plan `b867ee0677e4542b21ba2d57659d0adcac770e5b9ea6b3126486854e1a3a15bb` |
| Actualizar sólo `listAgent007LearningDiagnostics` | `f58c9ef8eb06eca41288bb215e6e126ab52d6f9db0d4414a47b6809f729424af` | Plan `351714d65bd64f16f002726650f26f5157e8dbf8a1ac18e006cba994967423d8` |
| Hosting/SSR de la UI D2, conservando admin/MAT | `78203f56922c8cc603260ad4dae1847b45afb06d01fb2558cc2585593f6b08f0` | Runtime `c0dbca5687ab3c6306afb7185408c76864ec8b24d4ca79e95c2781bd1815b47c` |

Las rutas privadas son, respectivamente, `.firebase/modular-release/learning-review-create-revoke-off/input.json`, `d2-diagnostics-update/input.json` y `hosting-a2cf5d1f3402-57d82bde-0458-4275-ae18-6211f023e2eb/input.json`, siempre bajo `.firebase/modular-release/`.

El creador vigente usa el ZIP `c9a64571acecff5303afc99e79e17411bf3f3fdbcdfb9f6561705b74bb55280d`, base R1.4 `21922d596a664b2916fa459c5c51b165388db5a5b4af897995f3bb85d89b06f9`, patch completo `ecbcdb61ff78e31f1ff70c0130b36bc32722703faf2f7376d68de9883618dca3` y commit `d26d856a479c57d5fd7c92add52e2c708dc398f7`, con `sourceTree:null`. El ZIP anterior `55c5…`, input `098b…` y plan `4b6e…` permanecen históricos e intactos; el controlador ya los rechaza. La creación de este recurso no actualiza chat ni exige que éste permanezca en R1.4. La captura propia confirmó padre `getControlCenterEngineering` listo, destino ausente y cero operaciones activas; se necesita otra lectura fresca antes de cualquier mutación. [Paquete reemitido](e1-d1-review-create-plan.md).

El creador mantiene gate `HUGO_SUPERVISED_RULES_ENABLED=false`, Node 22, 256 MiB y 30 s. Propone invocación pública sólo para el nuevo servicio, necesaria para el transporte callable; la autorización lógica exige Firebase Auth, superadmin activo y root validado por el servidor. No copia permisos de reportes. Los nuevos proofs `70d1adf6…` y `336c86ba…` vinculan la evidencia del ZIP c9 por SHA, sin declarar ejecuciones nuevas. La corrección de reanudación y el bloqueo exclusivo se conservan; el controlador y sus helpers están fijados en el plan.

La corrección mínima exceptúa únicamente REVOKE del gate; mantiene autorización transaccional, root, schema, versión y ledger idempotente. El ZIP c9 tiene startup/typecheck, 20 pruebas de emulador —incluidas siete de reglas—, 61 regresiones y 13 de lenguaje natural PASS; conserva los límites heredados indicados en su dossier. Las 802 entradas de runtime se cotejaron otra vez al preparar review. Las suites del creador y compatibilidad E pasan 52/52. El creador E no se modificó.

Diagnostics usa su ZIP propio c50 como base y publica únicamente el candidato `d148d084149f6be8e76ce297d4639c22583ead14e5eee64f6386b3969d353ce8`. Conserva configuración, IAM y gates; no crea ni expone el endpoint review. Por ello no necesita incorporar el método REVOKE nuevo para mantener válido este paquete de lectura. Sus 341 exports se preservan, startup y siete pruebas específicas pasan. La regresión comparativa sigue siendo **25/26 en base y candidato**, con el mismo fallo previo de autorización de entrenamiento almacenada tras revocación. Los wrappers no son pruebas nuevas ni convierten ese resultado en PASS universal. [Identidad y control](e1-d2-diagnostics-updater.md).

La UI exacta usa el ZIP `58a69d097f032d27ba653371bd1fd7a447ef5eb3a4e3ab5781bea488bda77d38`, fuente `a2cf5d1f3402079b37b2b7e006fb6c91501ff505`. Conserva R1.3, R2 en backend, E y admin/MAT publicados. Su runtime aislado pasa con un fixture QA expresamente anotado; no se simuló una sesión productiva. El panel está en la ruta existente `/hugo`, dentro del detalle técnico. [Pruebas y base UI](e1-d2-human-review.md).

## 2. Consumidor de chat, fuera de estos tres inputs

R1.5 ya está publicada: revisión `sendagent007message-00022-nev`, ZIP `45e8233d67051d3b61ec9b787474fcdd7dd020f3b391b421d25dfcf731fa9474`; esta entrega D no la modificó. El input de chat R1.4 `09299f42…` no debe usarse encima de R1.5. La composición D1 sobre R1.5 tiene candidato local `763134cfafb9854ef2f1b24c25ada58b59d0d95e848c5070f3ad27d045abfc62`, sin incluirse en esta autorización ni publicación. Necesitará su propia baseline vigente y autorización. Crear review no actualiza chat. [Composición independiente](e1-d1-after-r15-package.md).

## 3. Uso parcial y activación separada

El archivo vigente de review permite revocación autorizada con gate OFF, pero sigue bloqueando APPROVE y aplicación. Esa revocación durable es una capacidad útil de esta entrega, separada del aprendizaje activo: exige sesión Firebase, superadmin activo, root validado y regla canónica del mismo ámbito. La UI conserva confirmación explícita, lectura posterior de estado y errores controlados; no debe anunciar éxito ante rechazo. Diagnostics y UI son runtimes separados que no ejecutan ese método administrativo; sus paquetes no necesitan cambiar por este fix. Sus flags no prueban activación global.

La autorización de esta instalación es independiente de la del aprendizaje. Habilitar APPROVE o aplicación requerirá un cambio de configuración acotado, identidades exactas, autorización explícita, preflight y reversión propios. No se activará automáticamente al instalar código, ni se crearán experiencias/reglas reales para aparentar funcionalidad. La comprobación productiva autenticada de consulta y del flujo humano sigue pendiente; las pruebas locales no la sustituyen. Una revocación real requiere una acción deliberada y confirmada del usuario autorizado sobre una regla concreta; ninguna se ejecutará como smoke test ni por instalar este paquete.

## Orden aplicado y reversión de esta entrega parcial

Se revalidaron los tres inputs, pruebas y baselines; se creó review con gate OFF, se actualizó diagnostics y después se publicó la UI compatible. La actualización de chat y la activación siguen siendo pasos separados. Los ejecutores usaron locks compartidos, sin mutadores paralelos ni repetición de una mutación incierta.

Rollback de review: retirar únicamente la invocación pública añadida al nuevo servicio, conservando endpoint, experiencias, reglas y ledger. Rollback de diagnostics: restaurar el ZIP `c50f0d7a95bb24caf156022ae1145503d34f2110f9c39df71921ee52a190db1f` y labels propios sólo si el estado coincide con el journal. Rollback de UI: restaurar juntos Hosting/SSR a admin/MAT `a340678f44840641` / `ssrpay0system-00604-hov`, ZIP `f0e47ff8aae70da0b50836f23367a5c49ab641baf12c89af3a90edbb569ebf0f`, sin sobrescribir publicaciones posteriores. Ningún rollback elimina datos ni modifica reglas Firestore.

Las referencias anteriores describen paquetes y límites; no son una autorización de ejecución. La capacidad D global permanece incompleta hasta verificar consumidor, activación y flujo humano de extremo a extremo.

## Autorización recibida

El usuario autorizó los tres inputs exactos de la tabla, la creación de review y su invocación pública callable acotada, manteniendo gates OFF y sin actualizar chat, además de la reversión propia si fallaba la verificación. Se ejecutaron sólo esos pasos. Esta autorización no incluye activación de aprendizaje ni revocaciones reales de prueba.

## Resultado de publicación y pruebas posteriores

| Superficie | Identidad publicada | Verificación |
| --- | --- | --- |
| Review | `reviewagent007learningrule-00001-sil`, ZIP `c9a64571…` | Recurso/Run/IAM/source coincidentes; gate literal `false` en Function y contenedor; anónimo vacío HTTP401 / UNAUTHENTICATED |
| Diagnostics | `listagent007learningdiagnostics-00003-god`, ZIP `d148d084…` | Configuración/Run/IAM preservados; gate ausente/OFF; anónimo vacío HTTP401 / UNAUTHENTICATED |
| Hosting/SSR | Hosting `4d9ffe161d463f87`, SSR `ssrpay0system-00606-pep`, ZIP `58a69d09…` | RELEASE_VERIFIED, identidad/configuración/IAM/source comprobados; cinco rutas HTTP200 |

El primer proceso de creación recibió HTTP401 al consultar una operación ya aceptada. Conservó el lock y el identificador; no se repitió CREATE. Una lectura con token fresco confirmó operación terminada sin error y recurso ACTIVE; `--resume` sobre el mismo journal/input/plan completó IAM y postflight, exit 0. Diagnostics y Hosting terminaron exit 0 normalmente. No fue necesaria reversión ni se borraron locks manualmente.

Chromium anónimo a 390 y 1440 px confirmó login visible, sin desbordamiento ni errores JS y redirección de `/pagos` y `/hugo` a `/login`. Se bloquearon métodos distintos de GET/HEAD; no ocurrió ninguno. Es una prueba de acceso anónimo, no de consulta autenticada. No se leyeron experiencias/reglas ni datos financieros reales.

Baseline UI estable: `.firebase/modular-release/ui-d-partial-stable-baseline.json`, SHA256 `fd0f05e41f2e5c4631f35734f6bd8748d1b14eff6fdd888fed0454dd0ac73342`, 171 archivos, 4090726 bytes y cero operaciones activas. Al aparecer los contadores derivados se preservó `latest-own-state-before-derived-counts.json` y se reconciliaron sólo `fileCount`/`versionBytes` del snapshot privado, con igualdad profunda del resto. SHA actual de `latest-own-state.json`: `afc591d8ebc5f9f187f8b3c171ea8ba8da4643170b2a1292966d067020a2ecfc`; no hubo cambios productivos en esa reconciliación. El rollback conserva el mismo preflight de estado propio y no puede sobrescribir una publicación posterior.

Evidencia privada en `output/d-publication-plan/`:

| Archivo | SHA256 |
| --- | --- |
| `review-published-verification.json` | `974fbf61b285680bf3809d92f3182da2a1c556f1316212b569992888629e4e8c` |
| `diagnostics-published-verification.json` | `353cedd6bace7b6955fd85195d709b0757f21535ec73af29f0f77ff588021a7a` |
| `d-ui-stable-verification.json` | `3bbe1afd784579b5dd9063fff5ff6af45c75d4c1bbde6ae9f8071b0933d401b6` |
| `d-ui-browser-proof.json` | `a65294514bb74af7e5a2463692b05d1ddb793ec21b49a38df92e14c30dc0b9b3` |
| `d-ui-rollback-metadata-reconciliation.json` | `7154be07826abc0bf5ca1111620d8e3c115ffffdd977fbe3e33d17f6e1b19551` |

La regresión de diagnostics continúa documentada como **base25/26 y candidato25/26**, sin fallo nuevo; publicar no transforma ese límite en PASS universal. Las pruebas de artefacto y el override QA de UI permanecen vinculados a sus inputs originales.

## Cómo encontrar y comprobar el panel

Con una sesión Firebase de **superadmin activo**, abrir [María](https://pay-0-system.web.app/hugo), cuya cabecera dice **«Control sin ruido»**. Desplegar **«Detalle técnico y evaluación»** y localizar **«Aprendizaje de María»**. Dentro aparece **«Revisión humana de reglas supervisadas»** y el botón **«Consultar revisión supervisada»**. Los resultados se separan en **«Experiencias para revisión»** y **«Reglas guardadas»**.

No se presupone el perfil de la sesión del usuario. Si no es superadmin activo, esa vista puede estar restringida y el backend mantiene sus controles. Falta confirmar mediante una consulta real autorizada que el usuario ve y puede leer ese panel. Para esta comprobación sólo se solicita lectura; no pulsar **«Revocar regla»** ni aprobar una regla como prueba. Toda revocación real requiere la decisión deliberada y confirmada del usuario sobre una regla concreta.
