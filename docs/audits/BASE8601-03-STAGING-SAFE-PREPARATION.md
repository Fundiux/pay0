# BASE8601-03 — preparación segura de staging (2026-09-27)

> Actualización 2026-09-28: el informe siguiente es histórico. La consulta oficial ya confirmó `billingEnabled:false` después de habilitar sólo la API de lectura de Cloud Billing. La barrera de transporte y el canario local se describen en [ASTRA voz/IQ staging](ASTRA-VOICE-IQ-STAGING-20260928.md); no se desplegó runtime remoto ni se vinculó facturación.

## Estado real

Se creó el proyecto GCP/Firebase aislado `pay-0-system-staging` (número
`783496680751`), su sitio Hosting predeterminado y la Web App pública
`1:783496680751:web:def49d19f95adc45f6bdda`. No se vinculó una cuenta de
facturación durante estas acciones. La consulta de billing no pudo verificarse
por API (403/API desactivada); **no se afirma que el plan final esté aprobado**.

No se creó Firestore `(default)`, Storage, Auth users, datos, secretos, Rules,
índices, Functions, revisiones Cloud Run ni schedulers. En el inventario tras
registrar Firebase, `cloudfunctions.googleapis.com`,
`cloudscheduler.googleapis.com`, `firestore.googleapis.com` y
`secretmanager.googleapis.com` seguían desactivadas. Hosting tenía un sitio,
pero ningún contenido se desplegó. La lista de Web Apps previa estaba vacía.

Por ausencia de runtime y credenciales, el staging remoto no tiene capacidad
de llamar IQ ni mover dinero. **No hay aún canario remoto**. Tampoco hay
variables remotas `PAY0_ENVIRONMENT`/`PAY0_EXTERNAL_ACTIONS_MODE`: sólo se
usaron localmente como `staging`/`disabled` para el emulador/build. No se deben
interpretar como configuración desplegada.

## Candidato local y aislamiento

El candidato de código es `23e83079c2aa456b67a96e627b01e0abb0df5957`,
descendiente del SHA de identidad IQ `868d3ed` que incorpora el hard gate REP C.
La rama `fix/base8601-03-staging-certified` deriva directamente de ese SHA.
No se mezclaron `feature/canonical-center-separation` ni
`feature/commission-distribution-cycle`. Las modificaciones locales son sólo
tests, este informe y configuración de destino staging; `functions/src` no se
modificó. Para un deploy futuro se requiere fijar y certificar el nuevo SHA
resultante, no usar un HEAD mutable.

El worktree de staging fija `.firebaserc` y `firebase.json` a
`pay-0-system-staging`; el script de Hosting también tiene ese `--project`
explícito. El objetivo de Hugo Voice es `https://hugo-voice-staging.invalid/voice`
deliberadamente no enrutable. Ningún comando de deploy se ejecutó. La
configuración pública de la Web App se obtuvo transitoriamente para el build y
no se guardó en Git o `.env`.

## Canario local, sin IQ externo

El emulador Firestore se ejecutó con `--project demo-pay0`,
`PAY0_ENVIRONMENT=staging` y `PAY0_EXTERNAL_ACTIONS_MODE=disabled`. El script
rechaza cualquier proyecto sin prefijo `demo-` o host distinto a
`127.0.0.1:8080`; usa IDs sintéticos con `runId`, URL `iq.invalid`, ningún
password real y borra sus ocho documentos exactos en `finally`. El emulador
se apagó al finalizar. El script nunca abre sesión IQ.

| Caso | Evidencia local | Límite |
| --- | --- | --- |
| A crea → A/B/superadmin/scheduler | Perfil A persistido y resuelto, 8 lecturas de documentos | No invoca callable ni autorización real |
| A cambia a A2 o se desactiva | Se sigue resolviendo A | No ejecuta IQ |
| Perfil A deshabilitado | Fallo cerrado; no sustituye por B | No prueba recuperación operativa |
| Cliente delegado/redelegado | Documento conserva A con actor B/superadmin | ACL de delegación no ejercida |
| Aplicación/REP días después | Documento conserva A con actor scheduler/worker | No descarga REP real |
| Dispersión A → B | Documento conserva A; prueba E2E simulada de dispersión pasa | No hay transferencia financiera |
| Legado inequívoco/ambiguo | A se selecciona / ambigüedad bloquea | Sólo evidencia sintética |
| Pago/cliente sin IQ y `NON_IQ_CHANNEL` | Test estático de contrato existente | No se ejecutó flujo completo |
| REP B con C apagado | Smoke de gates con adaptadores simulados: 23 casos | No GET/POST IQ real |

Resultados: 18 tests unitarios de identidad/canario, 13 verificaciones del
emulador de identidad, smoke REP B/C de 23 casos, simulación de dispersión con
7 rechazos y verificador de política de autorización: PASS. Functions build:
PASS. `externalActions=0`, `iqHttpCalls=0` en el canario sintético; no hubo
invocación de scheduler. El smoke de cuota concurrente produjo una advertencia
de lock timeout del emulador, pero pasó. El primer build frontend se detuvo por
faltantes de variables, como debía. Tras cambiar exclusivamente el destino
local a staging y usar la configuración pública de su Web App, el build pasó
los guards de entorno y release, pero Next.js falló al escribir caché por
`ENOSPC` (volumen C: lleno). Se retiró sólo `.next` de este worktree, recuperando
unos 367 MB; no es espacio suficiente para repetir el build completo. La
comprobación frontend `tsc --noEmit --incremental false` pasó. El build frontend
completo queda sin certificar hasta disponer de espacio libre seguro.

## Puerta para un canario remoto

No desplegar aún: el candidato tiene URL IQ productiva por defecto en algunos
providers y no implementa de forma integral un factory de acciones externas
que garantice `PAY0_EXTERNAL_ACTIONS_MODE=disabled`. `iqRequestEnabled=false`
protege REP C, pero no es una barrera suficiente para aplicación, depósito,
cliente o dispersión. Antes de cualquier Function remota se requiere:

1. Decidir billing, presupuesto/alertas, región/ubicación irreversible de
   Firestore/Storage y política de egress. No enlazar billing ni crear bases sin
   esa decisión.
2. Implementar y probar barreras backend fail-closed para **todos** los POST IQ,
   no sólo REP C; evitar secretos IQ productivos y acceso IAM cruzado.
3. Crear un manifiesto inmutable de deploy con SHA, source/artifact SHA, build,
   revisiones, tráfico, incluidos/excluidos, operador, baseline y rollback.
4. Desplegar sólo las Functions no programadas necesarias; schedulers
   financieros ausentes/PAUSED. Configurar fixtures con `canaryRunId` después de
   confirmar reglas/índices y aislamiento.
5. Ejecutar la matriz remota con adapter simulado y contador verificable
   `externalActions=0`; nunca usar IQ productivo para resolver la incertidumbre
   de sandbox.

La opción de menor riesgo es mantener el proyecto vacío de runtime hasta que
esas barreras y decisiones estén resueltas. La creación de proyecto/Web App
es reversible administrativamente, pero borrar el proyecto puede impedir
reutilizar su ID global; no se hizo ningún teardown remoto.
