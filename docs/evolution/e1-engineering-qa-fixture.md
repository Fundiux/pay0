# Fixture QA de Ingeniería — contexto autenticado

Se actualizó únicamente `qa/scripts/engineering-control-emulator.test.cjs` para proporcionar el contrato actual de `useUserProfile` y cargar `RecoveryReview` real. Los wrappers de revisión usan respuestas sintéticas; el resto de los handlers conservan la prueba existente contra Firestore Emulator.

El test añade casos sin sesión, con rol no autorizado y usuario inactivo: la revisión no se monta ni consulta en esos casos. Conserva las aserciones de autorización, root, seguimiento, importación, asignación, auditoría y reconciliación. Las rutas de los dos componentes se resuelven desde `__dirname`, para funcionar también cuando el launcher usa un directorio temporal.

La primera ejecución con ese ajuste terminó en timeout de 30 segundos durante el segundo click de «Registrar seguimiento», después de pasar el contexto y los negativos. Una única repetición idéntica, sin cambiar timeout ni aserciones, terminó **PASS**, código 0, con el emulador cerrado. No se atribuye una causa definitiva al timeout previo.

Comando: `node qa/scripts/e1-operations-emulator.mjs qa/scripts/engineering-control-emulator.test.cjs`.

Logs privados: `output/admin-mat-ui/root-engineering-fixture-verification.log` (fallo anterior) y `root-engineering-fixture-rerun.log` (PASS). Esta comprobación usa directamente el test actualizado, sin el preload del paquete aislado. No cambia el candidato `a335e195`, su ZIP, input, proof ni helpers. No se realizó despliegue ni acción financiera productiva.
