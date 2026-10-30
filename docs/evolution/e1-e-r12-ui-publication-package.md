# E + R1.2 — entrega de interfaz y configuración de proveedores

Estado: **candidato preservado, no autorizado ni publicado**. La nueva solicitud de PDF y corrección conversacional R1.3 se desarrolla por separado. E se publicará mediante `e1-e-provider-ui-publication-package.md` para no esperar a R1.3; después se revalidará la base productiva de esta UI. No ejecutar este input si E ya cambió Hosting.

## Resultado funcional

Publicar la descarga XLSX del reporte real de María y el ajuste independiente que evita que dos administradores sobrescriban la configuración de proveedores. La interfaz preserva las capacidades de la fuente productiva `c1738b4`; añade cinco archivos/cambios R1.2 y dos cambios mínimos E. No incluye revisión administrativa, formularios MAT nuevos, aprendizaje D, gateway ni actualizaciones de dependencias.

El backend de reportes ya está publicado como `sendagent007message-00018-sav`. Esta entrega no lo vuelve a modificar. El componente de descarga sólo muestra un botón cuando recibe datos reales de reporte, conserva importes y filtros del backend y cancela descargas pendientes al cambiar de identidad.

## Identidad exacta

| Parte | Identidad |
| --- | --- |
| Única Function de negocio a actualizar | `configurePaymentComplementAutomation` |
| ZIP de esa Function | `a6ae858d6e66e3cc0f9b681ac31c093cdd642df82c32e7691dea61a7bfbeafa5` |
| Input de esa Function | `23130a645a4c9534765709fe818542f76853efcc99f501784015c0bc346a6709` |
| Fuente UI aislada | `80a5e373a5829509fc3de16191e2ab1cd9ff789f`, sobre `a3348171739dd3b0b7127be47026e162b9656a36` y producción `c1738b405682eaf4fb0fc5a1f51c417e85274a7b` |
| Recibo build UI | `488bf449b9d1b92bb4cce35b689b8e80b3413472258cba3a27a8be04f53c8e73` |
| ZIP SSR | `1e266ed95a9b90a84e0ca03fc6ffa394fdf323ce28e14be068e59d2e61f418ae` |
| Input Hosting/SSR | `27698db26f01c04d4defd721bd0b95d359a258233ff1f1ef5a188f4ed47888b6` |

Input privado de Hosting: `.firebase/modular-release/hosting-80a5e373a582-0e22f231-8ad3-4cee-b81c-6cb61e522abb/input.json`. Incluye el manifiesto y hashes de los 161 archivos estáticos. El paquete UI `a334817` anterior queda sustituido por éste; no se publican ambos.

## Pruebas y dependencias

- Backend E: prueba de transacciones concurrentes en Firestore Emulator, autorización, confirmación Facturama, cuatro eventos de auditoría y cero trabajos financieros. Componente y wrapper reales probados juntos contra el artefacto exacto.
- UI: build y TypeScript PASS; pruebas Chromium sobre ambas superficies de María, archivo XLSX leído con ExcelJS, nueve importes exactos, IDs conservados y cancelación por identidad.
- El build mantiene los manifiestos, locks y opciones de producción. SSR y los cinco controles de navegador/componentes aún deben terminar sobre el ZIP final antes de solicitar autorización.
- El reporte y los proveedores siguen requiriendo permisos backend. No se envían operaciones a IQ, Facturama, Telegram ni WhatsApp como parte de estas pruebas.

## Orden, límites y reversión

1. Revalidar la revisión, fuente, configuración e IAM de la Function E y publicar sólo su ZIP aprobado.
2. Revalidar que Hosting continúa en `3beebe572c91f420` y SSR en `ssrpay0system-00598-vuq`. Si cambió, detener esta publicación y reconciliar; no sobrescribir una entrega concurrente.
3. Publicar el ZIP SSR y el manifiesto Hosting exactos mediante el ejecutor acotado, conservando opciones y permisos. No desplegar el checkout global.
4. Verificar identidad y rutas; con sesión autorizada comprobar el reporte real y su XLSX. Para E, verificar la visualización de proveedores y que una modificación autorizada actúe sólo sobre el proveedor seleccionado; una prueba productiva de modificación requiere alcance explícito.

Ante fallo, restaurar el ZIP E original y el SSR/Hosting `c1738b4` capturados, sin borrar datos ni auditoría. El ZIP SSR anterior tiene SHA256 `fe97daf3df3f395d3812125fc8d4b0906c55a513cc68c80f2f9a4f05bce74a2f`; el ZIP E anterior `9d23ea9fd3e22f4c023a5f126d11a7f4cac240d65367454eeb4ccbe2748f3d41`. La reversión de esta entrega no revierte el backend R1.2 publicado por separado.

Los 17 hallazgos heredados del lock de la Function E están documentados en [el paquete backend E](e1-complement-config-publication-package.md). No se afirman dependencias libres de vulnerabilidades. Ninguna capacidad se declara completada antes de la publicación y comprobación funcional real.
