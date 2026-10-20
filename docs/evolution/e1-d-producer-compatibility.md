# D — Compatibilidad dirigida de productores supervisados

Estado: contratos de productores publicados compatibles; evidencia de negocio elegible no comprobada. Revisión de sólo lectura, sin invocar callables ni leer documentos financieros.

Se consultaron individualmente ocho recursos `ACTIVE` y sus archivos fuente con generación fijada. La inclusión de un export en un ZIP no se usó como prueba de que el recurso estuviera publicado.

| Recurso | Revisión publicada | ZIP, prefijo SHA-256 |
| --- | --- | --- |
| recordAgent007Observation | recordagent007observation-00009-qiz | 329b31f7 |
| createAgent007MemoryCandidate | createagent007memorycandidate-00002-dow | c50f0d7a |
| reviewAgent007MemoryCandidate | reviewagent007memorycandidate-00002-zes | c50f0d7a |
| linkAgent007VerifiedExperience | linkagent007verifiedexperience-00003-zaw | e0cfed70 |
| createAgent007LearningExperience | createagent007learningexperience-00003-taj | e0cfed70 |
| createAgent007LearningDraft | createagent007learningdraft-00003-dah | e0cfed70 |
| linkAgent007LearningOutcome | linkagent007learningoutcome-00003-bij | e0cfed70 |
| correctAgent007LearningExperience | correctagent007learningexperience-00002-yof | c50f0d7a |

La comprobación **8/8** compara el método JavaScript `lib/` de cada archivo productivo con la transpilación de su **TypeScript embebido en ese mismo archivo**, usando su `tsconfig.json`. No compara esos ocho métodos contra la raíz actual ni certifica todo su grafo transitivo. Una segunda comparación AST contrasta las declaraciones relevantes con la fuente preservada del archivo `c9a64571…`, usado para el endpoint de revisión publicado; no presupone identidad de árboles completos. El archivo de chat `763134cf…` es distinto: esta comparación no lo sustituye ni atribuye a ese despliegue la actualización de los productores.

`createFromVerifiedMemory`, `createDraftFromDecision`, `linkOutcome` y sus constructores canónicos ya están publicados. `addCorrection` y `withCorrection`, aunque su recurso usa el ZIP anterior `c50f0d7a…`, conservan el contrato requerido por D1. Los constructores antiguos no invocados por ese handler no justifican actualizarlo.

`linkVerifiedExperience` publicado es más fuerte que la versión incluida en la fuente D1 `c9a64571…`: resuelve evidencia y comprueba identidad y cronología dentro de una transacción. **Este endurecimiento ya está integrado en la raíz del repositorio**: ambos métodos tienen AST SHA-256 `8b90bb199b70930c52f125a9d25b66cd2b472a62321a60ef38f35c527a8da6e2`. No debe reemplazarse por la versión anterior del candidato.

El camino de evidencia admisible es memoria de decisión confirmada y observaciones canónicas → `linkAgent007VerifiedExperience` → `createAgent007LearningExperience` → corrección estructurada. RuleStore vuelve a comprobar la memoria `EXPERIENCE` confirmada, sus vínculos y las fuentes actuales. `createAgent007LearningDraft` seguido de `linkAgent007LearningOutcome` conserva origen de memoria `DECISION`; no sustituye ese camino. Una observación manual de `recordAgent007Observation` tampoco acredita por sí sola una fuente `ACTIVITY_LOG`.

No se demuestra que existan dos experiencias independientes elegibles ni se inspeccionaron sus documentos. El observador compartido encontrado en archivos fuente tampoco acredita la publicación de cada Function operativa que genera eventos. No se requiere un overlay adicional de estos ocho productores con la evidencia obtenida. D1 chat y la activación siguen siendo entregas separadas; el ciclo de corrección conversacional inmediata no depende de convertirlo en una regla global.

Evidencia privada: `output/d-publication-plan/producer-compatibility/`. `conclusion.json` SHA-256 `75659b51d552fb8cb92990d5c698998433f1b767f20f655b2eba3a376b308171`; metadatos `safe-summary.json` SHA-256 `5490e6e96ffa671185de5938fe4842a003ddfa0b6b40f7a7aa9e8091e9a0ff5c`; correspondencia runtime SHA-256 `6fc0bf4127e0400c53bc0e2c6b72aded50cee1aea9a17e24553507f8cb013c83`. No hubo despliegues, cambios de configuración ni acciones de negocio.
