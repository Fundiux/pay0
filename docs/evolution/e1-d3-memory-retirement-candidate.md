# D3 — UI de confirmación idempotente de retiro personal

Estado: `DEPLOYED_NOT_VERIFIED`. El usuario autorizó los paquetes exactos backend/UI y sus reversiones; publicación técnica verificada, retiro real del usuario pendiente. El backend se documenta por separado en [su paquete D3](e1-d3-memory-retirement-backend-package.md).

## Publicación y verificación independiente

Raíz publicó primero el backend, sesión `39640`, código 0: reviewer `reviewagent007memorycandidate-00004-sef`, ZIP `1eb8e6e0232b0d74aa904795ce4a7be9f770e3fbacf73a30d4c2f62bfc0d489f`, postverificación independiente PASS (`ab414...`, recibo completo en el dossier backend). Después publicó esta UI, sesión `84344`, código 0, `RELEASE_VERIFIED`: Hosting `68022c0026432bc8`, SSR `ssrpay0system-00622-xev`, ZIP `2522054e91aa8121085c983537358e789830a7dbc5b20e3eba8658edcaa2ff81`.

Postverificación independiente estricta PASS: proof SHA256 `ad6118ac61c2c2442fb73112ce4a881a62f0e4eda9d995c3a198cc6e422898b9`; baseline publicada `a30ab4412181f04e67b5ac36d4c6cec8203d81e49d77390bdd103475a5af832c`. Ambos archivos están en `independent-post-publication-165ef0fe-d094-4e67-a96b-d438fed29b74/`, bajo el directorio del paquete UI indicado más abajo. Se cotejaron fuente, configuración/Run/IAM, las 170 entradas Hosting más dos reservas Firebase, cinco rutas y cero operaciones activas. No se retiró ningún recuerdo productivo para esta verificación.

Raíz aprobó conciliar sólo dos contadores derivados en el estado propio local: `snapshot.hosting.releases[0].version.fileCount` y `versionBytes`. Original `aa53f25e6b176c1f9e8bf7cbdc7533eec8dadc32ad8db8bf5515a14a62c28668`, conciliado `ef5faa21c60bb4c9b920bcef750a21ee6093ab306ca272559596db396158e49f`; todos los demás campos conservaron igualdad profunda. Recibo local `bd51e1b3ccaad82b49c28401aeeb9912da2b24a33712b9ceb6fec5d0acd786df`, original preservado en `root-local-counter-reconciliation-7b93f5e7-8187-4040-abd1-8340388cfa6f/`. Proof independiente de assets raíz `952023c6f65db60243009927b72077144375420dd6e756f246ae1b9aa685c055`. No cambió la nube ni el verificador estricto original para conciliar estos contadores.

La ventana de publicación restauró literalmente el helper c52 `5afb90ed4193e1e2826f62a9936c3df896cf494650960543ddb06297b170a2bf`; raíz confirmó su hash de forma independiente (`g3:564`) y árbol limpio. Pins, fuente y contrato de ACK permanecen como se certificaron. No se utilizó rollback ni se borraron recuerdos, bindings o mensajes.

La revisión existente retiraba correctamente el recuerdo, pero un reintento después de perder el primer ACK devolvía solamente `changed:false`. La UI lo interpretaba como fallo. No se añade otro endpoint ni mecanismo de memoria.

Para correcciones personales, `reviewMemoryCandidate` añade `retirement:{memoryId,status:"REJECTED",scope:"CONVERSATION_ONLY"|"USER_TOPIC"}` después de revalidar dentro de la transacción actor, root, autor, propietario y referencias. Se devuelve tanto tras retirar como al reencontrar el mismo registro ya `REJECTED`. Otros estados y la revisión genérica conservan su contrato; `changed:false` solo no acredita retiro. El reintento no vuelve a escribir ni genera otra mutación.

La UI comprueba ID, estado y alcance exactos. Un ACK ausente, de otro recuerdo o de otro alcance mantiene la indicación visible y muestra error controlado. Conserva el aislamiento de UID/root/rol y descarta respuestas asíncronas de contextos anteriores. Para opciones o notas personales exige `USER_TOPIC`.

## Comprobaciones

- Firestore emulado aislado: 16 comprobaciones, código 0. Productor canónico compilado actual y store editado transpilado aisladamente, sin simular persistencia. Ambas duraciones, otro actor del mismo root, otro root, actor revocado, ACK perdido/reintento sin segunda escritura y estado `SUPERSEDED` sin ACK. No equivale a probar un ZIP desplegable.
- Chromium: 18 comprobaciones, código 0; componente y wrapper reales con transporte sintético. Incluye respuesta antigua sin ACK, ID/alcance incorrectos, retiro idempotente válido y limpieza de contexto.
- Build NORMAL Functions, código 0, sin instalación: `tmp/d3-memory-retirement-functions-build.log`.
- Verificador de autorización `PAY0-USERS-PERMISSIONS@1` PASS; política frontend/Functions/Firestore sincronizada. No se modificó la política.
- Build canónico frontend privado, código 0 y 47 rutas: fuente `2eaab272dce343dbcf5938f699dd7999c2086d0a`, hija de MAT `63c70651bf1c2fbdeb0ce891599d7be1013cc70e`. Se verificaron ambos archivos UI completos contra la base antes de aplicar únicamente los hunks D3. Build SHA256 `972c7b84cc2b5d59f2de15f536da5913c079a41ce827dcf73ecd1bf916808b86`, pointer privado `.firebase/modular-release/d3-memory-retirement-ui-build-pointer.json`. Chromium 18 PASS también sobre ese clon con transporte sintético.

Logs privados: `tmp/d3-memory-retirement-emulator.log`, `tmp/d3-memory-retirement-browser.log`. Sin proveedores, datos reales, reglas nuevas ni escrituras financieras. No interviene en comprobantes ni en el handler de chat.

## UI publicable exacta

Fuente privada `.firebase/modular-release/d3-memory-retirement-ui-source`, commit `2eaab272dce343dbcf5938f699dd7999c2086d0a`, hija de MAT `63c70651bf1c2fbdeb0ce891599d7be1013cc70e`. Sólo cambian `src/components/hugo/HugoResponseCorrection.tsx` y los tipos/wrapper de revisión en `src/services/agent007.ts`. Se verificaron ambos archivos completos contra la base antes de portar los hunks; conserva MAT y las demás capacidades publicadas, sin copiar cambios ajenos del service. Fuente raíz D3 `65ca03305e6862aa1f420a26bf95c3e1eb16155a`; grupo backend estrecho registrado por separado en `c52c6edf16903bed8efeb10a62a942f1f10fe183`.

Raíz preservó también el ref local `release/personal-memory-retirement-20261021` en ese commit UI, sin merge ni push.

| Identidad UI | SHA256 |
| --- | --- |
| Build canónico privado | `972c7b84cc2b5d59f2de15f536da5913c079a41ce827dcf73ecd1bf916808b86` |
| Input Hosting/SSR | `ff71291a01064ecb51c98773d68daa1874bd99ba1ea9523866bfb7ab1950d7e9` |
| ZIP SSR candidato | `2522054e91aa8121085c983537358e789830a7dbc5b20e3eba8658edcaa2ff81` |
| Proof canónico bruto | `4c87ad87342351737d542d2357d41825021c929fca6dfd396cdb4e6b16aae0de` |
| Proof con declaraciones de QA | `b3a556bb158ec2be080a5b374311e0ce9ba90ec786bf3039d1592370ee01f14d` |
| Baseline MAT publicada | `2771146f074b951cfd1f54717b1cb9b3de87e378e0291ae6d3663e60a9e07f0e` |
| ZIP previo MAT para reversión | `f71e37d5128611c68e260de448c02952b095f79859a2ea710da64a576295c539` |
| Provenance padre adaptada, original preservado | `2dd27aa79619649b5fe25b3a235706b63eae45e22196ca1b708704484797494f` |

Input y build: `.firebase/modular-release/hosting-2eaab272dce3-e22db84f-2f9d-42c3-87b9-314fcb61b4e0/`. Proof final: `runtime-47b63a3a-1061-4fa4-a55c-77e2ef358968/proof-with-qa-overrides.json` bajo ese directorio. Los pointers privados `d3-memory-retirement-ui-prepared-pointer.json` y `d3-memory-retirement-ui-runtime-pointer.json` contienen las rutas completas y hashes.

## Runtime y adaptaciones declaradas

Cuatro tareas locales terminaron con código 0: prepare original, extracción/dependencias, verificador SSR bajo Firestore demo y consolidación del proof. El SSR procede de este ZIP extraído de nuevo; se copiaron sólo `node_modules` del runtime privado MAT después de igualdad package/lock, realpaths y cierre de dependencias. El verificador volvió a comprobar las 486 entradas fuente y el confinamiento. No se atribuye a esta reutilización otra instalación npm ci; el build UI sí ejecutó su instalación canónica propia.

HTTP local PASS en cinco rutas; Chromium PASS para `/login` a 390/1440 px y redirección anónima de `/pagos`. Cierre de dependencias PASS y realpaths PASS. Pasaron las cinco regresiones de componentes del verificador. Dos usan las mismas adaptaciones QA heredadas y declaradas de MAT, sin cambiar el código del producto ni el ZIP:

| Fixture heredada | SHA original | SHA adaptado |
| --- | --- | --- |
| Engineering, sesión/rol/inactividad y componente real | `35f5d7a297be43cc652cc216a341b75e70d41d5764a5c4e19261111cd5aa0c82` | `593b8fd70a744c0cc126cd3645b1ce57046f75fb99fa06358721fead5826faa7` |
| Evidencia, layout plegado existente | `e388d065c08475e632a9f865761f315af98ae96f89ef2697a87b22b51f297e22` | `2fcc15877b7314ad801ec07737d1327789b81629527c91518eb2c865d28b874e` |

No se presentan esos dos tests originales como ejecutados literalmente. Su preload limita las sustituciones a esos paths y hashes; manifest, preload y logs se vinculan en el proof. Son regresiones heredadas, sin análisis nuevo de comprobantes ni cambios en ese frente pausado.

La QA adicional D3 de 18 comprobaciones usó el componente y wrapper reales de este clon con transporte sintético; SHA del test actualizado `2461c3e93074cef50d3db6da3fcafdc6dd8df612b6eb61005259d09c316b43b7`, log `e81609ce87acbabd8a0ad2fdb53dfa37ad41108eed12970029e194dbca3de7fe`. No acepta éxito por `changed:true` antiguo sin ACK, ni por `changed:false` sin ACK o ID/scope ajenos. Sí acepta el reintento canónico `REJECTED` sin segunda escritura. No acredita una sesión real del usuario ni un retiro productivo.

## Ventana de controladores y frescura

El build fija guard `deploy-scoped-functions.mjs` `80be9ce1b5a74bdf836229358884687d95dd9f7fc2b0b596ff9b45de85d81db3`. El helper actual c52 es `5afb90ed4193e1e2826f62a9936c3df896cf494650960543ddb06297b170a2bf`. No se alteraron pins, build, input ni proofs para ocultar esa diferencia.

La primera ventana local falló antes de staging por no heredar el archivo de entorno del proceso de build; no generó input. Se preservó el intento y se restauró c52. El fix privado carga el mismo archivo público de build y compara su hash `3cc249c2ea9025f7d6177f5cead04b218ad2df8617be6ae1d7f63274f1f4c9c4` y fingerprint exacto del recibo, sin imprimir valores. La segunda ventana, con exclusión coordinada y controlador real 80be, completó las cuatro tareas; restauró c52 y retiró su marcador. No hubo mutaciones cloud en esas tareas. Una ejecución Hosting futura requiere la misma ventana controlada original, sin cambios de pins ni jobs simultáneos de helpers.

Preflight independiente anterior a la publicación, `2026-10-21T07:31:31.320Z`, SHA256 `96dad944c96cbd3dc642614d64dbd8d603eeaa5df461682b6b8c3ae0127e3367`: SSR `00620-zuz`, Hosting `bd2ed1c61e22c573`, fuente MAT f71 exacta, Function/Run/IAM/Hosting idénticos a baseline277 y cero operaciones activas. Sólo metadata/fuente, sin datos de negocio. No invocó `check`, `livePreflight` ni `prepare` bajo c52. La ejecución posterior utilizó la ventana adecuada; cualquier nueva publicación debe revalidar su propia frescura.

## Orden y reversión

Se respetó el orden autorizado: primero backend D3 compatible, input `afdf8b68870039f17ddb2b189c3b4c6a612b90b966bb4ddbb97c2acec299479f`, único destino `reviewAgent007MemoryCandidate`; después esta UI `ff71291a...`. El backend antiguo puede retirar el recuerdo pero carece de este ACK, por lo que esta UI requiere mantener el reviewer compatible. La autorización correspondió únicamente a estos bytes y las reversiones preservadas.

Si se revierte la familia, volver primero la UI al ZIP MAT f71 y su Hosting/SSR preservados; luego, sólo si se decide necesario, revertir review a su baseline protegida f078. Conservar los lectores y el endpoint protegido de revisión: no volver al lector antiguo c50 ni borrar recuerdos, bindings o mensajes. El rollback no revierte datos personales ni activa reglas de aprendizaje. La verificación funcional real del retiro continúa pendiente; las pruebas sintéticas y la publicación técnica no la sustituyen.
