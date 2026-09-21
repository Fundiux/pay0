# Estado de endurecimiento de seguridad

Fecha: 2026-09-20

Actualizacion: Firebase Web SDK elevado de 10.14.1 a 12.19.0; el build y la
regresion de seguridad pasaron con Node 22.23.2.

## Controles aplicados

- Next.js actualizado a 16.3.5 y compilado con Node 22.23.2.
- Headers web: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` y HSTS.
- Tokens públicos de constancia y cotización sólo validan documentos activos y sellados.
- Los endpoints HTTP administrativos de IQ requieren un perfil PAY0 existente y activo; los claims del token no aportan rol ni `rootId`.
- El webhook de Telegram compara su secreto con tiempo constante.
- Las dependencias `undici` y `fast-xml-builder` se fuerzan a parches corregidos mediante overrides.

## Evidencia local

- `npm run build`: PASS con Next 16.3.5.
- `npm --prefix functions run build`: PASS.
- `npm run qa:audit-security`: PASS.
- `npm audit --omit=dev`: 0 críticas, 2 altas, 11 moderadas, 1 baja.

## Riesgos pendientes

Las dos alertas altas restantes son transitivas:

- `@grpc/grpc-js`, introducida por Firebase Web SDK 10.
- `form-data`, introducida por tipos/Storage transitivos de Firebase Admin.

No se fuerzan overrides mayores para ellas porque podrían romper el contrato de Firebase. Su cierre requiere una migración controlada del SDK Web Firebase y/o Firebase Admin, con pruebas de Auth, Firestore, Storage y Functions Emulator. No son una razón para ejecutar acciones financieras de prueba en producción.

## Antes de desplegar

1. Ejecutar el smoke de complementos con emuladores sin procesos residuales.
2. Completar la matriz E2E de Materialidad y los flujos financieros pendientes.
3. Revisar el diff y desplegar un único release con smoke post-deploy no financiero.
