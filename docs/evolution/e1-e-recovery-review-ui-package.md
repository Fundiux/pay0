# E — revisión administrativa: delta de UI

Estado: candidato local verificado, sin publicación ni build completo en esta etapa. Requiere autorización y disponibilidad de ambos callables de revisión antes de publicar la interfaz.

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
4. Construir el frontend candidato con su configuración productiva verificada y dependencias originales, preservando los cambios EUI y R1.2 de 80a5; obtener nueva identidad y artefacto. No se ejecutó npm ci ni build grande aquí.
5. Publicar backend antes de esta UI y efectuar la prueba manual autorizada del flujo administrativo. Un acuse sólo registra revisión; no reintenta, no modifica el trabajo de recuperación y no declara éxito financiero.

La UI consulta al montarse; publicarla antes de disponer de ambos endpoints produciría errores. La reversión de UI consiste en volver al candidato base verificado; no eliminar trabajos, revisiones ni auditoría.

## Evidencia local

`qa/scripts/e1-recovery-review-ui.test.cjs` ejecuta el componente y el montaje real en Chromium headless, con servicios sintéticos. El candidato y el árbol integrado obtuvieron 3/3 cada uno: wrappers exactos, paginación/acuse/error recuperable y aislamiento de uid/root con carga/acuse pendientes e inactivación. El componente anterior falló la prueba de cambio de root: conservaba la instancia y no consultaba el nuevo ámbito. Logs: `tmp/e-recovery-review-ui-final.log` y `tmp/e-recovery-review-baseline-context.log` y `tmp/e-recovery-review-root-final.log`.

Estas pruebas no certifican Firebase Auth, rules, índices ni despliegue. No se invocaron proveedores, callables productivos ni acciones financieras.
