# Reconciliación ASTRA: voz e IQ staging — 2026-09-28

Esta evidencia distingue integración local, pruebas y estado remoto. El agente
raíz registra después el commit final y los despliegues del ciclo. Ninguna
acción de esta auditoría reactivó REP, ejecutó IQ, timbró documentos ni promovió
tráfico de voz.

## Puente de fuentes conservadas

| Fuente | Tratamiento en la integración |
| --- | --- |
| `47d790f`, `4fa7103` | Identidad y lecturas superadmin ya incorporadas semánticamente por `506d392`; no se aplicaron ramas antiguas completas. |
| `4cb04ee` | Se recuperó la configuración Marin del gateway; coincide con la variante que ya recibía tráfico remoto. No hubo despliegue del gateway. |
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

Lectura oficial de Cloud Run a las 07:18 UTC:

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
P0/P0.5 recién integrado.

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

Prueba local: **31 PASS**, dos modos, doce combinaciones de seis familias IQ
con GET/POST, seis configuraciones rechazadas antes de escuchar, cero intentos
de transporte externo y puertos propios cerrados. No es una certificación E2E
financiera. El preparador exige Git limpio para leer fuentes directamente del
commit; `--allow-dirty` queda expresamente limitado a pruebas locales.

Artefacto probado: `tmp/iq-staging-canary/a3d19ede2d68-a95642f5509d29ef`.
SHA-256 del manifiesto:
`7e2e7c9bfe7e7b7799648ed8820367fd5bcefbd740ebea2f13af94312eb38c9a`.
El manifiesto conserva `deployReady:false`: falta preparar otra vez desde el
commit final limpio, construir y fijar el digest de imagen, verificar IAM
privado y resolver facturación. No se ejecutó ninguna de esas mutaciones de
runtime remoto durante esta fase.
