# E — publicación independiente de configuración de proveedores

Estado: **DEPLOYED_NOT_VERIFIED**. Publicado con autorización específica: backend `configurepaymentcomplementautomation-00008-des`, SSR `ssrpay0system-00600-hak` y Hosting `9f48281b2df63e67`. Identidad, configuración, IAM y cinco rutas públicas verificados. Falta comprobar el panel con sesión autorizada; no se activaron proveedores ni se emitieron operaciones.

La publicación posterior R1.3 sustituyó la revisión de interfaz por SSR `00602-log` y Hosting `bf259a13a5d229c3`, conservando íntegramente este cambio de proveedores. La verificación autenticada sigue pendiente: el usuario buscó en Solicitudes; se indicó la ruta correcta **Reportes → Centro de control → Complementos de pago · seguimiento actual**, disponible para Superadmin.

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

## Resultado de publicación

El ejecutor se detuvo después de verificar SSR porque su validación de `resourceVersion` no admitía `/` en un token opaco válido de Cloud Run. No hubo deriva de fuentes, configuración, IAM ni Hosting. El adaptador de reanudación `b740d2c` preservó el token exacto y pasó 26 pruebas; el dry-run confirmó el cuerpo sin mutación. La reanudación verificó la propiedad del checkpoint, fijó la revisión y publicó el mismo manifiesto y ZIP aprobados. No cambió el input ni los artefactos; no se necesitó reversión.

La comprobación posterior a las 19:58 UTC del 2026-10-19 obtuvo HTTP 200 en `/login`, `/pagos`, `/solicitudes`, `/administracion/recursos-corporativos` y `/reportes`. Son comprobaciones públicas sin sesión: no certifican la interacción autenticada ni la concurrencia de administradores. La baseline privada posterior y el hash de fuente coinciden con el paquete.

## Compatibilidad del controlador para una eventual reversión

El input E fija el ejecutor SHA256 `068ca6454112cc4c2ee9f887f96c5bf09d4b53b09b34b0a231210435f0550aba`. El cambio posterior `90f438c` modificó esos bytes, por lo que ejecutar hoy el input con el controlador primario falla correctamente por pin distinto. Se preservó el controlador exacto de `b740d2c2cd8e636ebb7c791f4f9e334767ccd4b3` y una copia del primario en `.firebase/modular-release/e-rollback-controller/`, con inventario y receta de restauración temporal **no ejecutada**.

Los seis helpers restantes coinciden byte a byte con los pins del input; input, baseline, ZIP nuevo, ZIP anterior y `latest-own-state.json` conservan sus hashes. El snapshot es `RELEASE_VERIFIED`, Hosting `9f48281b2df63e67` y SSR `00600-hak`. La receta exige aprobación de rollback, freeze coordinado, lock exclusivo, restauración de los bytes originales sólo durante la operación y reposición verificada del primario en `finally`. No cambia inputs ni elimina locks de ejecuciones inciertas. Después de publicar R1.3 u otro paquete, esta reversión E debe rechazar la deriva del snapshot; preservar el controlador no autoriza ni garantiza un rollback independiente sobre una versión posterior.

La reversión E ante fallo ya fue autorizada por el usuario; no se requiere repetir esa misma aprobación. El coordinador reconcilió únicamente `fileCount` y `versionBytes` derivados que Hosting añadió a la misma versión, conservando el snapshot original. Se comprobó igualdad de todos los demás campos, incluidas Function, servicio e IAM. SHA256 actual del snapshot: `bc47e8e5dd725670b1c9bc91b3a3a7e646901afa782c20f24e801e4324db022c`; anterior preservado: `8eb9109e9e568404b5031f20e76d74a57bd76b54931f8f2917e96c7a5a20b9d1`. Esta reconciliación de metadatos no permite revertir otra versión ni omitir el control de deriva.
