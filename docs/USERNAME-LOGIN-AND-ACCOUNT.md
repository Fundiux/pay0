# Acceso por usuario y contraseña de cuenta — puntos 5 y 6

## Comportamiento

El login acepta usuario o correo. Los usuarios se normalizan con NFKC, trim y minúsculas; admiten de 3 a 32 caracteres ASCII (letras, números, `.`, `_`, `-`), comenzando y terminando con letra o número. La unicidad es global porque el formulario no solicita una raíz.

`authUsernames/{sha256(username)}` es privado y vincula un alias con un UID y raíz. La autenticación exige también que el perfil conserve ese mismo alias. Los alias retirados quedan reservados: no pueden entregarse a otra persona. Las reglas niegan lectura y escritura cliente, incluso a superadmin; sólo los handlers autorizados usan Admin SDK.

`loginWithUsername` verifica la contraseña mediante Firebase Auth usando el email obtenido de `getUser(uid)`, nunca `users.email`. No retorna email ni un directorio público: sólo emite un custom token después de verificar las credenciales, el UID devuelto, el perfil activo, el rol y el vínculo. Cuenta inexistente, eliminada, inactiva y contraseña incorrecta devuelven el mismo error. La colección privada `authLoginLimits` limita transaccionalmente a 20 intentos por alias y 60 por IP en 15 minutos. No registra contraseña, email ni IP sin hash. Las cuentas con MFA no pasan por este intercambio para evitar degradar su autenticación.

`createAdmin` y `createOperador` reservan el username al crear la cuenta. Los clientes anteriores que no envían username reciben un alias determinista opaco; siguen pudiendo entrar con email. Una creación que no publica el perfil compensa únicamente la nueva cuenta y su reserva. `upsertUser` copia el email autoritativo de Auth.

La pantalla `/cuenta` permite consultar/cambiar el username y cambiar la contraseña. Ambas acciones confirman la contraseña actual con `reauthenticateWithCredential`. El cambio de contraseña utiliza `updatePassword`, conserva el UID y no escribe contraseñas en Firestore. `setMyUsername` sólo acepta el UID autenticado, exige perfil activo y autenticación de los últimos cinco minutos. Las entradas sensibles se limpian al finalizar.

## Preparación de publicación

1. Configurar `PAY0_FIREBASE_WEB_API_KEY` en el entorno de Functions con la API key pública del mismo proyecto Firebase. No imprimir configuraciones ni credenciales. El parámetro tiene default vacío para descubrimiento; sin configuración, username falla cerrado y email continúa disponible.
2. Verificar que la cuenta de servicio de `loginWithUsername` puede firmar custom tokens (`iam.serviceAccounts.signBlob` sobre la cuenta firmante). No otorgar permisos amplios sobre el proyecto como atajo. Fuente: [documentación oficial de custom tokens](https://firebase.google.com/docs/auth/admin/create-custom-tokens).
3. Publicar sólo los handlers que corresponden a este cambio, previa comparación de sus fuentes productivas: `loginWithUsername`, `setMyUsername`, `createAdmin`, `createOperador`, `listUsers`, `upsertUser`. Mantener las Functions financieras ajenas. Actualizar el manifiesto esperado de discovery por los dos exports nuevos; conservar los límites temporales estrictos.
4. Publicar las reglas que niegan las dos colecciones privadas. El catch-all previo ya negaba estas rutas; no se abre acceso cliente. Configurar TTL sobre `authLoginLimits.expiresAt` para retirar límites expirados. No se requiere índice compuesto nuevo.
5. Preparar, revisar y aplicar las páginas de migración antes de anunciar los usernames; publicar Hosting y comprobar login/cuenta/UI. La validación productiva de credenciales se realiza sólo con una cuenta de prueba autorizada o mediante aceptación humana; no cambiar contraseñas de cuentas operativas para probar.

Las APIs de Firebase utilizadas están documentadas en [Auth REST](https://firebase.google.com/docs/reference/rest/auth) y [gestión de usuarios web](https://firebase.google.com/docs/auth/web/manage-users).

## Migración acotada e idempotente

El script no modifica cuentas Firebase Auth, emails, contraseñas, roles, jerarquías ni saldos. Usa usernames existentes válidos y, en su ausencia, nombres visibles normalizados. Resuelve colisiones con sufijos deterministas derivados del UID; nunca deriva aliases del correo. Toda asignación vuelve a verificar raíz, propietario de la reserva e identidad esperada dentro de una transacción. Un cambio concurrente incompatible detiene esa asignación. Una ejecución parcial puede reintentarse con el mismo plan.

Primero compilar Functions. Usar credenciales administrativas del proyecto indicado, sin exportarlas a archivos del repositorio. El modo predeterminado sólo lee y escribe un plan privado dentro del archivo ignorado:

```powershell
node scripts/migrate-usernames.cjs --project PROJECT_ID --root ROOT_UID --limit 50 --output __untracked_archive/username-migration/page-01.json
```

El resultado impreso contiene conteos y SHA-256, no emails ni usernames. Revisar el archivo local sin copiar datos personales a logs o Git. Para aplicar exactamente el plan revisado:

```powershell
node scripts/migrate-usernames.cjs --project PROJECT_ID --root ROOT_UID --apply __untracked_archive/username-migration/page-01.json --confirm-sha256 PLAN_SHA256
```

Si el plan contiene `nextCursor`, preparar otra página con `--cursor CURSOR`. Cada página contiene como máximo 100 usuarios, incluida una raíz legacy sin `rootId`; utilizar límite de al menos 2 en ese caso. No sobrescribir planes. Las cuentas sin proveedor password o sin cuenta Auth se omiten y deben reconciliarse aparte; no se les crea una contraseña. Conservar los planes como evidencia operativa fuera de Git.

## Prueba local

```powershell
$env:GCLOUD_PROJECT = 'demo-pay0-identity'
node scripts/run-firebase-clean-env.mjs emulators:exec --config firebase.emulator-tests.json --project demo-pay0-identity --only auth,firestore "node qa/scripts/username-auth-emulator.cjs"
```

La prueba exige ambos emuladores en loopback y proyecto `demo-*`; rechaza HTTP externo. Verifica login con SDK real, email autoritativo, errores uniformes, cuentas inactivas/eliminadas, reserva concurrente, alias retirado, compensación, migración repetible, throttling, reglas privadas y cambio/reautenticación de contraseña. Cero cuentas productivas y cero acciones externas.
