# E — paquete de configuración de complementos

Estado: **DEPLOYED_NOT_VERIFIED**. Publicado con autorización específica en `configurepaymentcomplementautomation-00008-des`; fuente, configuración e IAM verificados. Hosting `9f48281b2df63e67` y SSR `ssrpay0system-00600-hak` también publicados; falta verificar el flujo productivo autenticado. Único endpoint: `configurePaymentComplementAutomation`. Grupo: `complement-config-overlay`.

El backend admite ahora `{provider: "IQ" | "FACTURAMA", enabled: boolean}`: sólo modifica el proveedor indicado y obtiene el otro flag dentro de la transacción. Preserva el contrato anterior de dos flags. La interfaz publicada en el paquete E utiliza el contrato parcial. La evidencia automática cubre la concurrencia en emulador; queda pendiente verificar su uso autenticado en producción.

## Procedencia exacta

Captura de sólo lectura: `.firebase/modular-release/complement-config-2026-10-19T18-26-26-791Z`. Base productiva: `configurepaymentcomplementautomation-00007-mok`, Node22, 60 s, 256Mi. No se modifican opciones runtime, IAM, variables ni secretos.

- Archivo original privado y rollback: `configurePaymentComplementAutomation-previous.zip`, SHA256 `9d23ea9fd3e22f4c023a5f126d11a7f4cac240d65367454eeb4ccbe2748f3d41`.
- Patch revisado: commit `8e9487b1df8fdb092b370133265e7382276909a2`; SHA256 del diff de un módulo `bb547934fe0d1146b3dc20fa8b2b694b33a8d2963e140ad26cc04702a4932c03`.
- Fuente declarada: `PRODUCTION_OVERLAY_V1`, `sourceTree: null`. No se presenta como checkout íntegro del commit.

Se comparó el módulo productivo completo con la transpilación de su TS original: AST canónico idéntico. Su handler de configuración coincide con el padre del patch revisado. Se sustituyó sólo ese handler: 1 de 56 declaraciones superiores cambia; imports y otros handlers conservan su AST. Cambian únicamente `src/modules/paymentApplications/complementAutomation.ts`, su JS y su source map. Otros 1080 archivos conservan bytes exactos, incluidos package y lock.

Se excluye una entrada `.env` del nuevo ZIP sin divulgar su contenido. Comprobación en memoria: su única clave y valor ya están en `serviceConfig.environmentVariables` (cero diferencias); ninguno de los JS/TS originales contiene cargadores dotenv/readFile.env/loadEnv. Startup y comportamiento real del artefacto sin ese archivo pasan. El ZIP original privado conserva el archivo para rollback; no se convierte en un paquete nuevo ni se imprime. Evidencia: `overlay/environment-exclusion-verification.json`.

## Artefacto de aprobación

Todos los archivos siguientes están bajo `overlay/` de la captura privada:

| Archivo | SHA256 |
|---|---|
| `functions.zip` | `a6ae858d6e66e3cc0f9b681ac31c093cdd642df82c32e7691dea61a7bfbeafa5` |
| `input.json` | `23130a645a4c9534765709fe818542f76853efcc99f501784015c0bc346a6709` |
| `artifact-verification.json` | `058974732ab8caea63eab5d3ce9ff02412574171300639f2411255c1435b5d69` |
| `behavior-verification.json` | `c6b5311973b24cb856902a3e45c28dc9837c604aa0304ba54a4dbae2b87b942d` |
| `preservation-verification.json` | `2ab235c60f7f8110efe00aab49fd187118357d902217766f7cf0ffcc5f21fabf` |

El ZIP tiene 1083 archivos. El input conserva el fingerprint del baseline. No hay copia `*-previous.zip` dentro de `overlay/`: el ejecutor podrá guardar su propio rollback tras revalidar producción. El ZIP original permanece en el directorio superior.

## Pruebas

Instalación aislada del lock productivo: `npm ci --ignore-scripts --no-audit --no-fund`, 446 paquetes. Se reutilizó esa instalación para el probe canónico sin repetir npm ci; 786 archivos runtime/package/lock se compararon con el ZIP final antes de cargarlo. El proof declara `reusedInstall: true` y el hash del probe. Resultado: 341 endpoints cargados y rechazo anónimo del único callable seleccionado. Red bloqueada durante startup.

`qa/scripts/e1-complement-config-artifact.test.cjs` ejecuta el JS del ZIP contra Firestore desechable con proyecto `demo-pay0-complement-*` en loopback, sin mocks de autorización o transacción. PASS:

- Contrato legacy equivalente en base y overlay; base rechaza contrato nuevo.
- Habilitaciones concurrentes IQ y Facturama conservan ambos flags.
- Pausar IQ no pisa Facturama; `iqLookupEnabled` y `activatedAt` permanecen intactos.
- Rechazo anónimo, usuario inactivo y operador; cuatro formatos inválidos rechazados.
- Activación Facturama exige confirmación; root enviado por cliente no redirige la operación fuera del root autorizado.

Prueba integrada adicional PASS mediante `e1-operations-admin-activation.test.cjs`: `PAY0_CONFIG_ARTIFACT_DIR` apunta al JS exacto del backend y `PAY0_CONFIG_UI_ROOT` a la copia Hosting `ui-preserved-controls-source` (commit a334817, base c1738b4). Chromium ejecuta el componente y wrapper reales, con únicamente el transporte puenteado al callable en Firestore desechable. La UI inicialmente desactualizada no sobrescribe el cambio Facturama de otro administrador al activar IQ. Resultado: 4 eventos de auditoría y cero jobs financieros. Evidencia `overlay/ui-behavior-verification.json`; esto no reemplaza el build/arranque SSR del paquete Hosting del coordinador.

Audit del lock heredado: 17 resultados (1 crítico, 8 altos, 8 moderados), no 17 vulnerabilidades nuevas introducidas por el patch. Incluye `proxy-addr` previo a 2.0.8 ([IP spoofing](https://github.com/advisories/GHSA-jqcg-44mw-7w3h)), UUID previo a 11.1.1 ([buffer bounds](https://github.com/advisories/GHSA-w5hq-g745-h8pq)), avisos de busboy, brace-expansion y braces y sus cadenas transitivas. El resultado íntegro queda privado en `overlay/runtime/audit-scoped.json`. No se actualizan dependencias silenciosamente dentro del overlay; requiere un paquete de homologación separado. No se acredita explotación por este endpoint ni se afirma audit limpio.

No se ejecutó ningún proveedor IQ/Facturama, emisión real, operación financiera ni callable productivo. La publicación funcional debe coordinar este backend con el paquete UI mínimo de dos archivos del mismo commit, preparado sobre fuente productiva c1738b4 por el coordinador. No se debe aprobar el backend aislado como resolución completa. El ejecutor debe abortar si cambió la revisión productiva. El rollback utiliza la fuente capturada original mediante el flujo existente, previa revalidación del estado actual.
