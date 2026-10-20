# Acceso a proveedores y complementos de pago

Estado: COMPLETED, limitado a navegación y visibilidad de los controles. Hosting/SSR publicados con autorización específica; el usuario confirmó: «El enlace abre el panel y veo ambos controles». No acredita automatización ni acciones reales de proveedor.

En **Solicitudes**, un usuario superadmin verá el enlace **Proveedores y complementos de pago**. Abre `/reportes#complementos-pago`, selecciona la pestaña **Centro de control** y enfoca la sección existente **Complementos de pago · seguimiento actual**. La llegada diferida del perfil y el cambio de pestaña no provocan un bucle ni impiden visitar después otros reportes.

Se conserva un único `PaymentComplementFollowup`, sus controles y las autorizaciones vigentes. No se añaden rutas, roles, switches ni consultas nuevas. El enlace no concede acceso: la ruta y los callables conservan sus verificaciones.

QA: `node --test qa/scripts/payment-complement-navigation.test.cjs`, **5/5 PASS** en raíz y candidato aislado; verificador de autorización **PASS** en ambos. Las pruebas usan el JSX y el efecto de navegación reales extraídos de los archivos: visibilidad por rol, destino protegido, foco accesible, llegada diferida y cambio de hash sin bucle. Build canónico aislado **PASS**, 47 rutas. Chromium comprueba navegación y panel real con perfil/transporte sintéticos en 390 y 1440 px; el runtime SSR exacto pasa cinco rutas HTTP, login, redirección anónima y cinco comprobaciones de componentes. Alcance, hashes, fixture QA declarado y reversión en [el paquete independiente](e1-provider-controls-navigation-package.md).
