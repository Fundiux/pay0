# E — revisión administrativa: delta de UI

Estado: candidato combinado admin/MAT con build y runtime SSR PASS, preparado sin publicación. Requiere autorización y creación de ambos callables de revisión antes de publicar la interfaz. El [dossier combinado](e1-admin-mat-publication-package.md) fija los artefactos finales y el override de fixture QA explícito.

## Bases y alcance

Se compararon el árbol integrado, `c1738b405682eaf4fb0fc5a1f51c417e85274a7b` y el candidato R1.2 UI `80a5e373a5829509fc3de16191e2ab1cd9ff789f`. Los archivos de revisión administrativa no están en esas bases publicables: el componente es nuevo; faltan su montaje y dos wrappers. Entre c173 y 80a5, los archivos de ingeniería y el servicio conservan la misma versión. El cambio ajeno en PaymentComplementFollowup permanece intacto.

El snapshot separado `.firebase/modular-release/e-recovery-review-ui/source` parte de 80a5. Su delta tiene exactamente tres archivos:

- `src/components/control-center/RecoveryReview.tsx`: lista, páginas de 50, acuse y errores; descarta respuestas de una instancia desmontada y evita refrescar con otra identidad después de un acuse pendiente.
- `src/components/control-center/EngineeringControl.tsx`: monta la vista existente con identidad vigente; la key cambia al cambiar uid, root, rol o actividad. Durante carga de identidad o pérdida de acceso se desmonta.
- `src/services/controlCenter.ts`: los dos wrappers tipados ya existentes en integración, sin nuevas Functions ni contratos.

El parche de publicación es `qa/patches/e1-recovery-review-ui.patch`, SHA256 `8031c85f87af9867bcbf66141620631065f1500e51b8e79f016a7915be94fd62`. Conserva por contenido los otros 2167 archivos de la base. No incorpora D, comparaciones backend R2, MAT ni cambios en la descarga R1.2. El endurecimiento de las dos componentes también se aplica al árbol integrado; no se modificó el clon R1.2 congelado. La aplicación del parche sobre los archivos base con `git -c core.autocrlf=false apply` reprodujo exactamente los tres archivos del candidato; fijar esa opción evita conversiones de bytes en Windows.

La ruta existente es `/reportes`, pestaña Control Center, sección Ingeniería y seguimiento. La ruta limita esta sección a superadmin; el componente además depende de identidad cargada y activa. Esto no sustituye autorización del servidor.

## Dependencias para un paquete funcional

1. Crear y verificar, con autorización separada, `listOperationRecoveryReviews` y `acknowledgeOperationRecoveryReview`. La preparación del backend está documentada en `e1-e-recovery-review-create-package.md`; este delta no los crea ni publica.
2. Mantener los controles backend: sesión Firebase, superadmin vigente, módulo reportes/view y root propio; paginación root/NEEDS_REVIEW/ID; acuse idempotente y auditoría. No abrir reglas de Firestore: los wrappers llaman al backend.
3. Conservar la configuración e índices requeridos por esa consulta. Las pruebas de UI con dobles no certifican índices productivos; usar la evidencia de preparación backend y comprobación autorizada.
4. El candidato combinado tiene build y runtime SSR verificados sobre la baseline estabilizada de R1.3; conserva EUI y R1.3/PDF. El dossier combinado documenta el fixture QA adaptado y los hashes. Estas pruebas no autorizan la publicación.
5. Publicar backend antes de esta UI y efectuar la prueba manual autorizada del flujo administrativo. Un acuse sólo registra revisión; no reintenta, no modifica el trabajo de recuperación y no declara éxito financiero.

La UI consulta al montarse; publicarla antes de disponer de ambos endpoints produciría errores. La reversión de UI consiste en volver al candidato base verificado; no eliminar trabajos, revisiones ni auditoría.

## Evidencia local

`qa/scripts/e1-recovery-review-ui.test.cjs` ejecuta el componente y el montaje real en Chromium headless, con servicios sintéticos. El candidato y el árbol integrado obtuvieron 3/3 cada uno: wrappers exactos, paginación/acuse/error recuperable y aislamiento de uid/root con carga/acuse pendientes e inactivación. El componente anterior falló la prueba de cambio de root: conservaba la instancia y no consultaba el nuevo ámbito. Logs: `tmp/e-recovery-review-ui-final.log` y `tmp/e-recovery-review-baseline-context.log` y `tmp/e-recovery-review-root-final.log`.

Estas pruebas no certifican Firebase Auth, rules, índices ni despliegue. No se invocaron proveedores, callables productivos ni acciones financieras.

## Candidato combinado congelado y build

El clon independiente `.firebase/modular-release/admin-mat-ui-source`, rama `release/admin-mat-ui-integration`, parte de R1.3 UI `13620b74516843b232747904b606b34d0747f986`. Commit `a335e195e8e70f889be1e60aa0df850e4d278585`, árbol `035110ae1587af8111877b2d6b36892ed16df627`. Se aplicaron los parches versionados de revisión administrativa (tres archivos) y MAT (dos archivos), sin solapamiento: exactamente cinco archivos cambian. El resto del árbol base permanece idéntico, incluidos PDF/R1.3, cambios E de proveedores, manifiestos y locks.

QA del candidato exacto: revisión administrativa **3/3 PASS** y MAT **5/5 PASS**, usando los overrides de fuente de los verificadores existentes. Build aislado mediante `build()` de `scripts/deploy-modular-hosting.mjs`: **PASS**, 457 dependencias fijadas, guard de entorno 7/7, Next 15.5.27, compilación/lint/tipos y 47 páginas. Fuente limpia y huella de configuración verificada antes/después.

Recibo privado: `.firebase/modular-release/hosting-a335e195e8e7-80cd6688-809e-48d4-85be-6dc109aaf0be/build.json`, SHA256 `e6e681076650d628fb9886fd8667b73b2dbbd07ab392723206032cebf27c6d0a`. Build ID `hCQThzHoo0tmK4eygfaNb`; huella de entorno público `876b2564ca82eab5a6039013fa04ce502884511cf3d251c779282ac6650b03d4`. La preparación SSR posterior pasó con proof documentado en el dossier combinado; no se publicó este candidato.

Preflight de los dos endpoints nuevos, exclusivamente de lectura: **PASS**. Input `fe8bc6e77c0cf8e677b1af523e1e8994741dfff8bfaa8bf7b755628941a82b6f`, plan `4966074d4575a6995c4c0bf18050bd31c4faf28312041769c7c092200405dfb4`. Padre `getcontrolcenterengineering-00001-cij` conserva recurso, servicio e IAM exactos; ambos destinos siguen ausentes. Prueba privada `new-recovery-review/readonly-preflight.json`, SHA256 `cf4736db7cb3e19eac1ff4daa0fbccb727c3676b932c98b043a6c3ab43f25392`. Esa observación no reserva estado remoto ni sustituye la revalidación al ejecutar. Ambos endpoints siguen pendientes de autorización; la UI no está funcionalmente completa en producción mientras no existan.
