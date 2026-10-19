# E1 — integración por capacidad

Actualización de integración: cotizaciones recuperada en `c88365f`; transporte
Telegram adaptado en `afe9ad2`; control de registros canónicos en `d6f9d42`.
Las decisiones de inspección de abajo se conservan como antecedente. El estado
de entrega actual se registra en [e1-delivery-status.md](e1-delivery-status.md).

Referencia inspeccionada: `bf0d3c75ed9a7d854356052e02a361e05bf467de`, rama
`feature/pay0-global-evolution-20261019`. Es continuidad de E0/E1; no se
reconstruyó el inventario tecnológico. Referencias locales sin fetch. No se
deduce producción de nombres de ramas, de main ni de worktrees de despliegue.

Se reutilizaron la clasificación y los límites de `inspect-modular-integration`
y el contrato acumulativo de `release-baseline`. El escaneo global del primero
se interrumpió para limitar la revisión a las líneas relevantes; no se usó una
salida parcial como evidencia de completitud. Se inspeccionaron commits,
archivos concretos, ascendencia y estados tracked sin escribir en worktrees.

| Capacidad / fuente local | Diferencia frente a HEAD | Decisión de integración |
| --- | --- | --- |
| Main `86157b6fe977` | HEAD tiene 362 commits exclusivos; main 5: UI lote uno, harness autenticado, instrumentación, stubs y retirada del control repair | Conservar HEAD como base funcional acumulada. Portar UI/QA por módulos; no sustituir código global por main |
| Lote1 desde fuente SSR `21e45105ccfe` | 3 commits exclusivos: `5d1f21d`, `c168740`, `21e4510`; HEAD tiene 21 exclusivos | Candidato de UI, sujeto a reconciliar callbacks, guards y QA. No representa prueba de publicación |
| Lote1 final `1d95838b867c` | 70 exclusivos; HEAD tiene 21. Incluye cadena extensa de correcciones QA | Fuente de mejoras de interfaz/QA. La sustitución global eliminaría scripts de despliegue/control actuales; no mezclar wholesale |
| Hugo system `4ee2392d1165` | 2 commits exclusivos: `152de04`, `4ee2392`; numerosos contratos actuales son más amplios | Los adaptadores de modelos y componentes de evaluación ya existen en HEAD. Revisar sólo diferencias de comportamiento; no restaurar código antiguo que suprime delegación de voz, memoria y conectores actuales |
| Hugo router `59bd7148ef2d` | 0 commits exclusivos | Ya ancestro de HEAD; no requiere portado por historia |
| Documentos/dispersiones `ca774d2c811b` | 0 commits exclusivos | Ya ancestro de HEAD; protegido por baseline acumulativo |
| Cotización `4a0d4c94dc22` | 4 commits exclusivos. `f9905459e0a54b5e29c19e00cf0a77ed4e985c9a` contenía una comprobación explícita de root de solicitud ausente en HEAD | Portadas únicamente las tres líneas de esa comprobación. Backend: `generateSolicitudQuotation`; prueba negativa y positiva ejecutada |
| Generación documental `bb5efae9bb87` | 42 exclusivos, incluyendo fijación de generación exacta y límites de descarga | Requiere comparación dedicada de contratos de Storage y revocación; ningún portado automático ni rebaja de permisos |
| Telegram transporte `add1ac15726f` | 45 exclusivos de la línea; commit final añade cancelación, redacción de errores y saneamiento multipart | HEAD conserva transporte anterior con error que incluye cuerpo remoto. Candidato concreto independiente: commit final y su prueba, con revisión de entrega incierta; no integra toda su ascendencia |
| Predeploy bundle `b6a2909376b5` | 88 exclusivos de la línea; contiene reutilización de bundle y evidencia local | HEAD ya dispone de builds/candidatos modulares; preservar identidad SHA y evaluar reutilización por contrato, no importar reportes como certificación |
| IQ portable `ccaf71e26217` | 0 commits exclusivos | Ya ancestro de HEAD |
| Recibo semántico `d331ba96f1b6` | 5 exclusivos por historia, pero `receiptSemantics.ts` y `receiptLearning.ts` ya existen y HEAD los amplía | Conservar implementación actual. Los commits antiguos no acreditan capacidad faltante ni publicación actual |

## Protección del Lote 1

`pay0-ui-batch1-production` (`21e45105ccfe`) mantiene modificaciones tracked
en `firebase.emulator-tests.json`, `package.json` y
`qa/playwright/authenticated-emulator.auth.setup.spec.mjs`. No se tocaron,
restauraron, instalaron dependencias ni limpiaron esos archivos.

Los worktrees `pay0-ui-batch1-final-20261019`, `pay0-ui-batch1-responsive` y
`remediation-ui-batch1` no mostraron cambios tracked en esta lectura. Esto no
afirma ausencia de archivos ignorados o no rastreados. Todos permanecen
protegidos frente a escrituras incidentales.

## Control permanente añadido

`node scripts/verify-capability-registration.mjs` ejecuta primero el baseline
acumulativo existente y después analiza el AST TypeScript. Exige registro único
del callable canónico y definición `onCall` para comisiones, descarga autorizada,
delegación de voz y cotización. Detecta la pérdida del registro aunque quede su
nombre en comentarios, alias desplegados duplicados, colisiones de nombre y
sustitución por una función ordinaria. No usa similitud de texto ni proclama
equivalencia semántica completa del cuerpo de una función.

Pruebas: `node --test qa/scripts/capability-registration.test.mjs`, 5/5;
baseline acumulativo y cuatro registros actuales, PASS. El coordinador integró
este control y sus pruebas en CI después de instalar dependencias, y en los
gates del candidato después de instalar Functions. No requiere cambios en
package.json.

## Paquete de aislamiento de cotización

Procedencia: hunk exacto del commit `f9905459e0a54b5e29c19e00cf0a77ed4e985c9a`.
No se hizo merge. El cambio rechaza la solicitud de otro root antes de consultar
el cliente o reutilizar un documento existente, incluso si sus IDs relacionados
apuntan al root local. `qa/scripts/e1-quotation-root-contract.test.cjs`: 3/3 PASS
(root extranjero, root ausente y mismo root con reutilización idempotente).
Son pruebas locales con dependencias controladas, no operaciones Firebase.

Export afectado: `generateSolicitudQuotation`; core interno:
`generateCotizacionForSolicitudCore`. `getPublicQuotationVerification` comparte
archivo pero no se modifica. Compilación y paquete final de publicación a cargo
del coordinador. No hubo merge, push, despliegue ni modificación productiva.

## Conciliación del gateway productivo para R1

El coordinador verificó que el gateway productivo recibe 100% del tráfico en la
revisión `astra7dfcd8a`, con metadata de commit `7dfcd8aa039a` e imagen
`ae8aea1811185a409a7150fd82fe46aeddc605bd20d0ec2d6ecea3757d27c9b7`.
Esta evidencia externa no se dedujo del nombre de una rama.

La comprobación local `git merge-base --is-ancestor 7dfcd8aa039a bf0d3c7`
terminó con código 0. `git rev-list --left-right --count
bf0d3c7...7dfcd8aa039a` devolvió `369 0`. No hay commits exclusivos del
gateway productivo ausentes en la base E1.

El diff completo de `services/hugo-voice-gateway` entre esos commits contiene
exactamente cuatro archivos: manifest, lockfile, `src/realtimeTools.mjs` y su
test. Manifest/lock cambian UUID a 11.1.1. La herramienta adicional es
`get_earnings_by_client_report`; las trece herramientas productivas existentes
se conservan. Todos los demás archivos de gateway, incluidos servidor,
identidad de runtime, autenticación, transporte, cancelación y voz, conservan
el mismo contenido de Git. Las mejoras E1 en curso añaden fechas comparativas
opcionales a esa herramienta nueva, sin sustituir herramientas productivas.

Conclusión acotada: la base de código para R1 conserva las capacidades del
gateway identificado. No equivale a una prueba end-to-end de la imagen nueva
ni a autorización de despliegue; el paquete debe vincular su nuevo digest a la
revisión y ejecutar sus pruebas antes de publicar.

## Conciliación de fuentes Functions y ajuste de alcance R1

Se compararon únicamente fuentes TS y manifests permitidos de los archivos
privados capturados por el coordinador. No se extrajeron archivos de entorno.
La comparación transitiva alcanzó 92 módulos por archivo productivo. La base
BF conserva los módulos y declaraciones públicas examinados, pero incorpora
23–27 cambios transitivos adicionales en autorización, delegación, memoria,
complementos e IQ. Por ello BF completo no es un reemplazo quirúrgico de las
Functions productivas para R1.

El alcance elegido es un overlay independiente sobre cada fuente productiva de
`sendAgent007Message` y `delegateHugoVoiceTurn`. Agrega ocho archivos de código
relacionados con el reporte, mediante el delta `d5a46a9..bf0d3c7`. El único
ajuste manual de contexto conserva el import productivo `logActivity` sin
introducir `logActivityBatch`. Se mantienen declaraciones originales y los
manifests/locks/tsconfig productivos. No se reemplazan los módulos transitivos
de autorización ni automatización por sus versiones BF.

El cuerpo AST del reporte de utilidades productivo es idéntico en las tres
fuentes capturadas (SHA-256 normalizado
`41d8337a9ba879312784736707f6831b366ab605d10d61ad67049ac3c236c05d`).
El endpoint público `getEarningsByClientReport` queda fuera del despliegue R1;
la extracción de su handler sólo se incluye en los bundles de chat y voz.

La identidad de estos artefactos es `PRODUCTION_OVERLAY_V1`, con hash de la
fuente productiva, hash del patch y hash del archivo final. No corresponde a un
checkout BF ni se declara `sourceTree` BF. La compilación y certificación de los
artefactos finales se completaron como se registra al final de este documento;
la publicación sigue pendiente de autorización.

## Cotización ya publicada

La lectura autorizada de metadata/fuente productiva confirmó la revisión
`generatesolicitudquotation-00021-vuq`, actualizada el 2026-10-17, con el guard
de root exacto antes de consultar cliente/documentos. El hash del archivo fuente
productivo es `771d016da2abe0a055a4a7656cb668dcbd80fac1466fc6ac0e5a11f1ccaca6d9`.
El portado local corrige una divergencia; no requiere volver a publicar esta
Function para introducir ese guard. No se ejecutó el callable.

## Verificación final de artefactos R1

Los dos overlays se compilaron con el tsconfig y dependencias exactos de sus
fuentes productivas. Las compilaciones dentro del sandbox terminaron sin
diagnósticos; repetir las mismas compilaciones fuera de ese límite local
terminó correctamente, sin modificar opciones ni fuentes.

Cada archivo final contiene sólo `lib/`, package.json y package-lock.json;
conserva los assets originales y reemplaza el JavaScript por la compilación
nueva. Los inputs declaran `sourceTree: null` y
`sourceIdentity.mode: PRODUCTION_OVERLAY_V1`. No son una compilación de BF
completo.

La prueba original de `bf0d3c7:evals/hugo/evolution-reports.test.cjs` pasó 5/5
en cada artefacto. Sólo se adaptaron rutas de importación al lib extraído del
archivo final y se bloqueó la red. Comprueba resultados financieros,
reportConnector, chat, voz, inclusión/exclusión de compensadas, límites,
aislamiento por root, roles y denegaciones antes de consultar datos.

La prueba canónica de startup se repitió exactamente con la instalación ya
verificada tras un timeout inicial local de 30 segundos. Terminó con código 0:
342 endpoints cargados para chat, 341 para voz, y denegación sin autenticación
en cada target. Se verificaron byte a byte los 796/788 archivos extraídos
contra sus archivos finales. Los proofs registran explícitamente
`reusedInstall`, hash del probe, identidad del overlay y cero escrituras
productivas. El verificador mantiene ahora un timeout local de 120 segundos.

Los inputs, rollback originales y proofs permanecen privados en
`.firebase/modular-release/e1-2026-10-19T15-47-39-867Z/r1-report-overlay/`.
Estado: preparados y verificados localmente; no publicados. No se incluye el
gateway ni se redeploya el endpoint público de reportes en este paquete.
