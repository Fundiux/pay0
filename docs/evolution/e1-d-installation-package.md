# D: paquetes exactos de instalación y etapas pendientes

Estado: **INTEGRATION_PENDING**. Diagnostics, UI y review corregido tienen paquetes preparados localmente. Todavía no se solicita autorización ni se ejecuta ninguno. Una instalación con gates apagados no equivale a revisión humana operativa ni aprendizaje activo. El consumidor D1 de chat debe conservar la base publicada vigente y el mecanismo de activación necesita preparación y autorización separadas.

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

El código D1 de `sendAgent007Message` debe componerse sobre la fuente R1.4 **realmente publicada**, preservando sus reportes y lenguaje. Existe un candidato local D1-after-R1.4 probado, pero no forma parte de esta instalación ni autoriza modificar chat. La captura y comprobación de esa base se harán después de terminar la publicación R1.4; no se empleará el antiguo ZIP D1-after-R2 para reemplazarlo. [Candidato independiente](e1-d1-after-r14-package.md).

## 3. Activación y operación humana, aún no preparadas

El archivo vigente de review permite revocación autorizada con gate OFF, pero sigue bloqueando APPROVE y aplicación. Diagnostics y UI son runtimes separados que no ejecutan ese método administrativo; sus paquetes no necesitan cambiar por este fix. El diagnóstico no prueba que chat/review estén activados: sus flags pertenecen a funciones distintas y los estados desconocidos siguen siendo desconocidos.

Falta revisar un cambio de configuración acotado a las identidades y versiones exactas de cada función que deba habilitarse. La activación necesitará autorización explícita, preflight de código/configuración/IAM, reversión a los valores propios anteriores y pruebas con una identidad humana autorizada. No se activará automáticamente al instalar código, ni se crearán experiencias, reglas o datos reales para aparentar funcionalidad. Por ello no se solicita todavía autorización de una instalación aislada como si completara D.

## Orden y reversión si se aprueba un paquete posterior

Revalidar los tres inputs, sus pruebas y baselines; crear review con gate OFF; actualizar diagnostics; publicar la UI compatible. La actualización de chat y la activación tendrán sus propios pasos aprobados. Los ejecutores usan locks compartidos: nunca corren en paralelo ni se repite una mutación de resultado incierto.

Rollback de review: retirar únicamente la invocación pública añadida al nuevo servicio, conservando endpoint, experiencias, reglas y ledger. Rollback de diagnostics: restaurar el ZIP `c50f0d7a95bb24caf156022ae1145503d34f2110f9c39df71921ee52a190db1f` y labels propios sólo si el estado coincide con el journal. Rollback de UI: restaurar juntos Hosting/SSR a admin/MAT `a340678f44840641` / `ssrpay0system-00604-hov`, ZIP `f0e47ff8aae70da0b50836f23367a5c49ab641baf12c89af3a90edbb569ebf0f`, sin sobrescribir publicaciones posteriores. Ningún rollback elimina datos ni modifica reglas Firestore.

Las referencias anteriores describen paquetes y límites; no son una autorización de ejecución. La capacidad D global permanece incompleta hasta verificar consumidor, activación y flujo humano de extremo a extremo.
