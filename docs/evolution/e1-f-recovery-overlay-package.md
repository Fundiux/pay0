# F — paquete acotado de recuperación

Estado de entrega: **DEPLOYED_NOT_VERIFIED**. Autorización específica recibida y ambos artefactos publicados el 2026-10-19. Revisiones activas: `queueoperationrecovery-00007-dov` y `reconcileoperationrecovery-00008-xim`. Fuente, configuración, IAM, trigger y agenda preservados y verificados. Falta observación funcional real; no se fabricaron trabajos ni operaciones financieras para probarlos. Los artefactos privados están en `.firebase/modular-release/recovery-{queue,reconcile}-5b0db917bd70/`.

## Alcance y procedencia

- `operation-recovery-queue-overlay`: únicamente `queueOperationRecovery`.
- `operation-recovery-reconcile-overlay`: únicamente `reconcileOperationRecovery`.
- Parche: `5b0db917bd70e76c160339e506f7c7d4467376b7`; el TypeScript actual coincide con ese commit.
- `sourceTree` es `null`: el artefacto combina el archivo desplegado y un parche; no representa el árbol completo del commit. El constructor fija el SHA del JavaScript revisado y compara el TypeScript con el commit antes de empaquetar.
- Los dos ZIP originales desplegados del 8 de octubre tienen SHA256 `6e600ff51ba1df79097b778664c1081e2271b59dec2c71103d5e74b64aaa0df4`.
- Los dos ZIP candidatos tienen SHA256 `741a0025088645a7b66ab84dc1c3b071536c37d8000e0596b2290b43c6f7953b`.
- Única sustitución: `lib/modules/controlCenter/recovery.js`, de `017747350c0ec61a4e76dd32bd541b6d59426c83e14cd3e518e3c3ee09f5de53` a `13d61680f7ef6d89b8ea57dd15d3b02e1a5cb14a222109c9cd0171df46f5775b`.
- Las otras 839 entradas conservan su contenido y sus registros locales ZIP comprimidos; se preservan manifiesto, lockfile, dependencias, índice y registros de triggers originales. Los cambios de directorio central sólo ajustan offsets.

## Evidencia

`e1-operations-recovery-artifact.test.cjs` ejecutó cada módulo desde su ZIP extraído y sus dependencias originales instaladas con `npm ci --omit=dev`. Firestore real aislado `demo-pay0-e1-47168`, puertos 51710–51713; cerrado correctamente. Para ambos artefactos:

- Seis encolados concurrentes producen un trabajo.
- Un trabajo completado conserva estado e intentos al recibir el mismo encolado.
- El quinto fallo controlado termina en `NEEDS_REVIEW` y el reenviado no reinicia su presupuesto.
- Una solicitud cancelada o eliminada conserva todos sus campos al ejecutar recuperación.
- Raíz ajena en trabajo, actor o solicitud se rechaza o no se encola.

Las fallas de dominio se inyectan como función sintética; no se llama IQ, Facturama, Telegram ni lógica financiera. Son pruebas de persistencia/guardas, no certificación de esas integraciones. Los archivos `behavior-verification.json` vinculan los tres checks PASS al SHA del ZIP. El emulador usa Admin SDK sin rules: esta evidencia no certifica reglas.

El verificador canónico produjo `artifact-verification.json` PASS para ambos inputs, cada uno con su propia instalación y probe. Cargó 305 endpoints, comprobando un registro solicitado e invocando cero Functions. Sólo carga el registro: evento `google.cloud.firestore.document.v1.written`, documento `solicitudes/{documentId}`, retry verdadero; schedule `every 5 minutes`. No simula autorización callable para un trigger. `assertArtifactProof` pasó nuevamente para los dos resultados.

## Preparación reproducible

```powershell
node qa/scripts/e1-operations-recovery-overlay.mjs
python qa/scripts/e1-operations-build-recovery-artifacts.py
node qa/scripts/e1-operations-recovery-baseline.mjs
node qa/scripts/e1-operations-recovery-runtime.cjs
node qa/scripts/e1-operations-emulator.mjs qa/scripts/e1-operations-recovery-artifact.test.cjs
node qa/scripts/verify-scoped-functions-artifact.cjs .firebase/modular-release/recovery-queue-5b0db917bd70/input.json
node qa/scripts/verify-scoped-functions-artifact.cjs .firebase/modular-release/recovery-reconcile-5b0db917bd70/input.json
```

La lectura privada y la captura requieren autorización local para credenciales gcloud, sin imprimir tokens. No ejecutar preparación sobre una publicación en curso: reemplaza artefactos/proofs locales.

## Dependencias y reversión

No cambia Hosting, índices, rules, runtime, IAM ni variables. El baseline contiene metadatos privados de las dos Functions, servicios e IAM. Preflight debe volver a comprobar que producción coincide: una publicación externa invalida el baseline y requiere nueva revisión. No reutilizar el baseline de Hosting previo a la actualización externa del 19 de octubre.

Se publicaron sólo estos dos grupos con aprobación expresa. La reversión autorizada restaura únicamente su código al ZIP fuente original; conserva documentos de trabajos, solicitudes y auditoría. Revisiones anteriores: `queueoperationrecovery-00006-saz` y `reconcileoperationrecovery-00007-zuf`. No fue necesaria reversión.

Un primer preflight del encolador rechazó una permutación del orden de filtros del evento, sin escritura productiva. Se corrigió la comparación para ordenar filtros sin omitir valores, operadores ni duplicados; pasaron 27 pruebas del ejecutor y se reintentó el mismo input aprobado.
