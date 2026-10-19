# I/J — candidato UI MAT sobre capacidades existentes

Estado: **fix del provider integrado en raíz y QA de wiring PASS; sin instalación, build completo ni publicación**. Candidato completo conservado en `output/mat-ui-candidate`.

Base exportada: `a3348171739dd3b0b7127be47026e162b9656a36`, candidato E derivado de `c1738b405682eaf4fb0fc5a1f51c417e85274a7b`. Los dos archivos MAT son idénticos entre ambas bases; el delta se puede aplicar sin incluir los cambios E de configuración de complementos. `git apply --check` pasó contra la copia a334. Esa copia y el candidato R1 permanecen intactos; la incorporación a raíz se limita al provider de usuarios.

## Delta mínimo

Se recuperan únicamente los cambios de `src/app/mat/usuarios/page.tsx` y `src/app/mat/clientes/page.tsx` de la raíz. Las tarjetas pasan a navegar a los flujos existentes. En usuarios, una sesión Firebase que coincida con el UID canónico del home puede abrir `NuevaSolicitudModal` y el formulario canónico de dispersiones. No se duplican formularios ni se crea un backend alternativo.

Se corrigió una dependencia faltante: `WalletDispersionesPage` llama a `useGlobalLoading`, pero las rutas MAT no reciben el provider de `RootClientShell`. Sin corrección, abrir retorno arroja `useGlobalLoading debe usarse dentro de GlobalLoadingProvider`. El candidato y la raíz envuelven ese formulario con el `GlobalLoadingProvider` ya existente; no cambian el provider ni el formulario. El diff de raíz es un import y el wrapper del formulario; la página de clientes no cambia en esta incorporación.

Patch completo contra la base preservada: `qa/patches/e1-mat-forms.patch`, SHA256 `d2cc28747d56ee66534c0a3cc6404398f9936e56f258520cf9e4a406044e8cd8`. EOL LF, fijado por `.gitattributes`; `git apply --check` PASS. Copia idéntica en `output/mat-ui-candidate/candidate.patch`. La comparación con los bytes del archivo `git archive` confirma sólo dos archivos modificados y 2166 preservados, incluidos manifiestos, locks, reglas y formularios. Evidencia: `source-preservation.json`.

## Autenticación y dependencias reales

**Telegram firmado no crea una sesión Firebase.** No se encontró puente `createCustomToken`/`signInWithCustomToken` en los módulos MAT revisados. No se añade uno en este paquete.

| Acción | Comportamiento del candidato | Requisito |
|---|---|---|
| Usuario: nueva solicitud | Formulario existente embebido sólo si Firebase UID coincide con `home.pay0UserId`; en otro caso navega a `/solicitudes` | Sesión Firebase válida y permisos de solicitudes; el backend conserva autorización |
| Usuario: retorno | Formulario canónico embebido con provider existente bajo la misma condición; en otro caso `/wallet/dispersiones` | Sesión Firebase y permisos de la operación; sin suplir ni fabricar identidad Telegram |
| Cliente: solicitud/retorno | Navegación al flujo web; no impersona al cliente enlazado | Inicio de sesión web y selección autorizada del cliente |
| Telegram sin Firebase | No abre formularios embebidos; navegación web | No constituye operación disponible sólo con Telegram |

Por tanto este candidato hace accesibles flujos web existentes, pero **no completa solicitudes o retornos con una sesión exclusivamente Telegram**. Las guardas MAT backend publicadas protegen lectura e identidad; no sustituyen la autorización de las operaciones financieras.

## QA y límites

`qa/scripts/e1-mat-ui-candidate.test.cjs`: cinco casos PASS tanto en candidato como en raíz mediante `PAY0_MAT_UI_CANDIDATE`, con las páginas MAT, `Modal` y `GlobalLoadingProvider` reales. Reproduce el fallo mediante un control negativo que elimina el wrapper y comprueba el caso corregido, apertura de solicitud con UID coincidente, navegación con UID distinto, con Firebase ausente y desde cliente. Los cuerpos de formularios, sesión y presentación son fixtures; el formulario de retorno de prueba usa el hook real que exige su provider. No se envían solicitudes financieras ni se comprueba un proveedor de pago. Evidencia raíz: `output/mat-ui-candidate/root-ui-verification.json`.

Se comprobaron los imports/props necesarios en la base preservada. No se ha ejecutado build completo, SSR ni un flujo financiero autenticado. Antes de integrar/publicar: revisar la dependencia de sesión indicada, construir el candidato exacto cuando terminen E/R1 y verificar navegación/diálogos con las guardas web reales. No publicar este paquete como un puente de autenticación o como finalización operativa de MAT.
