# Paquete exacto — revisión administrativa y acceso MAT

Estado: **PUBLICADO_VERIFICADO_TÉCNICO**. Publicación autorizada y completada; verificación autenticada de negocio pendiente.

## Alcance y orden

1. Crear únicamente `listOperationRecoveryReviews` y `acknowledgeOperationRecoveryReview` en `pay-0-system/us-central1`. La primera lista incidencias del root autorizado; la segunda registra un acuse idempotente. No reintenta trabajos ni cambia operaciones financieras.
2. Dar **invocación pública `roles/run.invoker` a `allUsers` únicamente en esos dos servicios nuevos**, como requiere el transporte callable Firebase. Esto no sustituye la autorización lógica: ambos endpoints exigen sesión Firebase, superadmin vigente y root permitido. No se amplían roles del proyecto ni permisos de otros servicios.
3. Verificar creación, artefacto, configuración e IAM. Sólo después publicar los 169 archivos Hosting y el ZIP SSR exacto del candidato `a335e195e8e70f889be1e60aa0df850e4d278585`.
4. Verificar técnicamente Hosting/SSR y, con sesión autorizada, comprobar la lista/acuse. El estado funcional permanece pendiente hasta esa comprobación; ninguna prueba local cuenta como una acción productiva.

El candidato parte de R1.3 UI `13620b74516843b232747904b606b34d0747f986`; conserva PDF/XLSX, las correcciones E de proveedores y el resto de esa fuente. El delta son exactamente cinco archivos: dos páginas MAT, `EngineeringControl.tsx`, `RecoveryReview.tsx` y `services/controlCenter.ts`. Rama local `release/admin-mat-ui-integration`, árbol `035110ae1587af8111877b2d6b36892ed16df627`. No se alteró el candidato después del build.

## Identidades para aprobación

Directorio Functions: `.firebase/modular-release/new-recovery-review/`.

| Artefacto | SHA256 |
| --- | --- |
| `source.zip` | `6624acacb3939d846a528426cb39146d1175bdc6bedf18747426e994138844dd` |
| `input.json` | `fe8bc6e77c0cf8e677b1af523e1e8994741dfff8bfaa8bf7b755628941a82b6f` |
| `create-plan.json` | `046bf8f5db10343e1f6be3bb52a85fa4163631495cd5cad9a4f5223f433f0336` |
| `startup-verification.json` | `d7675c44ad7b2f678d23e876b605de13feba18bf69735c5758a5a3d8f730826f` |
| `behavior-verification.json` | `5233536f0e26dd36db56aae16a0e1348972b84d110235e1d80fe8d1b24a3aa2e` |
| `readonly-preflight.json` | `35decb03a7faec125ca0b67b84dcf5a2afbacd61c0448017f6ebeccc24e2211b` |

Fuente aditiva `ADDITIVE_NEW_FUNCTIONS_V1`, `sourceTree:null`: archivo base `6615bb840530acf6dc31f2f86e988210f5505d2d17a0b4c05850c0c0eb2eb713`, commit `a280e72fec4dee7e3c452752ba119a2f7ca8f630`, patch `fc28b3aebecc32796e862576cdaf0b726783e547e63aae82b3f7adb925c2ce11`. Conserva 1174 archivos originales. Detalle de comportamiento y executor acotado: [paquete Functions](e1-e-recovery-review-create-package.md).

Directorio UI: `.firebase/modular-release/hosting-a335e195e8e7-80cd6688-809e-48d4-85be-6dc109aaf0be/`.

| Artefacto | SHA256 |
| --- | --- |
| `build.json` | `e6e681076650d628fb9886fd8667b73b2dbbd07ab392723206032cebf27c6d0a` |
| `input.json` | `a58f04802d5149de49c02526bc2c03f62d250ae2c721813b27fa0c8e81205c6a` |
| `ssr.zip` | `f0e47ff8aae70da0b50836f23367a5c49ab641baf12c89af3a90edbb569ebf0f` |
| `runtime-384e7d32-5902-4e29-a9fd-86dd5742a044/proof-with-qa-override.json` | `4fcd9d3f1f44f0d7776e596859d56e1b5d7419c911529067b75a5a414905d7d7` |
| Baseline `.firebase/modular-release/ui-r13-stable-idle-baseline.json` | `7308e3635b98f2ace78ed98a13ded99ab5154614927f763178ed107744c3d01f` |

Base publicada que se preserva: Hosting `bf259a13a5d229c3`, SSR `ssrpay0system-00602-log`, fuente UI `13620b74516843b232747904b606b34d0747f986`. ZIP previo `.firebase/modular-release/hosting-13620b745168-2e88fdfd-6bcd-4eac-b902-bfbb13ac4efc/ssr.zip`, SHA256 `12fcc18131b58621b2dd4409a56b847970fc30e1a8d6b23c6fe5df82d7e0fe0e`. El input fija executor `c9167c451b575fb3c4e29d5c462f575e3cbd3a976a4469f0dfe904cdd037bf21` y helper `43dd1f8cac2fa4424c05e581ea3f052dd428ede98bab583f1c1097700f98966d`. No se cambió ningún helper para producir estos artefactos.

## Pruebas y adaptación explícita de QA

- Build aislado PASS: Next 15.5.27, 47 páginas, compilación/lint/tipos; guard de configuración pública 7/7. Los manifiestos/locks se conservaron.
- MAT 5/5 y revisión administrativa 3/3 sobre la fuente candidata con fixtures sintéticos.
- Runtime exacto: instalación independiente de 430 paquetes; cierre de dependencias y realpaths PASS. Reutilización posterior verifica otra vez todos los archivos del ZIP y no usa enlaces de dependencias externos en el runtime.
- Cinco rutas HTTP 200: `/login`, `/pagos`, `/solicitudes`, `/administracion/recursos-corporativos`, `/reportes`. Chromium: login a 390 y 1440 px, sin desbordamiento; `/pagos` anónimo redirige a `/login`, sin errores JS.
- Cinco pruebas de componentes PASS: recibos, dossier, Ingeniería, carga global y accesibilidad de modal. Incluyen backend real con Firestore Emulator y datos sintéticos; no certifican reglas Firestore ni sesiones productivas.

La primera ejecución **falló** en `engineering-control-emulator.test.cjs`: su fixture no proveía `useUserProfile` ni cargaba el nuevo `RecoveryReview`. Ese resultado está conservado y no se presenta como PASS. Se adaptó únicamente el harness en memoria mediante un preload limitado al path exacto y hash del test; la fuente `a335`, el ZIP, el input y los componentes permanecieron intactos. No existe parámetro equivalente en ese test antiguo.

La adaptación mantiene sus aserciones backend/UI, carga `RecoveryReview` real con wrappers de revisión stub y contexto sintético superadmin/root, y añade negativos de sesión ausente, rol no autorizado e inactividad: ninguno monta ni consulta las revisiones. Los nuevos endpoints no se invocan contra producción. La instalación de Functions reutilizada sólo para el QA tiene árbol, manifest y lock idénticos a la fuente candidata; esos enlaces no entran al ZIP ni al runtime SSR final.

Huellas del override, bajo `qa-fixture/` del directorio UI:

| Elemento | SHA256 |
| --- | --- |
| Test original del candidato | `35f5d7a297be43cc652cc216a341b75e70d41d5764a5c4e19261111cd5aa0c82` |
| `engineering-control-emulator.adapted.cjs` | `593b8fd70a744c0cc126cd3645b1ce57046f75fb99fa06358721fead5826faa7` |
| `preload.cjs` | `a171d26da0bb9d0c4b6488bc244490562e69f8888075a3e7beccddacf5ac0b02` |
| `fixture.patch` | `ee06769cb098f131d9f04119c3a91852330628d390d28b6a7b4fd7f474468675` |

El proof canónico de la segunda ejecución queda intacto, SHA256 `6c9a93bde88069201d55d673c34e72bb21fbb788bc4319b6f9b0ab11f57acaec`. El proof de aprobación añade la declaración del override y sus hashes, incluida la indicación `originalTestExecutedUnmodified:false`; `assertRuntimeProof` lo acepta. No se presenta como ejecución del test original sin modificaciones.

Preflight de creación actualizado a **2026-10-19 21:06:52 UTC**: los dos destinos siguen ausentes y `getControlCenterEngineering` conserva recurso, servicio e IAM de la revisión `getcontrolcenterengineering-00001-cij`. El primer intento agotó autenticación antes de HTTP; el segundo pasó, sin mutaciones. La baseline UI anterior con una operación activa fue rechazada antes de stage; se conserva evidencia del aborto. El input final usa la captura idle autorizada. Los ejecutores deben revalidar otra vez inmediatamente antes de mutar.

## Límites y reversión

MAT sólo embebe formularios cuando existe sesión Firebase y su UID coincide con el UID canónico de Telegram; en otro caso navega al flujo web protegido. Este paquete **no** crea un puente Telegram→Firebase ni hace disponibles operaciones financieras con sólo Telegram. No activa proveedores, envía dinero, reintenta trabajos ni ejecuta acciones WhatsApp/IQ/Telegram.

Reversión, si se autoriza y el estado coincide con el journal: retirar únicamente `allUsers` de `roles/run.invoker` en los dos nuevos endpoints, conservando Functions, otros bindings, revisiones, trabajos y auditoría. Restaurar Hosting/SSR juntos a la base R1.3 y ZIP previo indicados arriba. No usar la base E anterior ni sobrescribir una publicación posterior. Los controles de identidad/deriva y locks siguen siendo obligatorios; un resultado remoto incierto requiere reconciliación, no repetición ciega.

## Plan de creación endurecido antes de publicación

La revisión independiente detectó que una reanudación confiaba en `uploadedSource` del journal antes de CREATE. Se corrigió el creador E para volver a verificar scope, generación y SHA del blob antes de cualquier creación, y para persistir el inicio de cada mutación CREATE/IAM/rollback. Un timeout conserva evidencia y bloqueo. Las suites de ambos creadores pasan **52/52** (23 E y 29 D1), incluyendo fuente alterada con cero POST y reanudación con flag falso sin repetición.

El nuevo `create-plan.json` fija también los hashes de su controlador y helpers. Su SHA256 es `046bf8f5db10343e1f6be3bb52a85fa4163631495cd5cad9a4f5223f433f0336`; controlador E `3dfd5811e967609903d8ed63e6f34c75e6ae8a5afae20e387c48dbbe1416a77f`. El plan previo `4966074d…` y sus proofs/input se preservan en `new-recovery-review/before-resume-hardening/`. Input `fe8bc6e…`, ZIP backend `6624acac…`, fuente/UI/SSR, runtime y sus pruebas mantienen exactamente sus bytes. Sólo cambia el contrato de ejecución del creador; los artefactos seguían DEPLOYMENT_PENDING en ese paso, antes de la publicación documentada abajo.

## Publicación autorizada y comprobación posterior — 2026-10-19

Se ejecutó el orden aprobado: creación de los dos endpoints primero, Hosting/SSR después. Ambos ejecutores finalizaron exit 0, sin reversión y sin acciones de negocio.

- `listOperationRecoveryReviews`: `listoperationrecoveryreviews-00001-yut`.
- `acknowledgeOperationRecoveryReview`: `acknowledgeoperationrecoveryreview-00001-meq`.
- Ambos conservaron el ZIP `6624acac…`, configuración e IAM esperados, y rechazaron llamadas anónimas vacías con HTTP 401 / UNAUTHENTICATED. No se listaron ni reconocieron incidentes reales.
- Hosting: `sites/pay-0-system/versions/a340678f44840641`; SSR: `ssrpay0system-00604-hov`, ZIP `f0e47ff8…`, fuente `a335e195…`. El ejecutor terminó RELEASE_VERIFIED.
- Cinco GET públicos retornaron 200. Chromium nuevo y anónimo en 390 y 1440 px comprobó controles de login visibles, ausencia de desbordamiento y errores JS, y redirección de /pagos a /login. Se bloquearon métodos distintos de GET/HEAD; no ocurrió ninguno.

El primer harness de navegador falló por exigir arbitrariamente más de 100 caracteres de texto en login. Su log se conservó; la repetición sustituyó ese umbral por visibilidad explícita de usuario, contraseña y botón de entrada y pasó. No se cambió la UI publicada ni se presenta el intento inicial como PASS.

La captura inicial no incluía aún los dos contadores derivados de Hosting. Una captura posterior validó `fileCount=171`, `versionBytes=4086647`, cero operaciones activas y el resto de recurso/servicio/IAM/Hosting idéntico al snapshot propio. Baseline estable: `.firebase/modular-release/ui-admin-mat-stable-baseline.json`, SHA256 `d2d7725cf59c10739dcd12714ce121110ea7d71da9a9938fa31f9420eaa783e8`. La captura original y el snapshot de rollback permanecen intactos; una reversión posterior debe reconciliar esos contadores y cualquier deriva antes de ejecutarse.

Evidencias privadas:

| Evidencia | SHA256 |
| --- | --- |
| `output/admin-mat-ui/create-execution.log` | `e96327fc0317781b52669e348849a9f7ec1fa9f1641a546aa096f1071e568117` |
| `created-functions-verification.json` | `2547a6f5ad2595a4a174d089bd4873efbbbd0500b31200b13a3720f056d8c0c2` |
| `hosting-execution.log` | `13ff1870f3fd05f19a5bc27fbe90e03e03f1b973d4ce4d63d04cb185b87c71d8` |
| `published-browser-proof.json` | `a6979a26942b44df31cc0788512785e7080aa01a617e2f64e33051133b9c67d4` |
| `stable-verification.json` | `cdb475c8250df2d8ebc3ec5763293ed858456b90955d25473e0f1bf2d08c1e87` |

La procedencia reutilizable está en `.firebase/modular-release/ui-admin-mat-published-provenance.json`, SHA256 `c774a664adbfe865a44e4311aa5f4f686c916617aa5616441cfaa68c9c3ccec2`. La fuente candidata se conserva para futuras integraciones, sin reconstruir esta capacidad.

Pendiente: una sesión Firebase real autorizada que confirme lista/reconocimiento administrativo y el acceso MAT según el UID canónico. La entrega está verificada técnicamente; no se declara completada la operación financiera ni un puente de identidad Telegram/Firebase.
