# E/G — Acceso directo a proveedores y complementos

Estado: **COMPLETED**, limitado al acceso al panel y la visibilidad de ambos controles. Hosting/SSR publicados con autorización específica, verificación técnica independiente PASS y confirmación autenticada del usuario: «El enlace abre el panel y veo ambos controles». No certifica ejecución ni automatización de proveedores. No depende de los nuevos flujos de corrección por texto, voz o documentos.

## Resultado y alcance

En **Solicitudes**, un superadmin tendrá el enlace **Proveedores y complementos de pago**. Abre `/reportes#complementos-pago`, selecciona **Centro de control** y enfoca **Complementos de pago · seguimiento actual**, donde ya existen los controles **IQ · nuevas solicitudes** y **Facturama**. No duplica el panel ni modifica switches, proveedores, autorización o funciones de negocio.

Fuente aislada: `.firebase/modular-release/provider-controls-navigation-ui-source`, rama local `release/provider-controls-navigation`, commit `b14c4900e149fd43ae74d802db4c8751cbddb6f5`, árbol `8525117030b95aef5d5dccf36596d96c850b92d8`. Base publicada `a2cf5d1f3402079b37b2b7e006fb6c91501ff505`. Cambian exactamente `src/app/solicitudes/page.tsx` y `src/app/reportes/page.tsx`; se preservan todas las demás fuentes, paquetes, lockfiles, configuración, admin/MAT, diagnóstico D y exportaciones de reportes. Patch privado `output/provider-controls-navigation/navigation-only.patch`, SHA-256 `d1b6bf81084df9142e091dde4563cda9fb96b6505979bd84255cf892a4ef1d03`. Integración en la rama acumulativa: `48b50e46a7e99c827139d96e30307011caba28d5`.

## Paquete exacto

Directorio: `.firebase/modular-release/hosting-b14c4900e149-d706de75-5881-4192-9240-f4be44cb735e/`.

| Archivo | SHA-256 |
| --- | --- |
| `input.json` | `fc45defd22ac9a5d5bb1681308a482ce43f0dae47b73efa18eaf0ab3a9eee7c8` |
| `ssr.zip` | `b273a696fddf43db5acbab3b185c346a8d262cb94ba8bc5ff09fc0c610bcf1cd` |
| `build.json` | `141cce8baa1fa5682fb55ecf4c69fe600317edaf290888626a45dd4f15b4387b` |
| `runtime-1847d90d-5197-4c44-8bfa-4d3395d83e80/proof-with-qa-override.json` | `88250e717fbb7f663adb31746f7a7a70f49468b5b9ae3318943b0ce719fa15bf` |
| prueba runtime canónica `proof.json` | `8d29bcce09cd49eaeff3ded4eb686dc54fcd7604140671f150069b692c2cad5f` |

Hosting preparado: 169 archivos. Baseline GET fresca `.firebase/modular-release/ui-provider-controls-navigation-baseline.json`, SHA-256 `4df63a6f1fe6f3d1f9fd0d96544dfd1b819017409030ebcdcbb96f3e14357920`, coincide con recurso/Run/IAM/Hosting publicados y tiene cero operaciones activas. La adaptación del documento de procedencia al esquema de preparación identifica y fija por hash su documento publicado original; no afirma una nueva publicación.

## Verificación y límites

Build canónico aislado PASS con Node y lockfile preservados, 47 rutas; QA de navegación 5/5 y política de autorización PASS tanto en raíz como en candidato. Un primer build pasó, pero su preparación rechazó correctamente un cambio posterior del controlador compartido. Ese recibo permanece intacto; se repitió el build canónico tras congelar el controlador `88047be`, sin parchear recibos ni pins.

Runtime recién extraído de este ZIP: **484 archivos** contrastados, dependencias copiadas físicamente sólo después de igualdad de `package.json` y lockfile, realpaths y cierre transitivo PASS. No contiene junctions del árbol QA. HTTP 200 en `/login`, `/pagos`, `/solicitudes`, `/administracion/recursos-corporativos` y `/reportes`; Chromium PASS en login 390/1440 y `/pagos` anónimo → `/login`. Cinco comprobaciones de componentes PASS.

La prueba histórica `engineering-control-emulator.test.cjs` usa un override QA explícito y acotado a su path y hash originales. Conserva el componente `RecoveryReview` real y las aserciones; añade contexto sintético autenticado y negativos sin sesión, rol incorrecto e inactivo. El proof final identifica archivos, hashes, patch y logs y declara `originalTestExecutedUnmodified:false`. No cambió el backend, el SSR ni el candidato. No se presenta como ejecución intacta del test histórico.

La navegación también pasó en Chromium con JSX/efecto reales y `PaymentComplementFollowup` real, usando perfil y transporte sintéticos: visibilidad por rol, foco al llegar el perfil, controles de proveedor visibles y cambio de pestaña/hash sin bucle. No monta páginas completas ni acredita una sesión autenticada productiva. La prueba runtime usa emulador demo; no certifica reglas Firestore. No se hicieron acciones financieras ni cambios reales de proveedor.

Preflight remoto final de sólo lectura PASS después del runtime; recurso SSR, Run/IAM, Hosting y archivo fuente productivo conservan la baseline. En la ejecución será obligatorio repetir el preflight y adquirir los locks compartidos; una deriva bloqueará el paquete.

## Autorización y reversión

La autorización recibida se limita a publicar este Hosting/SSR y revertir exactamente esa entrega si falla. No incluye Functions de texto/documentos, gateway, gates, IAM nuevo ni acciones de negocio. La receta privada está en `.firebase/modular-release/provider-controls-navigation-execution-recipe.md`.

Reversión: Hosting `4d9ffe161d463f87`, SSR `ssrpay0system-00606-pep`, ZIP anterior `58a69d097f032d27ba653371bd1fd7a447ef5eb3a4e3ab5781bea488bda77d38`. Sólo procede contra el estado propio exacto de esta publicación; conserva datos y los demás servicios. Ante resultado incierto, reconciliar la operación y el journal, sin replay ni borrar locks manualmente. El usuario ya comprobó el enlace y la presencia de ambos controles; no se pulsaron controles de proveedor como smoke test.

## Publicación y comprobación independiente

El coordinador ejecutó el paquete autorizado: salida 0 y `RELEASE_VERIFIED`. Hosting `b830ace6f78b96f9`, SSR `ssrpay0system-00608-tag`, fuente ZIP `b273a696…` idéntica al paquete aprobado. Se cotejaron recurso y Run completos contra el snapshot propio; serviceConfig salvo revisión, runtime/entrypoint, configuración real del contenedor salvo imagen, variables, recursos, escalado, red, cuenta de servicio y timeout permanecen iguales a la base. IAM no cambió.

Cinco rutas públicas HTTP 200. Chromium anónimo en 390/1440 px: login renderizado sin overflow, `/pagos`, `/hugo`, `/solicitudes` y `/reportes#complementos-pago` redirigen a login; cero errores JavaScript y cero solicitudes no GET/HEAD. El verificador no hizo escrituras productivas ni acciones financieras. Posteriormente el usuario confirmó el recorrido con su sesión autenticada y la presencia de ambos controles; el proof técnico conserva su límite histórico de ejecución anónima.

Baseline estable `.firebase/modular-release/ui-provider-controls-navigation-stable-baseline.json`, SHA-256 `833884284cf19ed6b48138606d852bd20c5a3ae48d4ec9d25cb0601f954cbb46`, cero operaciones activas, 171 archivos y 4.091.136 bytes. Procedencia nueva `.firebase/modular-release/ui-provider-controls-navigation-published-provenance.json`, SHA-256 `437ffda768cf350602914e634a9fec8bed4210d850487476375d7824cf3f0072`.

Pruebas privadas: `output/provider-controls-navigation/published-verification.json`, SHA-256 `244714bc07e0c82de476db050c8b99ced6f931474fbb84dc47b7a53ef6ef5f5e`; navegador `published-browser-proof.json`, SHA-256 `f173b1aa5da4f8e6b6f28d5c81aff1a5be5dc8dc8d73061a0236cf18f11ff92f`.

Los contadores derivados de Hosting llegaron después del recibo. Se preservó `latest-own-state-before-derived-counts.json`, SHA-256 `7d0420c0e1e87f44326680ae9ad4a379cece67f0a3cc4b43dc366109afba1081`, y se reconciliaron localmente sólo `fileCount` y `versionBytes`, con igualdad profunda del resto. Nuevo own-state SHA-256 `822a1c5064fba812f68ace19a83acc410a89ed9d2834866ca5d664e993ff4880`; prueba `rollback-metadata-reconciliation.json`, SHA-256 `a1063e0a465945d33294e7407c29da80f751088dc31cff6bee2b425b22045c70`. No hubo escrituras cloud en esa reconciliación.

El controlador exacto `deploy-scoped-functions.mjs` queda preservado en el directorio privado del paquete, `controller-snapshot/`, SHA-256 `5d3c799cfa218a1c2d717f2e55a87f685269ad6289eb2771e3329c59aff44d22`, igual al pin del input. Si una integración posterior cambia ese archivo, el protocolo privado exige detener escritores/runners, preservar bytes nuevos, restaurar temporalmente los bytes fijados para la reversión autorizada y reponer después la versión nueva. No se restauraron controladores durante esta entrega ni se alteraron inputs, pins o historial Git.
