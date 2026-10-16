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
