# E — publicación independiente de configuración de proveedores

Estado: **DEPLOYMENT_PENDING**. Pruebas funcionales, build, runtime SSR y aislamiento aprobados; no autorizado ni publicado.

Este paquete evita que dos administradores sobrescriban el estado del otro proveedor. Sólo actualiza `configurePaymentComplementAutomation` y dos líneas funcionales de interfaz/servicio en Hosting. Se publica independientemente de los cambios de conversación y PDF de María.

## Identidad exacta

| Artefacto | SHA256 |
| --- | --- |
| ZIP de la Function E | `a6ae858d6e66e3cc0f9b681ac31c093cdd642df82c32e7691dea61a7bfbeafa5` |
| Input de la Function E | `23130a645a4c9534765709fe818542f76853efcc99f501784015c0bc346a6709` |
| Build de UI `a3348171739dd3b0b7127be47026e162b9656a36` | `6f55c6e698c1ead3597465ef1c99ce5eb829b1deaa251bfbcaa61634f04697aa` |
| ZIP SSR | `96e6563f3ac62289729910ee014a754ee1155143c342f6b47a3989c4c749180c` |
| Input Hosting/SSR | `bc067f06db8186b56b0ae6c588f1c3e03bccfad5716c3c231e9da8a6149e16d0` |

Input E: `.firebase/modular-release/complement-config-2026-10-19T18-26-26-791Z/overlay/input.json`. Input UI: `.firebase/modular-release/hosting-a3348171739d-ffac775e-9c7f-417e-a7da-398d2f1257c4/input-realpaths.json`, con 160 archivos estáticos y sus hashes. Ambos conservan runtime, dependencias, configuración e IAM. No incluyen R1.2 UI, PDF, MAT, revisión administrativa, gateway, reglas ni nuevas Functions.

## Evidencia y secuencia

El backend y la interfaz real pasaron juntos Firestore Emulator: cambios concurrentes preservan el proveedor ajeno; autorizaciones y confirmación Facturama se mantienen; cuatro eventos de auditoría, cero trabajos financieros. El build pasó. El ZIP SSR pasó cinco rutas HTTP, navegador de login y cinco pruebas de componentes bajo emulador aislado. Se validaron todos los archivos extraídos, cierre de dependencias y rutas reales, con hashes de helpers fijados. Proof final: `runtime-d590e7ac-3b4a-425c-b0d5-5a8f7bb39c5d/proof.json`, bajo el directorio privado del input UI; SHA256 `3c667f27093baf954a38f6227a7ac31a3968fd88e9cfedfa9c5b49a63a9a6070`.

El input `input-realpaths.json` conserva el ZIP y el baseline originales; sólo actualiza el pin del ejecutor tras el refuerzo K. El input anterior y su prueba previa quedan preservados como evidencia, no son el paquete de autorización.

1. Preflight fresco de la Function E; actualizar sólo su fuente.
2. Preflight fresco de Hosting `3beebe572c91f420` y SSR `ssrpay0system-00598-vuq`; publicar el manifiesto y ZIP exactos. Cualquier diferencia detiene el paquete y exige reconciliación.
3. Verificar identidades, rutas y carga del panel. Las pruebas automáticas no activan proveedores en producción.
4. Con sesión autorizada, comprobar presentación de controles. Una modificación productiva de configuración sólo se hace con alcance expresamente autorizado.

Reversión: restaurar la Function al ZIP `9d23ea9fd3e22f4c023a5f126d11a7f4cac240d65367454eeb4ccbe2748f3d41` y Hosting/SSR a `c1738b4`, ZIP `fe97daf3df3f395d3812125fc8d4b0906c55a513cc68c80f2f9a4f05bce74a2f`. Conservar datos y auditoría. No modifica ni revierte el backend R1.2 ya publicado.

El [paquete backend](e1-complement-config-publication-package.md) detalla preservación, exclusión de `.env` ya cubierta por configuración y 17 hallazgos heredados del lock. No se certifican dependencias libres de vulnerabilidades. Estado final tras despliegue: `DEPLOYED_NOT_VERIFIED` hasta la comprobación funcional real.
