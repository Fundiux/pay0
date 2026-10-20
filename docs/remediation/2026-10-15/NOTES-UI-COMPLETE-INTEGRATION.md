# Completar la integración de los lectores de notas

La revisión autenticada del frontend e215e58 confirmó el panel de Pago y una respuesta HTTP200 de listPagoNotes. El usuario abrió Solicitudes sin error, pero la inspección del código publicado mostró que Solicitudes y Dispersiones aún usaban onSnapshot sobre sus subcolecciones de notas. Los wrappers y los tres endpoints ya desplegados no bastaban para acreditar la integración de las tres pantallas.

Esta corrección pertenece al punto 2 de la lista finita. Recupera de 493c553 los hooks useSolicitudNotes/useDispersionNotes y sus pruebas focalizadas. Aplica solo los cambios de lectura/presentación de notas a las páginas actuales: no reemplaza la página completa de Solicitudes ni incorpora otros cambios operativos de aquel commit. El controlador paginado y los wrappers existentes permanecen intactos. Se conserva la escritura existente y el marcador opcional de leído de Solicitudes.

Las dos pantallas consumen ahora los callables autorizados, muestran error/carga/estado vacío de forma diferenciada, permiten recuperar historial paginado y limpian el estado al cambiar el usuario o ámbito. No se modifica backend, Rules, dependencias ni configuración.

Validaciones del candidato:

- 37 pruebas UI/controlador aprobadas: d75d0e.
- Solicitudes React/DOM sintético aprobado: 22ada3; cero llamadas Cloud, writers reales o red bloqueada, navegador y servidor cerrados. El primer intento 546baa falló por permisos de esbuild en el sandbox; se repitió solo esa prueba fuera del sandbox.
- Dispersiones React/DOM y memoria sintéticos aprobados: 080f75, tres escenarios; navegador y servidor cerrados, cero red externa. No certifica memoria de la aplicación completa ni comportamiento Cloud.
- Política de autorización sincronizada: 1b8918.
- Build frontend Next 15.5.27 aprobado: 1cf4e3, 47 páginas y /descarga/documento conservada.

No se repitieron pruebas SDK ni build de Functions porque el backend y su ZIP desplegado no cambiaron. No hubo notas nuevas ni operaciones financieras reales. Pendiente: integrar el commit en main, empaquetar/publicar el frontend y verificar ambos lectores desde la sesión autenticada. No confundir la apertura del panel anterior de Solicitudes con evidencia del callable nuevo.
