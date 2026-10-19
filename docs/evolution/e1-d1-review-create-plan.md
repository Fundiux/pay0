# D1 — creador acotado para revisión supervisada con revocación OFF

Estado: **DEPLOYMENT_PENDING — creación con gate OFF**. Paquete local reemitido tras corregir REVOKE; no se creó el endpoint, modificó IAM, activó el gate ni ejecutó un despliegue. El creador E y los controladores compartidos no se modificaron en esta reemisión. La capacidad D global permanece INTEGRATION_PENDING.

## Identidad y alcance

Único destino: `reviewAgent007LearningRule`, proyecto `pay-0-system`, región `us-central1`. No actualiza chat, voz, diagnostics, UI, reglas o datos.

- Archivo: `.firebase/modular-release/d1-after-r14-revoke-off/d1-after-r14-revoke-off.zip`.
- SHA256: `c9a64571acecff5303afc99e79e17411bf3f3fdbcdfb9f6561705b74bb55280d`.
- Base R1.4: `21922d596a664b2916fa459c5c51b165388db5a5b4af897995f3bb85d89b06f9`.
- Patch completo: `ecbcdb61ff78e31f1ff70c0130b36bc32722703faf2f7376d68de9883618dca3`.
- Commit: `d26d856a479c57d5fd7c92add52e2c708dc398f7`; `sourceTree:null`, modo `D1_REVIEW_NEW_FROM_REVIEWED_ARCHIVE_V1`.

El origen R1.4 identifica el archivo; crear sólo este endpoint no exige que chat permanezca en esa fuente. Una actualización posterior de chat necesita su base vigente y debe conservar cualquier publicación posterior, incluida R1.5 si corresponde. Este creador no realiza ese paso.

El ZIP anterior `55c5c45…`, input `098b11df…` y plan `4b6eb39c…` se conservan intactos bajo `learning-review-create/`, sólo como historia. El controlador vigente rechaza ese archivo porque carece de REVOKE con gate OFF. No se sustituyeron sus proofs ni se les atribuyó el fix nuevo.

## Configuración y autorización

La captura de sólo lectura de 2026-10-19 22:55:24 UTC confirmó padre `getControlCenterEngineering`, revisión `getcontrolcenterengineering-00001-cij`, destino ausente y cero operaciones activas. El runner exige Node22, callable sin trigger y servicio listo; rechaza secretos/volúmenes no vacíos y gates heredados ON o ambiguos.

Objetivo: `entryPoint=reviewAgent007LearningRule`, 30 s, 256 MiB y `HUGO_SUPERVISED_RULES_ENABLED=false`. Conserva sólo los campos de configuración permitidos; no copia source, URL ni estado del padre ni introduce secretos.

IAM propuesto: `allUsers` con `roles/run.invoker` sólo en el nuevo servicio `reviewagent007learningrule`, necesario para el transporte callable. La autorización lógica exige Firebase Auth, superadmin activo y root revalidado dentro de la transacción. No se copian permisos de reportes ni roles de proyecto.

Con gate OFF, APPROVE y aplicación siguen bloqueados; **REVOKE autenticado permanece disponible**. Crear el transporte no autoriza aprobar o revocar datos reales. Operación humana, consumidor de chat y activación requieren autorizaciones separadas.

## Paquete preparado

Directorio: `.firebase/modular-release/learning-review-create-revoke-off/`.

| Archivo | SHA256 |
| --- | --- |
| `baseline.json` | `6d0ff4f2912457e05d581f160ddae23a912ec6509b050945545ccf7a5d71663e` |
| `input.json` | `9ddac34f4ecd6c9c0152ede973f10f77f472a108baabc1082397b1d14100a0b1` |
| `create-plan.json` | `b867ee0677e4542b21ba2d57659d0adcac770e5b9ea6b3126486854e1a3a15bb` |
| `startup-verification.json` | `70d1adf6b81200f171dff3f5b3b94b859adc302dca38e0550aea175173ea2393` |
| `behavior-verification.json` | `336c86ba93966c9fd366836923f5fb667b21a6e649608aded67e4509117d220f` |

El plan fija el controlador SHA256 `53dcdc2d5ef9e8a18539df5ffd5f91ee260d8c6ab7bca1ea64ec1de61381633f` y sus helpers. `prepare` comprueba hashes, rutas privadas sin symlinks, identidad, proofs y baseline. Los proofs están fijados en el input y se comprueban antes de parsearlos y otra vez al ejecutar; no bastan contadores autodeclarados.

Las envolturas vinculan el original `d1-after-r14-revoke-off/behavior-verification.json`, SHA256 `2212bad48a3c1e4741673a4cae28ddda894dc081e5992f23040e8f141258b36b`, productor, logs y estructura por SHA. Normalizan sus campos sin afirmar pruebas nuevas (`testsRerun:false`). El ZIP y sus 802 archivos de runtime se cotejaron de nuevo de forma opaca. Los originales permanecieron intactos.

## Pruebas, ejecución y reversión

`node --test qa/scripts/supervised-learning-review-create.test.mjs qa/scripts/e1-operations-create-plan.test.mjs`: **52/52 PASS**, cero omisiones; 29 del creador dedicado y 23 de compatibilidad E. Incluye rechazo del ZIP histórico y del proof que bloqueaba REVOKE, pins alterados, scope ajeno, gate ON, deriva, fuente adulterada al reanudar, locks, resultado incierto sin recreación y rollback limitado. Toda la red de esos tests es IO sintético.

El artefacto exacto acredita startup343/previos342/dos rechazos anónimos, typecheck PASS, 20 pruebas de emulador —incluidas siete de reglas con fixture `b0545c2`—, 61 regresiones y 13 de lenguaje natural. Cubre REVOKE OFF autorizado, negativos de actor/root, ledger idempotente y ausencia de reaplicación tras ON. Conserva dos fallos heredados de `universalQueryContract`; no es PASS universal.

Antes de CREATE, incluso reanudando, se comprueban generación/scope y SHA de la fuente subida. Se persiste el inicio de CREATE/IAM/rollback y se usan locks compartidos y journal. Un resultado incierto exige reconciliación, nunca repetición ciega. El ejecutor releerá padre y ausencia antes de mutar. El paquete no constituye autorización de ejecución.

Rollback futuro autorizado: comprobar función/servicio/IAM propios y retirar únicamente la invocación pública añadida. Conservar endpoint, experiencias, reglas, revisiones y ledger; no apagar chat ni restaurar código ajeno. Revocar una regla es una operación distinta del rollback de invocación.
