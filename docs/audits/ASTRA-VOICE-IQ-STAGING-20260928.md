# Reconciliación ASTRA: voz e IQ staging — 2026-09-28

Esta evidencia distingue integración local, pruebas y estado remoto. El agente
raíz registra después el commit final y los despliegues del ciclo. Ninguna
acción de esta auditoría reactivó REP, ejecutó IQ, timbró documentos ni promovió
tráfico de voz.

## Puente de fuentes conservadas

| Fuente | Tratamiento en la integración |
| --- | --- |
| `47d790f`, `4fa7103` | Identidad y lecturas superadmin ya incorporadas semánticamente por `506d392`; no se aplicaron ramas antiguas completas. |
| `4cb04ee` | Se recuperó la configuración Marin del gateway; coincide con la variante que ya recibía tráfico remoto. Esa integración de fuentes no desplegó el gateway; el intento posterior se distingue abajo. |
| `7f225ab` | Interrupción confirmada después de 300 ms, rechazo de ruido breve y métricas por respuesta. |
| `c2ad5b6` | Transcripción nativa, persistencia incremental, identidad por respuesta, paginación y actividad de voz. |
| `c0b3f14` | Fallos opacos, auditoría sanitizada y exclusión de trazas crudas del resultado de voz. |
| `8c0dc3d` | Contratos de consulta/snapshot/jobs; no implementa conectores ni reportes universales. |
| `12df181` | Finalización idempotente, reintento y timeout del historial. Se conservaron María y las guardas/configuración de destino actuales. |
| `ffd673b`, `2dff131`, `f7a6547`, `23e8307` | Identidad IQ y gate REP ya recuperados por `060313a`; `originIdentity.ts` coincide con staging-certified. |
| `874e247` | Se recuperaron los dos tests de canario simulado/emulador y su informe histórico. No se copiaron destinos staging a la configuración productiva. |

Se excluyeron Ash `e8e3ab0`, los cambios antiguos de discovery y la configuración
de build candidata que exigía una revisión `00024` fija. La integración mantiene
el guard actual de 7000 ms. La UI conserva María; los identificadores técnicos
HUGO y los contratos existentes permanecen. La revisión/commit del diagnóstico
se toman de `answer.runtime`; su ausencia se muestra como «sin metadatos».

## Voz: evidencia y límite remoto

Lectura oficial histórica de Cloud Run a las 07:18 UTC:

- `hugo-voice-gateway-canary-00020-daz`: 100%, tag `marin-4cb04ee`.
- `hugo-voice-gateway-canary-00024-kuj`: latestReady, tag `p05-a106c`, sin tráfico predeterminado.
- No se alteró el destino de Hosting ni el porcentaje de ninguna revisión.

Pruebas locales: gateway 48/48, contrato de 11 herramientas, privacidad con
10 casos adversariales, finalización con 9 escenarios, contrato universal y
46 comprobaciones de identidad/notas/Telegram: PASS. La prueba WebSocket usó
`ws` 8.21.3 ya instalado en el worktree canario mediante un loader temporal en
memoria; no instaló paquetes ni abrió llamadas externas. El guard de discovery
serializado pasó con 341 endpoints en 1952 ms (warmup 2058 ms), sin elevar el
límite de 7000 ms. Las compilaciones integradas pertenecen al registro del agente raíz.

Queda pendiente la conversación humana contra una revisión identificada y la
matriz de ruido/interrupciones descrita en `HUGO_VOICE_P0_INTERRUPTION_STABILIZATION.md`.
Las pruebas sintéticas no certifican prosodia, reconocimiento acústico ni
promoción del tráfico. La configuración remota vigente no equivale al código
P0/P0.5 recién integrado en el destino predeterminado; el candidato aislado
publicado a continuación permite realizar esa aceptación sin promoverlo.

### Artefacto de gateway y preview: avance posterior

Se construyó la fuente limpia `57137135fc63901e63522b3effcc8b4edff6a71a`.
La imagen de `hugo-voice-gateway-canary` en Artifact Registry quedó fijada al
digest `sha256:42c0b9b8f822ee89e9456a0d938106b5c229b7bfe4e9409201ea2f10d947a540`.
El build terminó, pero el intento de revisión
`hugo-voice-gateway-canary-as-5713713-081311` no quedó listo: condiciones
Ready/ContainerHealthy fallidas por cuota regional de CPU, transición a las
08:29:40 UTC y relectura a las 08:37 UTC; su `/healthz` devolvió 404.
La revisión candidata recibió **0%** del tráfico predeterminado.

Diez verificaciones de preservación pasaron: la revisión `00020-daz` conservó
100% del tráfico y se conservaron los nueve tags previos, IAM, cuenta de
servicio, CPU 1, memoria 512 MiB, concurrencia 40, máximo dos instancias,
mínimo cero, enlace al secreto y configuración operacional/allowlist.
No se infiere disponibilidad del runtime a partir del éxito del build.
El único reintento con esa misma imagen, **sin otro Cloud Build**, publicó
`hugo-voice-gateway-canary-as-5713713-083700`: Ready y ContainerHealthy
satisfactorios desde las **08:45:36 UTC**. El tag `as-5713713-081311` apunta
a esa revisión y conserva 0% del tráfico predeterminado.

El postflight de las **08:51:38 UTC pasó 12/12 comprobaciones**: Ready,
commit/branch/version de build, imagen identificada, tráfico, tags anteriores,
IAM, recursos, referencias de secretos y valores operacionales/allowlist
preservados. La salud se comprobó mediante `GET /`, con respuesta **200 `ok`**,
sin abrir WebSocket ni sesión de OpenAI. `/healthz` devolvía un 404 de la
plataforma porque Cloud Run reserva algunas rutas terminadas en `z`; se usó
la ruta `/` que ya existía en el mismo código, sin modificar el runtime.
Véanse las [rutas reservadas documentadas por Cloud Run](https://docs.cloud.google.com/run/docs/known-issues).

El destino predeterminado sigue en **100% `hugo-voice-gateway-canary-00020-daz`**.
No hubo promoción ni ampliación de la allowlist. La comparación de valores
operacionales se hizo únicamente en memoria; la evidencia conserva resultados
y hashes, no credenciales ni identificadores de usuarios.

El preview aislado pasó **12/12 comprobaciones locales** a las
08:25:48 UTC. Contiene 4.194.668 bytes, digest de artefacto
`090cae4998c5a117e33489d0a29ff3632a81a52e5c3ff6fe06e157b55878d7da`, y parte
del mismo commit limpio. Tras verificar el gateway se publicó en Hosting:

| Campo | Evidencia |
| --- | --- |
| Acceso humano | [María: preview de voz P0/P0.5](https://pay-0-system--astra-p05-g0y0tga2.web.app/hugo) |
| Canal / versión | `astra-p05` / `67445ea204ef265e` |
| Publicación UTC | `2026-09-28T08:52:52.792Z` |
| Expiración UTC | `2026-10-05T08:52:50.091826094Z` |
| Frontend | `57137135fc63901e63522b3effcc8b4edff6a71a` |
| Gateway fijado al compilar | Tag `as-5713713-081311`, revisión `hugo-voice-gateway-canary-as-5713713-083700` |

La UI de `/login`, `/systems`, `/hugo` y `/cuenta` proviene del commit
identificado. El empaquetado aislado configura exportación estática, el origen
del tag y metadata estática del manifest; el cuerpo de las páginas permanece
intacto. El redirect **302** de `/dashboard` a `/hugo` existe sólo en este
preview para completar la navegación posterior al login. Las otras rutas de
la aplicación no forman parte de este artefacto de aceptación.

La publicación usó `--no-authorized-domains`: no sincronizó dominios Auth,
no desplegó SSR ni Functions y no cambió Hosting live. La lectura oficial
posterior de las **08:53:23 UTC** conservó live `c1eeaac789c780f4` y el canal
previo `base8601-02-canary`, versión `2495099408004b59`, con sus respectivos
pins SSR `fh-c1eeaac789c780f4` y `fh-2495099408004b59`. Es evidencia de la
preservación durante este despliegue; la publicación principal posterior
del ciclo queda registrada por separado.

El postflight remoto terminó a las **08:54:48 UTC con 30/30 PASS**: cuatro
HTML, catorce JavaScript y dos CSS con SHA-256 y bytes iguales al artefacto
local; headers de seguridad; redirect exclusivo del preview; y cuatro rutas
anónimas que terminan en login sin errores de página. El chunk de voz contiene
el origen exclusivo del candidato. No se probó UI autenticada ni voz pagada,
no se enviaron credenciales, no se llamó a proveedores y no se ejecutaron
operaciones financieras. Los navegadores/servidor propios quedaron cerrados
y el log temporal de Firebase CLI se limpió.

Evidencia local ignorada: `tmp/astra-gateway-canary/57137135fc63-as-5713713-081311/postflight.json`
y `tmp/astra-voice-preview/57137135fc63-as-5713713-081311/live-verification.json`,
junto a `hosting-before.json` y `hosting-after.json`. La disponibilidad del
preview no sustituye la conversación y aceptación acústica humanas pendientes.

## Barrera de acciones externas en staging

`functions/src/modules/iq/externalActionsPolicy.ts` bloquea el transporte antes
de `fetch` si el proyecto corresponde a staging/sandbox, el entorno no es
producción o existe un modo explícito de acciones externas. Los modos
`disabled`, `simulated`, `sandbox`, `live` y desconocidos permanecen cerrados;
no existe un sandbox IQ certificado al que permitir conexión. El proyecto
staging prevalece aunque otras variables intenten declarar producción.

Los seis transportes IQ importan el guard: autenticación, cliente, transporte
común, dispersión, aplicaciones y proveedores REP. Este último también bloquea
su transporte Facturama. Se conservan los headers, body y AbortSignal de la
configuración productiva existente cuando las nuevas variables están ausentes.
No hay credenciales ni respuestas de proveedores en las pruebas o informes.

`iq-staging-external-actions-smoke.cjs`: PASS 79 comprobaciones, seis módulos
cubiertos, cero red y cero acciones externas. El test impide añadir un `fetch`
crudo en esos dominios. Los tres tests recuperados del canario de identidad
pasaron contra el build integrado. El test Firestore recuperado conserva sus
guardas `demo-*`/localhost y no se repitió durante los emuladores de otro frente.

## Staging remoto: bloqueo verificado

Proyecto `pay-0-system-staging`: APIs de Cloud Run, Functions, Cloud Build,
Artifact Registry, Firestore, Scheduler y Secret Manager no estaban habilitadas
en la lectura del ciclo. Se habilitó exclusivamente
`cloudbilling.googleapis.com` en staging para resolver el 403 de consulta.
La lectura oficial posterior devolvió **`billingEnabled: false`**.

Ese estado sigue vigente en esta evidencia. La duda o pregunta del usuario
sobre facturación no constituye autorización para vincular una cuenta.

No se vinculó cuenta, no se cambió plan, no se habilitaron APIs de runtime ni
se desplegó servicio. El runtime mínimo de seguridad puede prepararse y probarse
localmente sin Firestore, secretos o schedulers; su publicación requiere la
decisión de facturación. Esto es distinto de la falta de credenciales/hostname
IQ sandbox: un canario de seguridad sin red no necesita tales credenciales.
Una futura prueba IQ real sí requiere un sandbox confirmado y autorización
específica del proveedor.

## Artefacto local de seguridad

`services/iq-staging-canary/` contiene un runtime Node 22 sin dependencias de
paquetes. Exige el proyecto staging, rechaza configuraciones contradictorias
antes de escuchar y bloquea también `globalThis.fetch` como segunda barrera.
Sólo expone salud y una prueba fija del guard; no acepta destinos, payloads ni
operaciones financieras. La plantilla exige invocación privada, cuenta sin
roles, mínimo cero, máximo uno y concurrencia uno.

```powershell
node scripts/prepare-iq-staging-canary.mjs --allow-dirty
node qa/scripts/iq-staging-runtime-smoke.mjs
```

Prueba histórica con fuente de trabajo: **31 PASS**, dos modos, doce combinaciones de seis familias IQ
con GET/POST, seis configuraciones rechazadas antes de escuchar, cero intentos
de transporte externo y puertos propios cerrados. No es una certificación E2E
financiera. El preparador exige Git limpio para leer fuentes directamente del
commit; `--allow-dirty` queda expresamente limitado a pruebas locales.

Ese primer artefacto fue `tmp/iq-staging-canary/a3d19ede2d68-a95642f5509d29ef`,
con manifiesto `7e2e7c9bfe7e7b7799648ed8820367fd5bcefbd740ebea2f13af94312eb38c9a`.
Es evidencia histórica; ya no representa el candidato limpio vigente.

La preparación posterior leyó directamente el commit limpio
`57137135fc63901e63522b3effcc8b4edff6a71a`, sin `--allow-dirty`, y produjo
`tmp/iq-staging-canary/57137135fc63-a95642f5509d29ef`. Su prueba local pasó
**30 comprobaciones**. SHA-256 del manifiesto vigente:
`b2da1234e138d4d0d020fb17cbfe3f5342cec7bbaf76d023425d93abd5813b82`.
Se verificaron `workingTreeDirty:false`, `sourceReadyForBuild:true`,
`deployReady:false`, `containerBuilt:false` y `cloudAccessPerformed:false`.

La fuente ya está lista para construir. Aún falta construir y fijar la imagen
del canario IQ staging, verificar IAM privado y resolver facturación antes
de publicarlo. El build de voz descrito arriba pertenece a otro servicio y
no satisface esas condiciones. No se ejecutaron mutaciones del runtime IQ
staging ni se convirtió `sourceReadyForBuild` en una afirmación de despliegue.
