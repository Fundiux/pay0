# Acceso a proveedores y complementos de pago

Estado: cambio local de navegación, pendiente de build común y publicación de UI.

En **Solicitudes**, un usuario superadmin verá el enlace **Proveedores y complementos de pago**. Abre `/reportes#complementos-pago`, selecciona la pestaña **Centro de control** y enfoca la sección existente **Complementos de pago · seguimiento actual**. La llegada diferida del perfil y el cambio de pestaña no provocan un bucle ni impiden visitar después otros reportes.

Se conserva un único `PaymentComplementFollowup`, sus controles y las autorizaciones vigentes. No se añaden rutas, roles, switches ni consultas nuevas. El enlace no concede acceso: la ruta y los callables conservan sus verificaciones.

QA: `node --test qa/scripts/payment-complement-navigation.test.cjs`, **5/5 PASS**; `node scripts/verify-authorization-policy.mjs`, **PASS**. Las pruebas usan el JSX y el efecto de navegación reales extraídos de los archivos: visibilidad por rol, destino protegido, foco accesible, llegada diferida y cambio de hash sin bucle. El build frontend se ejecutará junto con la integración común, sin construir en paralelo.
