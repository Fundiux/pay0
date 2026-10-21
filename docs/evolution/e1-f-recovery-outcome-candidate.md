# F — Resultado explícito de recuperación

Estado: `DEPLOYMENT_PENDING`. Paquete exacto preparado; falta autorización específica. Sin despliegue ni cambios productivos.

El worker distinguía únicamente excepciones: un retorno temprano por fuente terminal, generación antigua o error ya resuelto terminaba como `COMPLETED` y emitía `OPERACION_RECUPERADA` aunque no hubiera ejecutado el dominio.

`executeRecovery` devuelve un resultado explícito. Los trabajos obsoletos terminan `SUPERSEDED`; una fuente que dejó de estar en error antes de ejecutar termina `RESOLVED_EXTERNALLY`. Ninguno declara recuperación. El evento `OPERACION_RECUPERACION_OMITIDA` tiene entrada en el catálogo. Después de ejecutar el dominio, se conservan las protecciones de generación, terminalidad y error nuevo; una actualización legítima de estado del propio dominio conserva el éxito. El cierre exige tanto la lease propia como estado `RUNNING`, evitando sobrescribir una terminalización concurrente con la misma lease.

No cambia la autorización, los servicios de dominio, los cinco intentos, el backoff, las claves de idempotencia ni los exports públicos.

## Evidencia local

`node qa/scripts/e1-operations-emulator.mjs qa/scripts/e1-operations-recovery-outcomes.test.cjs` terminó con código 0: ocho escenarios sobre Firestore emulado. El módulo recovery editado se transpila aisladamente; sus dependencias compiladas actuales de autorización, auditoría y materialidad son reales. No constituye una prueba del artefacto desplegable ni de reglas de seguridad Firestore.

- Fuente terminal, generación obsoleta y resolución externa: estado explícito, fuente intacta y ningún evento de recuperación exitosa.
- Dominio de materialidad real: proyección persistida, trabajo completado y exactamente un evento `OPERACION_RECUPERADA` tras una segunda pasada.
- Dominio real seguido de actualización de su estado durante la espera: conserva `COMPLETED`, sin falsa resolución externa.
- Terminalización de job con la misma lease y cambio de propietario de lease: no sobrescribe ni emite éxito.
- Quinto fallo: `NEEDS_REVIEW`, cinco intentos y sin próximo reintento.

Proyecto demo aislado y puertos aleatorios; Firestore, hub y logging se cerraron al terminar. Sin escrituras financieras ni acciones externas. Log privado `tmp/f-recovery-outcomes-emulator.log`, SHA256 `dcfd7874db294d3a4cfae5e8948cb49c93fed4f277f103af168528efa9d797f0`.

Build NORMAL Functions (`npm run build:normal`, sin instalación) PASS, código 0; log privado `tmp/f-recovery-outcomes-functions-build.log`. `git diff --check` PASS.

## Paquete exacto

Fuente revisada `16a762a46a3098728a56c956b83d6fceef2f952e`; `sourceTree:null`. Base productiva compartida `741a0025088645a7b66ab84dc1c3b071536c37d8000e0596b2290b43c6f7953b`, capturada de ambos workers con sus generaciones fijadas. La fuente Git `5b0db917bd70e76c160339e506f7c7d4467376b7` reproduce exactamente los dos JS base. El catálogo adaptado incorpora solamente la entrada nueva, sin copiar cambios ajenos del catálogo raíz. El patch completo aplica a esas fuentes base con `core.autocrlf=false` y reproduce ambos hashes adaptados. Primer intento con conversión CRLF preservado; no representó una diferencia semántica ni se usó como prueba de bytes exactos.

ZIP candidato `.firebase/modular-release/recovery-outcome-candidate/recovery-outcome.zip`, SHA256 `ba933570681c33d65bb296d923020aad9a9566e5b9a5a1da397d08a69445a75c`. Cambia únicamente `recovery.js`, `eventCatalog.js` y sus dos mapas actualizados con las fuentes TypeScript adaptadas embebidas: cuatro entradas cambiadas, 836 conservadas, 840 totales, ninguna añadida/eliminada. Conserva orden y registros ZIP locales de las entradas restantes. Manifiestos, lockfile y demás módulos intactos. Receta versionada `qa/scripts/build-recovery-outcome-overlay.mjs`.

Identidad del patch: `1332d75746f927e26b24313c631a4ef35d5f95b60dfe39e88a6717a7fde4db55`. No se atribuye identidad de árbol completo a esta composición.

Inputs privados, bajo `.firebase/modular-release/recovery-outcome-candidate/`:

| Grupo / único destino | Archivo | SHA256 |
| --- | --- | --- |
| `operation-recovery-queue-overlay` / `queueOperationRecovery` | `queue/input.json` | `dca4c7e43da66edcf0b27c1c17d6cd7f35291e539384e6339b2fc578b3e5c819` |
| `operation-recovery-reconcile-overlay` / `reconcileOperationRecovery` | `reconcile/input.json` | `b33de70dee1676121af4a325dd1db79cf719c13d59bb90f25954a29580bd0c67` |

Ambos usan los mismos bytes de ZIP y la baseline privada `recovery-outcome-baseline-1792563016683/baseline.json`, SHA256 `2a4a72693286ccc92a4ca19f5eb51a301cd7e9e92135dc8a769a2d0759d54b69`. Las revisiones capturadas son queue `00007-dov` y reconcile `00008-xim`, ambas `ACTIVE`.

## Evidencia del artefacto

- QA final: nueve escenarios sobre Firestore emulado, código 0, cargando los módulos del ZIP extraído y verificando las 840 entradas antes/después. Añade denegación de fuente de otro root, fuente intacta y ninguna proyección ni éxito. Log privado `tmp/f-recovery-outcomes-exact-scoped-emulator.log`. Las dependencias de esta prueba de comportamiento se reutilizan del runtime privado F anterior sólo tras cotejar ambos manifests/lockfiles; no se presenta esa reutilización como instalación canónica nueva.
- Queue: verificador canónico real con `npm ci --omit=dev`, código 0; 305 endpoints cargados, un registro Firestore `solicitudes/{documentId}`, evento written con retry, cero handlers background invocados. Certificado `queue/artifact-verification.json`, SHA256 `461c14c8ecc8c3b3c52d26eabc90be4b0460e0dd34952eea2c46d0d226bb2f55`.
- Reconcile: probe real separado, red bloqueada y cero invocaciones; conserva `every 5 minutes`. Reutiliza la instalación canónica del ZIP byte-idéntico, verifica sus 840 entradas antes/después y registra explícitamente que no ejecutó otro npm ci. Certificado `reconcile/artifact-verification.json`, SHA256 `3b440c5b592eb7ad6ee98c3f11c2528d00e8e378a76292064fed556fa376e932`.
- Revalidación con helper actual c52: ambos `assertArtifactProof` PASS y nuevo probe queue real, manteniendo inputs y certificados originales intactos. Recibo `helper-c52-revalidation.json`, SHA256 `bc0d7a2aef7de255a9bebb225a9a4a9608bb58e3e87bb3b1443450815758e032`; helper SHA256 `5afb90ed4193e1e2826f62a9936c3df896cf494650960543ddb06297b170a2bf`.
- Preflight sólo lectura `fresh-preflight-1792565018252.json`, SHA256 `12953266afbb7d9fa3dcfafcf5367179c2ff3de77188e60d748757cfed6cf801`, a las `2026-10-21T06:43:38.252Z`: ambos ZIP vivos base exactos, Functions/Run/IAM intactos, `ACTIVE`, cero operaciones activas. No garantiza ausencia de cambios posteriores; el ejecutor debe revalidar inmediatamente antes de publicar.

Todas las pruebas financieras productivas, proveedores y recuperación de jobs productivos quedan sin ejecutar. No se certifica recuperación funcional productiva ni concurrencia universal. No hay índices, reglas, endpoints nuevos ni activaciones de aprendizaje en este paquete.

## Publicación y reversión propuestas

Publicar exclusivamente los dos destinos indicados, de forma serial con los inputs y certificados fijados, después de autorización específica. Se conserva el trigger con retry y la agenda de cinco minutos; patch de fuente exclusivamente, sin cambiar IAM ni configuración de runtime.

Revertir sólo la fuente de cada worker que haya sido actualizado, usando su ZIP previo preservado `741a0025088645a7b66ab84dc1c3b071536c37d8000e0596b2290b43c6f7953b`. No borrar ni restaurar documentos de solicitudes, jobs o auditoría, ni reabrir terminales para simular recuperación. Una publicación parcial requiere verificar primero cuál destino cambió; no repetir un PATCH de resultado incierto. Los estados nuevos de jobs usan valores ya existentes y no requieren migración de datos. Las entradas de auditoría permanecen preservadas.
