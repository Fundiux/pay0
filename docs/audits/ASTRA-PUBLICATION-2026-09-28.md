# ASTRA — publicación y reconciliación del ciclo

Fecha: 2026-09-28. Rama: `integration/astra-cycle-20260928`.

Este registro complementa la tabla de 22 puntos de
[BASE860115-05-TRACKER](../BASE860115-05-TRACKER.md). Separa pruebas locales,
publicación y comprobaciones reales. Los informes operativos detallados se
conservan en directorios ignorados; no se versionan identidades, documentos,
credenciales ni respuestas productivas.

## Contención de complementos

La entrega Eventarc de `enqueueAutomaticPaymentComplement` continúa pausada
desde las 04:54 UTC. Su revisión `00006-yus` se excluyó expresamente de los
284 destinos del despliegue. La compuerta de solicitud IQ permanece cerrada.
La pausa no se levantará por publicar una corrección ni por migrar documentos.

La lectura de las 08:19 UTC comprobó la pausa antes y después, cero eventos REP
repetidos en ambas bitácoras y cero peticiones a los tres servicios REP durante
la ventana observada. Los 13 pagos `FAILED_SAFE` y el caso `PLAN_MISSING`
quedaron diagnosticados, sin reenviar operaciones históricas ni ejecutar IQ.
No se borró el historial de actividad para ocultar el incidente.

La ventana posterior a la migración, **08:46:47–09:12:13 UTC**, registró un
seguimiento canónico y una ejecución al borde de la migración, sin errores
HTTP 5xx. No hubo repeticiones posteriores ni invocaciones de enqueue o del
scheduler diario. La pausa se verificó antes y después, conservando retención
de 86.400 segundos. La lectura de comisiones encontró cero configuraciones,
cero preparaciones habilitadas y cero ejecuciones habilitadas. Los estados de
los 188 pagos observados no cambiaron; no se reintentó ningún caso IQ histórico.

## Reglas, índices y almacenamiento

Publicación completada a las 08:07 UTC y lectura posterior aprobada a las
08:20 UTC:

- Firestore: ruleset `042bafab-3487-418e-8245-2416e19d1963`;
  SHA-256 LF `96257055c977d62b4afe30cec4443f65d2717c7a99386fe6578c14e7dd48f20c`.
- Storage: ruleset `d37e96b3-5266-4a44-8ce6-c903a502a854`;
  SHA-256 LF `5876da2001a4c13f1a5947e9e0729a4a9d30f17eed2f890ef1f8f1ef4ccc6282`.
- Los 100 índices compuestos coinciden con el manifiesto y están `READY`.
- TTL `authLoginLimits.expiresAt`: `ACTIVE`.

Las reglas se probaron con los emuladores y las comprobaciones de autorización
antes de publicarlas; los hashes remotos coinciden con las fuentes revisadas.

## Functions y recuperación del despliegue

El primer despliegue actualizó 193 de 284 destinos. Los 91 restantes fallaron
por cuota regional de CPU o imagen compartida ausente; 67 servicios existentes
conservaron su revisión anterior con 100 % de tráfico y 24 destinos nuevos
carecían de revisión utilizable. `ACTIVE` en Functions por sí solo no se tomó
como prueba de publicación: también se exige revisión Cloud Run lista y tráfico
efectivo hacia ella.

Se preparó un segundo despliegue exclusivo de esos 91 destinos, con las mismas
fuentes de backend `51d7667` y los hooks estándar completos. Un adaptador local
limitó la concurrencia de publicación de la CLI a cuatro; no se aumentaron
cuotas ni se modificaron límites de ejecución del producto. La opción `--force`
aceptó las políticas acotadas de reintento declaradas, no omitió verificaciones.

El segundo despliegue terminó correctamente. La lectura de las 08:49:40 UTC
confirmó **284/284 Functions** con fuente nueva, estado `ACTIVE`, servicio
Cloud Run `Ready`, última revisión creada igual a la revisión lista y 100 % de
tráfico hacia la revisión correspondiente. La función REP excluida conservó
su fuente, revisión y pausa.

### Permiso de transporte de los callables nuevos

La comprobación HTTP posterior detectó cuatro respuestas 403 entre siete
sondeos. El inventario IAM identificó después 23 callables afectados:
la creación fallida los había dejado sin el permiso de transporte
que Firebase CLI normalmente asigna al crearlos. La versión 15.3.1 del CLI
lo establece en `createV2Function`, pero omite la rama `callableTrigger` en
`updateV2Function`. Se revisaron las 33 Functions nuevas más una referencia:
23 callables pendientes, tres controles públicos correctos y ocho procesos
de eventos/scheduler correctamente privados.

La revisión automática rechazó inicialmente el cambio de IAM. Se preparó una
prueba con los 23 handlers compilados reales: 69 rechazos `UNAUTHENTICATED`,
cero intentos de SDK/red/subproceso y cinco controles positivos de los bloqueos.
Tras solicitar autorización específica, el usuario respondió:
«Sí, completar ese permiso manteniendo la autenticación de PAY0».

Con esa autorización se aplicó el plan de digest
`a20d4e7279d4f7f0c5a0fa9ebd4fcf48e5bf48a69a59043c4923ec2e00301a24`:
23 permisos `roles/run.invoker` para alcanzar el protocolo callable, con
comprobación de `etag`, revisión y fuentes; los ocho procesos privados y todos
los demás bindings se conservaron. No se modificaron los controles Firebase
Auth, `assertAuthorized`, roles, documentos ni permisos de datos.

La lectura HTTP del **09:08:16 UTC pasó 26/26 comprobaciones**: los 23 callables
y tres referencias llegaron a la aplicación y rechazaron la solicitud sin
sesión. Se enviaron únicamente cuerpos `data:{}`, sin credenciales, IDs o
instrucciones financieras. La prueba no certifica una sesión autenticada.

Verificadores reproducibles:

```powershell
node qa/scripts/new-callable-anonymous-guard-smoke.cjs
node scripts/verify-astra-callable-access.cjs --self-test
node scripts/verify-astra-callable-access.cjs --run --project pay-0-system
```

## Interfaz y voz

Hosting final **`ae9632f51fe79634`**, publicado a las **09:19:00.664 UTC** y
fijado a SSR **`ssrpay0system-00570-rol`** mediante su tag. El postflight de las
**09:21:16 UTC aprobó 70/70 comprobaciones**: servicio y revisión SSR listos,
tráfico efectivo del tag, 284 Functions listas, pausa REP, nueve rutas HTTP y
nueve navegaciones anónimas —incluida una ruta dinámica sintética para ejercer
SSR—, encabezados, 14 archivos idénticos byte a byte y selector grid en el CSS.
La configuración usada para producción conserva emuladores deshabilitados;
no se publicó el fixture de CI. Ambos previews mantuvieron sus versiones.

El build frontend final de `a0b987b` pasó con 46 páginas estáticas, revisión de
tipos y los 22 controles críticos. El CSS generado contiene el selector nuevo
para filas en grid. La dependencia de las pruebas visuales quedó declarada en
el lockfile; los 117 controles de nueve componentes reales pasaron nuevamente
con la instalación local de `esbuild` 0.28.2.

El gateway candidato de María se publicó usando la imagen ya construida,
sin otra compilación ni promoción: revisión `as-5713713-083700`, 12/12
comprobaciones; `00020-daz` conserva el 100 % del tráfico habitual. El
[preview de aceptación](https://pay-0-system--astra-p05-g0y0tga2.web.app/hugo)
corresponde a Hosting `67445ea204ef265e`, expira el 5 de octubre y pasó 30/30
comprobaciones de archivos, encabezados y navegación anónima. No se realizó
una llamada de voz ni se inventó aceptación humana.

## Pruebas que sustentan el cierre

| Área | Evidencia aprobada |
| --- | --- |
| Username y cuenta | 37 controles Auth/Firestore; 13 aliases reales verificados |
| Recursos corporativos y constancias | 72 + 5 controles; 247 verificaciones PDF y 10 páginas inspeccionadas; tres recursos reales y seis artefactos verificados |
| Registro de comprobantes | 75 controles de identificación y 17 controles del registro real contra emuladores, incluida una creación concurrente con dos solicitudes |
| Aplicación automática y MAT | 62 y 21 controles; transacciones, permisos, evidencia exacta e idempotencia |
| Comisiones por cliente/usuario | 110 controles Firestore/Storage y 29 del adapter IQ con proveedor en memoria |
| REP | 26 de automatización, 17 de adopción, 21 del plan/reanudación; cuatro migraciones productivas verificadas |
| Interfaz | 47 de filtros, nueve de presentación, 46 combinados de notas/identidad/Telegram, 117 sobre nueve superficies reales |
| Voz | 48 de gateway, 11 herramientas, 10 privacidad, nueve finalización, 48 de reconciliación acotada; canario 12 y preview 30 verificaciones remotas |
| IQ staging | 79 del bloqueo de transporte y 30 del runtime sin red; fuente limpia preparada |
| Acceso callable | 23 handlers/69 rechazos locales sin efectos; 26 rechazos anónimos en producción |
| Gates estándar | Política de autorización, baseline, 22 controles críticos, discovery 341 endpoints bajo 7.000 ms, CSF, reglas documentales 96, 42 descargas con firmador simulado y ocho rechazos |

Se mantuvieron los hooks normales del despliegue. `qa:pay0` no se usó como
gate: su fixture de Materialidad archivado sigue fuera del contrato de esa
prueba, como documenta AGENTS.md. Las pruebas focalizadas usan fuentes vigentes
y no dependen de ese archivo histórico.

CI quedó preparado para el push a main: compila con una configuración pública
sintética y emuladores loopback, sin secretos, credenciales ni despliegue. Se
conserva el guard de producción. La validación del fixture pasó siete grupos
de comprobaciones, incluido el rechazo de proyecto/gateway incorrectos.

## Git, trabajo paralelo y limpieza

Se inspeccionaron 27 worktrees y se reconciliaron las fuentes del ciclo sin
mezclar ramas completas obsoletas. La carpeta principal conservó sus archivos
de arquitectura no versionados; `final-candidate` conserva su modificación
previa de `serve-hugo-auth-only.mjs` y el canario conserva `.audit-source`.
No se borraron ramas, reescribió historia ni sobrescribieron esos cambios.

La rama `integration/astra-cycle-20260928` contiene la base vigente de main,
las correcciones y la documentación. El cierre Git usa un worktree separado
para fast-forward de main y push normal, con verificación de SHA remoto. El
resultado de esa operación y de CI se registra después del commit del informe,
en la entrega, evitando atribuir a un commit su propio hash aún inexistente.

La auditoría local final de las 09:31:48 UTC confirmó cero procesos Node, Java
o Chromium atribuibles a ASTRA, puertos de emuladores libres y ausencia de
los locks de emuladores y Git revisados. Los cinco procesos Node de Codex/IDE
y los procesos ajenos de Edge/VSCode permanecieron intactos.

Los emuladores y navegadores de las pruebas se cerraron. Se retiraron diez
scripts/configuraciones temporales de preparación, el log del emulador y los
artefactos `.firebase` propios del despliegue (aproximadamente 1,16 GB). La
limpieza verificó el directorio absoluto y la ausencia de enlaces antes de
borrarlo; las rutas largas residuales se eliminaron con APIs de Windows dentro
de PowerShell, sin pasar rutas a otro shell.

Se preservaron los respaldos y checkpoints de las migraciones, los informes
compactos, los PDFs/capturas y los artefactos del canario necesarios para la
aceptación. El junction de dependencias del preview no fue atravesado ni
eliminado. Los procesos y previews ajenos o destinados a aceptación se
conservaron deliberadamente.

## Migraciones acotadas

### Nombres de usuario

El plan de 13 aliases se aplicó correctamente con digest
`e880a806b7bd04b7a738efcf68f67b9cc1ee5419e0ce1e61f6c43d80c37a4d50`.
Cada identidad y reserva única se valida en servidor y transacción. Resultado
del migrador: 13 aplicados, cero cuentas Auth modificadas y cero acciones
financieras. La lectura posterior de las 08:45 UTC comprobó 13 perfiles,
13 reservas `ACTIVE` y las 13 identidades Auth originales. Los correos,
contraseñas y UID existentes permanecen vigentes.

### Recursos corporativos y REP históricos

Los planes revisados abarcan tres plantillas de la empresa propia elegible y
cuatro aplicaciones REP históricas. No se convierte una empresa ajena en propia
ni se adopta automáticamente una plantilla sin correspondencia. La migración REP
exige la pausa vigente, revisiones originales sin cambios y hashes de los ocho
documentos; no solicita ni timbra un complemento nuevo.

La migración REP finalizó a las 08:46:47 UTC con digest
`b8f8976b4c2559f6f6e9962223f56af973d5451ef3d79b9c286437e010d66eaa`:
cuatro aplicaciones migradas, ocho documentos canónicos activos, cero copias
legacy activas, estados financieros originales sin cambios, entrega pausada
y cero acciones de proveedor. El respaldo original y los checkpoints se
conservaron fuera de Git. No se usó un plan regenerado ni la opción de
reanudación para el primer apply.

Los recursos corporativos se migraron a las 08:49:15 UTC con digest
`8f90b624dbda2baaf6d50e63f52d2fc3b2aa503dfa00646fbc6a3ac50ce79a8d`:
tres recursos, tres versiones activas y seis artefactos verificados. El
inventario real contiene 34 empresas y una empresa propia elegible; no se
aplicaron paquetes a empresas fuera de ese alcance. Cero acciones financieras.

## Límites de la validación

Las pruebas financieras usan emuladores y proveedores simulados. La verificación
remota no ejecuta dispersiones, transferencias, timbrado, mensajes ni llamadas de
voz. La navegación anónima y la coincidencia de bundles publicados no equivalen
a una sesión autenticada de aceptación humana.

La facturación de `pay-0-system-staging` sigue deshabilitada: la pregunta del
usuario sobre qué significa staging no autoriza vincular una cuenta de cobro.
Se reconfirmó `billingEnabled:false` mediante la CLI oficial y el proyecto de
cuota correcto; el 403 de una consulta anterior pertenecía al consumidor
histórico de la CLI y no justificaba activar servicios ni vincular una cuenta.
El artefacto de seguridad está preparado y probado localmente. La aceptación
acústica/promoción de voz, el símbolo visual y la hora/días de automatización
de comisiones conservan su decisión humana correspondiente.
