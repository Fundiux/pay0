# D — regla supervisada persistida y revocable

Estado: **LOCAL_VERIFIED_NOT_DEPLOYED**. Código y pruebas terminados; no se habilitó la capacidad en producción ni se añadió interfaz. R1.1 y sus artefactos permanecen separados de estos cambios.

## Capacidad comprobada

El mecanismo anterior `compiledRule` era un evaluador sintético; las reglas antiguas de recomendaciones sólo acumulaban decisiones para contexto. El cambio añade una regla persistida de alcance limitado reutilizando `agent007LearnedRules` y `agent007LearningLedger`.

Única conducta permitida: `VERIFY_DOCUMENT_BEFORE_DECISION`, como recomendación para una solicitud pendiente. La respuesta aconseja revisar documentación y aclara que no confirma documentos faltantes ni la causa del estado. No ejecuta pagos, transacciones financieras, cambios de solicitud ni acciones de proveedor.

`reviewAgent007LearningRule` permite `APPROVE` y `REVOKE`, con export backend y wrapper tipado en `src/services/agent007.ts`. No se añadió página, componente ni ruta de administración.

La aprobación exige superadmin vigente, root propio, entre dos y cinco experiencias de casos independientes, correcciones compatibles, resultados verificables y evaluación determinística satisfactoria. Relee las fuentes dentro de la transacción, conserva referencias y revisiones de soporte y registra la decisión. La aprobación repetida del mismo soporte vigente es idempotente.

La consulta posterior pasa por Hugo Core y el conector existente. Sólo aplica al folio exacto de una solicitud pendiente, releído bajo el root autorizado. Rechaza `deletedAt` e `isDeleted`. Revalida actor, supervisor, experiencias, evidencia y contradicciones; no confía en la elegibilidad almacenada como permiso permanente. Una revocación del actor produce una respuesta genérica de indisponibilidad, sin devolver el folio ni importes.

La regla caduca a las 24 horas. Caducidad, contradicción, retirada del soporte o pérdida de evidencia/supervisión impiden aplicarla y registran invalidación al siguiente intento de uso. La revocación humana es explícita, persistente e idempotente. Las revisiones de las experiencias anteriores permanecen conservadas.

## Gate y límites

`HUGO_SUPERVISED_RULES_ENABLED` debe ser exactamente `true` para administrar o aplicar reglas. Su valor por defecto es deshabilitado; no se configuró en producción durante este trabajo. Con gate deshabilitado no se aplican reglas ni se permite activarlas. Desplegar estos bytes o habilitar el gate requiere una autorización separada; los permisos de publicación de R1.1 no cubren este cambio.

La revisión considera como máximo 100 experiencias del grupo; exceder ese límite impide aprobar. La consulta considera hasta 20 reglas activas; si se excede el límite no aplica ninguna. No se afirma exhaustividad fuera de esos límites.

La evaluación comprueba un contrato determinístico concreto, sin modelo. No demuestra mejora general del razonamiento, entrenamiento de un proveedor ni rendimiento sobre casos reales. Las pruebas usan Firestore Emulator y datos sintéticos; invocan los handlers reales con contextos de autenticación sintéticos. No certifican Firebase Auth ni reglas de acceso de clientes: el Admin SDK del servidor las omite.

## Evidencia final

El coordinador informó build NORMAL final de Functions **PASS**, sesión `92874`. Todas las comprobaciones siguientes usaron `functions/lib` de ese build, sin hook de transpile ni sustitución del almacenamiento.

| Comprobación | Resultado |
| --- | --- |
| Regla supervisada en Firestore Emulator | 7/7 TAP, cero fallos y omisiones; seis subcasos y su contenedor |
| Contexto phase4, aprendizaje phase5, hardening phase6, reportes/query y persistencia de métricas R1 | 50/50, cero fallos y omisiones |
| Verificador de política de autorización | PASS `PAY0-USERS-PERMISSIONS@1` |

El emulador arrancó en proyecto `demo-pay0-e1-*` y puertos locales aislados mediante el launcher existente; terminó con código 0 y cerró sus procesos. Se verificaron aprobación, persistencia, consulta real posterior desde Core sin modelo, revocación, expiración, soft delete, contradicción, soporte protegido, pérdida de evidencia y revocación de rol/actividad/root. La solicitud sintética permaneció idéntica antes y después de las recomendaciones.

Comandos de reproducción, sin `NODE_OPTIONS`:

```powershell
node qa/scripts/e1-operations-emulator.mjs qa/scripts/e1-learning-rules-emulator.test.cjs
node --test --test-concurrency=1 --test-timeout=90000 evals/hugo/phase4-context.test.cjs evals/hugo/phase5-learning.test.cjs evals/hugo/phase6-hardening.test.cjs evals/hugo/evolution-reports.test.cjs evals/hugo/evolution-query-contract.test.cjs evals/hugo/r1-token-usage-persistence.test.cjs
node scripts/verify-authorization-policy.mjs
```

Logs locales ignorados: `tmp/e1-learning-rules-compiled.log` y `tmp/e1-d-compiled-regressions.log`. Las ejecuciones previas con transpile ayudaron a corregir el fixture y el enlace de identidad del caso; no se usan como evidencia final. El frontend del wrapper lo valida el coordinador; este registro no afirma una publicación de interfaz.
