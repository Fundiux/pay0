# Hugo: arquitectura de largo plazo y primera misión autónoma

Estado: definición arquitectónica y plan de evolución. Auditoría del repositorio: 2026-09-21. Este texto no habilita por sí mismo acciones externas ni backfill productivo.

Avance: la parte 1 quedó implementada en `3e7b4da`. La parte 2 incorpora un inventario paginado de solo lectura y métricas en `/hugo`; su diseño no llama a IQ ni a modelos. La deuda prioritaria de motores cognitivos está en `HUGO-DEUDA-ROUTER-MODELOS.md` y se implementará por separado, sin detener esta misión.

## Identidad y principios

Hugo (`AGENTE_007`) es la capa inteligente y operativa del ecosistema PAY0, U-PRO TTT y sistemas futuros. Su ciclo es observar, entender, planear, usar herramientas, actuar, verificar, registrar, aprender y escalar. PAY0 es el primer sistema conectado, no el límite de Hugo.

- **Soberanía:** memoria, reglas, catálogo de capacidades, historial, evaluación y aprendizaje viven bajo nuestro control. Los modelos son motores sustituibles; ninguno define la identidad ni la autoridad de Hugo.
- **Autonomía graduada:** una política versionada decide por capacidad, ámbito y riesgo. Lecturas y acciones reversibles de bajo riesgo pueden ejecutarse con trazabilidad; riesgo medio exige reglas y auditoría; riesgo alto requiere autorización humana inicialmente. El texto de una conversación jamás concede permisos.
- **Herramientas y cómputo:** cada capacidad tiene entradas tipadas, precondiciones, permiso, presupuesto, resultado y verificador. Usar cálculo determinístico para matemáticas, consultas para datos y fuentes para afirmaciones. No calcular si se puede computar, no adivinar si se puede consultar y no asumir si se puede verificar.
- **Resultado verificable:** un POST aceptado, un job terminado o un texto generado no prueban que el objetivo se cumplió. La evidencia de resultado y su vínculo con el caso son obligatorios; incertidumbre y ausencia de evidencia quedan explícitas.
- **Aprendizaje controlado:** registrar observaciones y correcciones humanas con procedencia; proponer cambios de regla; evaluar contra casos históricos y aprobar la promoción. La memoria no cambia políticas, permisos ni código por sí sola.
- **Interacción:** panel para observabilidad y excepciones; conversación como interfaz opcional. El flujo normal nace de eventos y planificadores, no de botones manuales.

## Mapa comprobado del repositorio

| Pieza actual | Reutilización | Límite o vacío |
| --- | --- | --- |
| Next.js App Router, Functions Gen2 Node 22, Firestore, Storage | Mantener límites cliente/servidor y servicios tipados. | El usuario y `AGENTS.md` citan Next.js 14.2.35, pero `package.json` y `package-lock.json` de esta rama fijan 15.5.25. Resolver esa discrepancia antes de planear cambios dependientes de versión. No crear un servidor paralelo para la primera misión. |
| `agent007/observer.ts`, `callables.ts`, `capabilities.ts`; `/hugo` | Observaciones, propuestas, resolución humana y conversación con `rootId`. | La memoria es principalmente descriptiva; no existe un ciclo general de plan, herramienta, verificación y aprendizaje evaluado. La capacidad conversacional IQ usa una muestra de 100 seguimientos. |
| `iq/automationRuntime.ts` y `iqIntegrationConfigs/{rootId}` | Master Switch y compuertas por flujo para schedulers IQ. | Complementos tiene `paymentComplementConfigs` independiente; el envío IQ actual no consulta el Master Switch. Definir y probar una compuerta conjunta antes de incorporarlo. |
| `paymentApplications/complementFollowup.ts` | Proyección idempotente por aplicación PPD, ámbito root y revisión histórica paginada. | La revisión histórica requiere invocación manual y no crea jobs; estados de seguimiento y automatización son distintos. |
| `complementAutomation.ts` | Trigger, jobs por depósito IQ o aplicación Facturama, transacciones, revisión diaria a las 19:00 CDMX, manejo de resultado incierto. | `activatedAt` excluye el histórico; no hay backfill autónomo acotado. La revisión diaria recorre todos los jobs; definir cuotas, checkpoints y métricas. |
| `complementProviders.ts`, `complementPolicy.ts`, `complementDocuments.ts` | IQ preflight/solicitud/consulta/ZIP; validación de UUID, parcialidad, importes y moneda; archivos con hash; Facturama restringido. | La prueba usa proveedores simulados. Falta verificar el primer recorrido real completo. Revisar la preservación de documentos de distintas parcialidades: `saveComplementDocuments` busca activos por pago y tipo sin filtrar `complementKey`. |
| `PaymentComplementFollowup` y `/hugo` | Datos de estado y ámbito superadmin. | Reportes ofrece controles manuales; `/hugo` muestra recomendaciones y memoria, no conteos completos de complementos. La lista de seguimiento se trunca en 100. |

La documentación previa en `HUGO-SANCHEZ-AGENTE-007.md`, `IQ-HUGO-SEGUIMIENTO-2026-09-20.md` y `COMPLEMENTOS-AUTOMATICOS-2026-09-20.md` es contexto histórico. Esta definición amplía el alcance de Hugo. Donde difieran descripciones, el comportamiento efectivo se debe comprobar en código y pruebas antes de operar; por ejemplo, el código actual alerta a los 7 días.

## Arquitectura incremental

1. **Registro de capacidades:** contratos versionados por sistema (`PAY0`, luego `U-PRO TTT`), entrada/salida validada, identidad, permiso, riesgo, efectos externos, clave idempotente, reintento y verificador. Envolver primero las capacidades existentes de complementos; no duplicar el adaptador IQ.
2. **Motor de misión:** caso persistente con objetivo, hechos con procedencia, plan de pasos, estado, plazo, presupuesto y razón de escalamiento. Eventos y schedulers despiertan el caso. Un modelo puede ayudar a interpretar o redactar, pero las decisiones fiscales, financieras y de autorización se ejecutan con reglas y herramientas determinísticas.
3. **Bitácora de decisiones:** por caso y paso guardar detección, evidencia consultada, política aplicada, decisión, intento, respuesta externa, verificación y resultado. Correlacionar con `activityLog`, job, aplicación, depósito y documentos sin copiar secretos ni archivos.
4. **Evaluación y aprendizaje:** comparar objetivos con verificadores; capturar correcciones humanas como observaciones; probar propuestas de regla en sandbox con casos reales anonimizados antes de promoverlas.
5. **Conectores futuros:** U-PRO TTT y WhatsApp usan el mismo registro de capacidades y la misma política de identidad, ámbito, verificación y escalamiento. La evolución de código ocurre en sandbox con pruebas y autorización antes de integración o despliegue.

## Primera misión: complementos de pago IQ

**Objetivo por aplicación:** toda aplicación PPD válida y aplicada en IQ debe tener REP timbrado correspondiente, XML y PDF íntegros, vinculados al pago y a la parcialidad correctos, o un estado pendiente/bloqueado con motivo y siguiente revisión. La unidad de detección es la aplicación; la unidad de solicitud IQ se deduplica por `rootId`, perfil y depósito.

**Detectar.** Recorrer aplicaciones históricas con cursor y checkpoint por root, más eventos nuevos. Unir solicitud, pago, factura, aplicación, plan/intento IQ, seguimiento y documentos existentes. Clasificar PUE, canceladas, no aplicadas, datos incompletos, REP ya vinculado, REP disponible en IQ y REP aún ausente. No inferir ausencia desde una muestra de 100 filas ni desde un PDF genérico.

**Decidir.** Comprobar root, rol/delegación, perfil IQ vigente, Master Switch, configuración específica de complementos y estado del depósito. Separar política de *consulta/descarga de REP existente* de política de *POST de solicitud*: el backfill comienza con lectura y conciliación; cualquier envío histórico usa una cohorte y autorización operativa explícitas. Estados inciertos nunca provocan un POST repetido.

**Actuar y verificar.** Reutilizar preflight y consulta IQ. Si existe REP, descargar ZIP con límites de origen/tamaño y validar XML timbrado, UUID de factura, parcialidad, importes, saldos y moneda; verificar PDF pareado. Guardar documentos por clave de complemento sin sustituir otra parcialidad; releer metadatos y hashes y confirmar los vínculos. Sólo entonces marcar `RECEIVED`. Si no existe, registrar `PENDING` con `nextCheckAt` y reintentar consultas. Si se envía solicitud, conservar la diferencia entre `REQUESTED` y `RECEIVED`.

**Backfill controlado.** Inventario de sólo lectura con conteos y excepciones; prueba en emulador con múltiples parcialidades, duplicados, datos faltantes, caída entre Storage/Firestore y respuestas inciertas; ejecución por lotes pequeños con cursor persistente, cuota por root/perfil, pausa, reporte de diferencias y canario. No timbrar ni enviar solicitudes históricas a IQ durante el inventario. Despliegue, reglas e invocaciones reales requieren autorización explícita.

**Observabilidad.** La primera tarjeta de `/hugo` debe mostrar `Complementos: detectados, procesados, pendientes, errores`, con periodo, universo/cursor y última revisión. `Procesados` significa verificados y vinculados; `pendientes` incluye próximo intento; `errores` distingue bloqueo, fallo recuperable y resultado externo incierto. Contadores agregados desde todos los casos del root, no desde la lista truncada. El detalle muestra evidencia y decisiones, sin convertirse en tablero de botones de operación.

## Orden de implementación y puertas de verificación

1. Corregir y probar conservación de REP de varias parcialidades; fijar semántica de estados y evidencia de recepción. Pruebas de concurrencia y reintento en emulador.
2. Crear inventario histórico de sólo lectura y métricas completas; contrastar una muestra con expedientes y con IQ sin escrituras externas. Publicar conteos en `/hugo`.
3. Integrar la misión con el Master Switch, la configuración de complementos y límites por proveedor. Probar que pausa, permisos y cambios de perfil impiden acciones nuevas.
4. Habilitar recuperación automática de REP ya disponibles, con canario y verificación posterior. Medir discrepancias y detener ante conflictos.
5. Definir cohorte y política para solicitudes IQ históricas ausentes. Autorizarla separadamente; después habilitar envíos acotados y vigilancia hasta recepción o escalamiento.
6. Incorporar las lecciones verificadas al registro de capacidades y extenderlo a otros sistemas y canales.

**Criterio de cierre de la primera misión:** el inventario histórico tiene cobertura y checkpoints demostrables; cada aplicación PPD IQ está clasificada; los REP disponibles se recuperan y vinculan con prueba documental; los ausentes siguen en revisión programada; ningún resultado incierto se reenvía; el panel refleja el universo completo y cada transición conserva evidencia. Builds de frontend y Functions, verificador de autorización y pruebas enfocadas de emulador pasan antes de cualquier despliegue.
