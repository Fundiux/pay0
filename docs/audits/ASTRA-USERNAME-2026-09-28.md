# ASTRA — puntos 5 y 6: username y contraseña

Fecha: 2026-09-28. Estado: **backend publicado y migración de 13 aliases aplicada**;
la publicación de interfaz y el postflight conjunto se registran en
[ASTRA-PUBLICATION-2026-09-28](ASTRA-PUBLICATION-2026-09-28.md).

## Reconciliación previa

Se revisaron ramas locales, worktrees, historial y cambios sin commit. El login existente usa email en `src/app/login/page.tsx` y `src/lib/auth.ts`; no se encontró resolución de username, registro único ni cambio de contraseña en otro frente. Los commits `f1cb2b2`/`68ca53f` que mencionan username corresponden a credenciales IQ, no a autenticación PAY0. La infraestructura de Firebase Auth, la creación de usuarios y la política de perfiles se reutilizaron.

Los requisitos originales están en el adjunto `12015628-65bf-4c1d-94ed-a1cbfa91caa3/Pasted text.txt`, líneas 708–758: username único/normalizado, evitar colisiones y revelar email, migrar existentes y conservar compatibilidad; contraseña con sesión/reautenticación/confirmación, sin persistir passwords en Firestore/logs.

## Implementación

- `functions/src/modules/users/loginIdentity.ts`: nuevos callables `loginWithUsername` y `setMyUsername`; registro privado, reserva transaccional, alias retirados, verificación Auth, throttling y compensación de cuentas nuevas no publicadas.
- `functions/src/modules/users/usernameMigration.ts` y `scripts/migrate-usernames.cjs`: plan de sólo lectura y aplicación explícita por digest/proyecto/raíz, máximo 100 usuarios por página, colisiones deterministas e idempotencia. No cambia cuentas Auth.
- `functions/src/index.ts`: import/re-export del módulo; `upsertUser` obtiene email de Auth; `createAdmin` y `createOperador` publican username junto al perfil y mantienen UID, jerarquía y secuencias.
- `functions/src/modules/users/list.ts`, `src/services/users.ts` y `src/app/usuarios/page.tsx`: username en listado/alta y visible para administradores autorizados.
- `src/services/loginIdentity.ts`, `src/lib/auth.ts` y `src/lib/accountValidation.ts`: contrato frontend, compatibilidad email, reautenticación y cambio de contraseña nativo Firebase.
- `src/app/login/page.tsx`: usuario o correo, autocomplete username; limpia contraseña al finalizar.
- `src/app/cuenta/page.tsx`, `src/components/AppShell.tsx`, `src/lib/roles.ts`: Mi cuenta accesible sin permiso del módulo Usuarios, edición propia de username y contraseña. El frente UI añade también el enlace en el selector de sistemas.
- `firestore.rules`: deny explícito de `authUsernames` y `authLoginLimits`; sin acceso cliente ni nuevos índices.
- `scripts/run-firebase-clean-env.mjs`: espera también el puerto Auth 9099 cuando lo selecciona la prueba.
- `qa/playwright/auth.setup.spec.mjs`: selector compatible con el nuevo campo, conservando los fixtures de login email.

## Verificación ejecutada

- Build Functions (`tsc` + copia de recursos canónicos): **PASS**.
- `node scripts/verify-authorization-policy.mjs`: **PASS**.
- `node --check` del migrador y prueba: **PASS**.
- Diff-check de archivos propios: **PASS**.
- `username-auth-emulator.cjs`, mediante wrapper y `demo-pay0-identity`, Auth + Firestore locales: **PASS, 34 controles reportados**. Finalizó a las 06:16 UTC.

La prueba utiliza el SDK Firebase real contra emuladores y rechaza HTTP externo. Cubre: normalización y case; username que autentica al UID existente; email Auth autoritativo frente a un email de perfil alterado; errores uniformes para desconocido/incorrecto/inactivo/eliminado; contraseña actual/nueva/confirmación; contraseña anterior inválida después del cambio; compatibilidad email y username; recent-auth y rechazo de UID objetivo suplantado; alias retirado no reciclable; reserva concurrente; compensación de cuenta nueva; plan seco y aplicación repetible de migración; límite de intentos atómico; lectura/escritura cliente denegada en colecciones privadas; ausencia de passwords en Firestore.

Resultado: `productionAuthCalls: 0`, `externalActions: 0`. Las denegaciones Firestore de las pruebas negativas fueron esperadas. No se modificaron cuentas productivas ni se inició migración productiva.

## Entorno y pendientes de integración

Revalidación integrada del 2026-09-28: **37 controles PASS** con Auth y Firestore, incluidos `disabled`, `deleted` y `deletedAt`. Functions build y frontend de 46 páginas PASS. La cuenta de ejecución ya dispone de firma de tokens; no se modificó IAM. Tras publicar el backend se aplicó el plan de 13 aliases con digest `e880a806b7bd04b7a738efcf68f67b9cc1ee5419e0ce1e61f6c43d80c37a4d50`: cero cuentas Auth, correos o contraseñas modificados. La lectura de las 08:45 UTC confirmó 13 perfiles, 13 reservas `ACTIVE` y 13 identidades Auth originales. TTL de `authLoginLimits.expiresAt` está activo y la configuración del backend quedó publicada. REP continúa pausado.

La CLI cerró Auth, Firestore, hub y logging. Se comprobaron cero listeners en 4400/4500/8080/9099/9150 y ausencia del lock global antes de ceder los emuladores al frente UI. El log local no contenía ninguna de las contraseñas ficticias del test.

El build frontend conjunto y pruebas visuales posteriores quedan a cargo del integrador porque los otros frentes modifican simultáneamente UI. La configuración `PAY0_FIREBASE_WEB_API_KEY`, permiso de firma de custom tokens, TTL de límites, despliegue selectivo y migración productiva están documentados en [USERNAME-LOGIN-AND-ACCOUNT.md](../USERNAME-LOGIN-AND-ACCOUNT.md). Esta evidencia no declara publicado o cerrado un punto por la mera existencia del código.
