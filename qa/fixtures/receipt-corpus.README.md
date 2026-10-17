# Evaluación del lector de comprobantes

Ejecutar desde la raíz:

```powershell
node --test qa/scripts/receipt-corpus.test.cjs qa/scripts/remediation-ocr-quota.test.cjs
node qa/scripts/evaluate-receipt-corpus.cjs qa/fixtures/receipt-extraction-synthetic-v3.json 86550e0
```

El manifiesto incluido es **sintético**. La evaluación compara texto ya extraído, no certifica OCR, documentos bancarios reales ni ejecución financiera. El reporte queda en `output/receipt-corpus-synthetic.json`, ignorado por Git, con exactitud por campo, banco/formato, documentos completos, casos de error y tiempo del parser.

Para un corpus real autorizado, reutilizar la estructura del manifiesto en una ubicación privada ignorada, cambiar `kind` a `REAL_ANONYMIZED` y agregar:

```json
"authorization": {
  "approvedForEvaluation": true,
  "anonymized": true,
  "reference": "identificador-de-autorizacion"
}
```

Esta declaración debe respaldarse por la autorización real del expediente; el evaluador valida su presencia y no verifica por sí mismo el consentimiento ni la anonimización. Cada muestra contiene un identificador opaco, banco sin datos personales, formato `PDF_TEXT` o `IMAGE_OCR_TEXT`, texto anonimizado y campos `expected` revisados por una persona autorizada. También admite `semantic.<campo>` para contrastar la evidencia semántica. No versionar documentos, texto real, respuestas productivas ni credenciales.

La salida nunca incluye texto, nombres, cuentas ni valores esperados/extraídos: identifica errores por muestra opaca, campo y categoría. La huella del manifiesto, el commit base y las versiones del lector permiten reproducir la comparación. No mezcla corpus real y sintético ni modifica modelos, reglas, pagos o memoria de agentes.

## Comparación y ciclo de correcciones

```powershell
node --test qa/scripts/receipt-corpus-comparison.test.cjs
node qa/scripts/evaluate-receipt-corpus.cjs qa/fixtures/receipt-extraction-synthetic-v3.json 6309830
```

El reporte v2 añade resultados pareados por banco, formato y campo: mejoras, regresiones y aciertos/errores sin cambio. Cualquier campo antes correcto que falle ahora produce `regressionGate: FAIL` y código de salida 1, aunque el total mejore. Un PASS sólo significa ausencia de regresiones en estas muestras; no promoción ni certificación productiva. Los hashes de las fuentes del candidato identifican el árbol de trabajo y detectan cambios durante la evaluación.

Para convertir feedback en una mejora evaluable: revisar la corrección humana autorizada, anonimizar una muestra independiente, fijar sus valores esperados y su banco/formato, reproducir el fallo contra el commit base y contrastar el candidato. Mantener muestras de control que no se usaron al desarrollar la corrección. Las observaciones/memorias del lector son hipótesis; no se importan automáticamente como verdad esperada ni entrenan el parser. Revisar las regresiones individuales y la cobertura antes de aprobar cualquier cambio. Sin corpus real autorizado, la precisión real permanece `NOT_EVALUATED`.

## Infraestructura de la prueba de página

Después de compilar Functions, `node qa/scripts/receipt-inline-emulators.cjs prepare` crea una copia privada del runtime y una lista explícita de callables sin triggers. `start` inicia Auth/Functions/Firestore/Storage en los puertos 9099/5001/8080/9199; en otra terminal, `seed` crea exclusivamente el proyecto `demo-pay0-receipt-ui` y guarda credenciales sintéticas aleatorias en `output/receipt-ui-emulator/fixture.json`. No usa credenciales productivas; los secretos del runtime quedan vacíos y su transporte externo bloqueado. Preparar de nuevo la copia sólo con los emuladores detenidos. La prueba de página requiere además el frontend local configurado para estos emuladores; el script no lo inicia ni modifica `.env.local` del repositorio.

El entrypoint exclusivo del emulador conserva el proxy de inicialización de Firebase CLI, pero fija un namespace Firestore estable y repone sus miembros estáticos con las referencias reales de `firebase-admin/firestore`. Esto evita la pérdida de `FieldValue` por el `.bind()` del CLI; no sustituye transacciones, permisos ni almacenamiento por mocks. La comprobación HTTP local del lector sin autenticación debe responder 401 antes de ejecutar la prueba de página.
