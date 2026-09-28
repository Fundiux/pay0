# Runtime de seguridad IQ staging

Este servicio sólo comprueba el guard real de acciones externas. No contiene
Firebase SDK, proveedores, credenciales, lecturas financieras, tareas ni
schedulers. No implementa una simulación financiera completa.

El preparador copia una lista mínima de archivos y transpila
`functions/src/modules/iq/externalActionsPolicy.ts` a un artefacto ignorado.
Exige Git limpio; `--allow-dirty` permite pruebas locales y marca
`deployReady: false`. Después del commit se debe preparar de nuevo sin esa opción.

```powershell
node scripts/prepare-iq-staging-canary.mjs --allow-dirty
node qa/scripts/iq-staging-runtime-smoke.mjs
```

El servidor exige Node 22, proyecto `pay-0-system-staging`, entorno `staging`
y modo `disabled` o `simulated`. Rechaza configuraciones contradictorias.
Siempre sustituye `fetch` por un bloqueo sin red. Las pruebas del guard deben
rechazar las doce combinaciones de familia/método antes de llegar a ese bloqueo.

`GET /healthz` y `POST /smoke` no aceptan cuerpos ni destinos suministrados por
el cliente. Fuera de Cloud Run sólo se escucha en loopback. La plantilla de
Cloud Run declara mínimo cero, máximo uno, concurrencia uno y una cuenta sin
roles. El despliegue debe mantener la invocación privada mediante IAM; no hay
ningún permiso `allUsers` en este paquete.

Docker usa `node:22.23.2-alpine`, alineado con el Node local verificado. No se ha
construido ni certificado esa imagen remota. Antes de desplegar se debe obtener
su digest, preparar el artefacto desde un commit limpio y sustituir
`IMAGE_DIGEST_REQUIRED`. No se habilita facturación, API ni infraestructura.
