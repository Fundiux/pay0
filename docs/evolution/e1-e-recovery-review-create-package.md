# E — dos Functions nuevas de revisión administrativa

Estado: artefacto y comportamiento local verificados; ejecución productiva pendiente de autorización. No se ha creado ninguna Function ni modificado IAM.

## Superficie exacta

Crear solamente `listOperationRecoveryReviews` y `acknowledgeOperationRecoveryReview` en `pay-0-system/us-central1`. Ambas son callable Firebase, Node 22 y timeout 30 segundos. La primera lista incidencias `NEEDS_REVIEW` del root vigente con paginación. La segunda registra un acuse idempotente y su auditoría; no reintenta, no modifica el trabajo origen y no declara recuperación exitosa.

La API confirmó que ambas Functions están ausentes. Se reutiliza el archivo fuente desplegado de `getControlCenterEngineering`, con SHA256 `6615bb840530acf6dc31f2f86e988210f5505d2d17a0b4c05850c0c0eb2eb713`. El candidato tiene SHA256 `6624acacb3939d846a528426cb39146d1175bdc6bedf18747426e994138844dd`: añade el módulo `recoveryReviewCallables.js` y dos reexports al final del índice compilado; conserva los otros 1174 archivos por contenido. No modifica el índice del repositorio ni incorpora cambios actuales de HUGO, pagos, frontend o F.

El módulo procede de `a280e72fec4dee7e3c452752ba119a2f7ca8f630`; se comparó TypeScript con ese commit y compilación independiente con el JavaScript incorporado. `sourceTree:null` representa el origen compuesto. `sourceIdentity.patchSha256` identifica conjuntamente el módulo y el índice antes/después.

## Evidencia

El ZIP extraído con sus dependencias originales pasó carga aislada sin red y rechazo de dos peticiones sin autenticación. El mismo módulo pasó Firestore real aislado (`demo-pay0-e1-38944`, puertos 62637–62640), incluyendo:

- Superadmin autorizado; operador, usuario desactivado y sesión ausente rechazados.
- Revocación vigente, raíz ajena, lista vacía y cursor ajeno cerrados.
- 54 trabajos paginados 50+4 sin pérdidas.
- Seis acuses concurrentes producen una revisión y una auditoría.
- Trabajo origen intacto; estado terminal rechazado; cero documentos financieros creados.

El emulador se cerró. No son pruebas de reglas: Admin SDK usa un emulador sin rules. No hubo sesiones ni tráfico de producción.

`qa/scripts/e1-operations-create-plan.test.mjs` pasó 21 pruebas: alcance exacto, recurso preexistente, cambio de parent, fuente y generación fijadas, IAM limitado, resultado de creación incierto sin reintento, reanudación tras pérdida de respuesta IAM, rollback, rechazo de cambios concurrentes, bloqueo de dos ejecutores y ancestro symlink. Las llamadas HTTP son simuladas; estas pruebas no equivalen a un despliegue real.

## Plan y ejecución

Artefactos privados: `.firebase/modular-release/new-recovery-review/{input.json,source.zip,baseline.json,startup-verification.json,behavior-verification.json,create-plan.json}`. El plan contiene configuración candidata completa; variables y referencias de secretos permanecen sólo allí. Reutiliza los campos de runtime permitidos del parent, renombra `FUNCTION_TARGET` si existe y descarta campos de salida como revisión/URI.

IAM propuesto, aún no aplicado: únicamente `roles/run.invoker` para `allUsers` en `listoperationrecoveryreviews` y `acknowledgeoperationrecoveryreview`. Replica la accesibilidad callable observada en el parent; Firebase Auth y las comprobaciones backend siguen siendo obligatorias. No copia roles de propietarios ni permisos a otros recursos. Este nuevo alcance público requiere autorización explícita.

```powershell
node scripts/create-recovery-review-functions.mjs C:/Users/ebarr/Desktop/pay0-system/.firebase/modular-release/new-recovery-review/input.json
node --test qa/scripts/e1-operations-create-plan.test.mjs
```

El primer comando prepara el plan y no toca la red. El ejecutor sólo admite `--execute` con SHA exacto de input, SHA exacto del plan, las dos Functions en `--scope` y `--approve-create-and-public-invocation`. No ejecutarlo sin autorización. Antes de mutar compara el plan completo regenerado, vuelve a comprobar ausencia de destinos y parent/servicio/IAM, y valida ancestros de rutas privadas. Toma `active-executor.lock` incluso al reanudar y conserva `deployment.lock` si el resultado es incierto. Fija la generación del upload y verifica sus bytes. Conserva un journal privado para `--resume`. Una creación con resultado incierto no se reenvía automáticamente. El postflight verifica configuración completa declarada, artefacto y política IAM. No ejecuta operaciones administrativas contra datos reales.

API empleada: [Functions v2 create](https://docs.cloud.google.com/functions/docs/reference/rest/v2/projects.locations.functions/create), [tipos de Function](https://docs.cloud.google.com/functions/docs/reference/rest/v2/projects.locations.functions), [upload firmado](https://docs.cloud.google.com/functions/docs/reference/rest/v2/projects.locations.functions/generateUploadUrl) y [Cloud Run setIamPolicy](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.services/setIamPolicy). El upload firmado no recibe encabezado Authorization; setIamPolicy incluye el etag vigente y sólo acepta política vacía o la política exacta prevista.

## UI, índices y reversión

Los wrappers existentes de `src/services/controlCenter.ts` y `RecoveryReview.tsx` usan exactamente estos nombres y contratos. El Hosting final necesita evaluación independiente frente a la publicación externa reciente; este paquete no publica frontend ni MAT.

La consulta usa root/status más orden por documento; la configuración productiva de índices simples verificada previamente no tiene exclusiones para esos campos. No requiere nuevas rules porque el acceso es Admin SDK autorizado en backend. No modifica reglas ni índices.

Reversión sujeta a autorización separada: `--execute --rollback` exige los mismos hashes/alcance y `--approve-rollback-public-invocation`. Comprueba que Function, servicio e IAM coinciden con el journal verificado antes de retirar únicamente `allUsers` de `roles/run.invoker` en los dos servicios propios. Conserva otros bindings y rechaza cambios concurrentes; puede reanudar una respuesta IAM perdida. No elimina Functions ni datos y no realiza rollback automático ante un resultado incierto. Ocultar la UI requiere una publicación frontend separada. Se conservan todos los trabajos, revisiones y auditoría.
