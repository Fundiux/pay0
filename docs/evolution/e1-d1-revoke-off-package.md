# D1 sobre R1.4: revocación humana con aplicación pausada

Estado: **SUPERSEDED_LOCAL** para la futura entrega de chat por [D1 sobre R1.5](e1-d1-after-r15-package.md). Se preserva este paquete probado como antecedente; no contiene la corrección R1.5 y no debe usarse después de publicarla. No se desplegó este paquete D1.

## Cambio y procedencia

La revisión humana puede revocar una regla aunque el gate esté OFF. Aprobar reglas nuevas y resolverlas en chat continúan deshabilitados con el gate OFF. No se omiten autenticación, superadministrador activo, root, transacción, estado canónico, idempotencia ni ledger.

El fix procede de `b0545c2fdace63e8b366458d7abb0b7eecb98175`. Sobre el RuleStore del candidato D1 anterior se cambió únicamente el guard a `!enabled() && input.action !== "REVOKE"`. No se copió el RuleStore raíz, que incluye D2: este artefacto no contiene `readReview` ni sus nuevos DTO/consultas.

- Base publicada R1.4: `21922d596a664b2916fa459c5c51b165388db5a5b4af897995f3bb85d89b06f9`.
- Intermedio histórico D1: `a6f29085e6674746b610c3578131f42b394aae80d754cc26d914c514397a41a9`.
- ZIP vigente local: `.firebase/modular-release/d1-after-r14-revoke-off/d1-after-r14-revoke-off.zip`, SHA256 `c9a64571acecff5303afc99e79e17411bf3f3fdbcdfb9f6561705b74bb55280d`.
- Patch **completo** de once fuentes contra R1.4: `qa/patches/d1-after-r14-revoke-off.patch`, SHA256 `ecbcdb61ff78e31f1ff70c0130b36bc32722703faf2f7376d68de9883618dca3`.
- Receta: `qa/scripts/build-d1-after-r14-revoke-off-overlay.mjs`, SHA256 `a5a74c744391713dcf90d0ee15f014f87e765fc2a05254f8d5cd8eb0ef4ac98d`. Su reproducción desde R1.4 produjo exactamente el ZIP vigente.

La identidad futura debe usar base R1.4 y el patch completo anterior, con `sourceTree:null` y el commit que versiona esta composición. No atribuir el delta íntegro a la sola línea incremental. El intermedio sólo documenta la construcción. Frente a él cambian únicamente RuleStore.js y su mapa; las otras 800 entradas permanecen byte a byte. Se preservan las dos fuentes R1.4, R2, fórmulas financieras y todos los demás cambios D1.

## Pruebas sobre los bytes vigentes

- Typecheck aislado PASS, código 0; arranque con red bloqueada y gate OFF PASS: 343 exports, 342 anteriores y dos rechazos anónimos.
- Firestore Emulator: 20/20 pruebas previas PASS. La suite de reglas usa el fixture del commit `b0545c2` mediante `PAY0_D1_REVOKE_OFF_TESTS=true`: 7/7 PASS, incluyendo revocación OFF, controles de autorización/root e idempotencia. El flag sólo selecciona QA; no configura el producto.
- Escenario R1.4 con callable y datastore reales: PASS, código 0. Conserva cliente/mes/formato, pide año, persiste el reporte PDF y permite continuar en Excel; aísla root/periodo, reinicia con saludo y rechaza al actor revocado. Datos sintéticos, cero proveedores.
- Regresiones seleccionadas 61/61 y lenguaje natural 13/13 PASS. Los emuladores terminaron y cerraron normalmente.
- Los bytes del runtime se cotejaron contra el ZIP antes y después. Se mantiene la limitación conocida de dos pruebas de `universalQueryContract` heredadas de R1.4/R2, módulo sin consumidores productivos identificados; no se declara PASS universal.

Recibo privado `d1-after-r14-revoke-off/behavior-verification.json`, SHA256 `2212bad48a3c1e4741673a4cae28ddda894dc081e5992f23040e8f141258b36b`; `review-structure.json` registra la comparación. Los logs del candidato contienen typecheck, startup y regresiones; `tmp/d1-after-r14-revoke-off-emulator.log` y `tmp/d1-after-r14-revoke-off-natural-emulator.log` registran persistencia.

## Límites de publicación y reversión

Un futuro update de chat debe limitarse a `sendAgent007Message`, sin cambiar gate, env, IAM, red ni tráfico. La creación de `reviewAgent007LearningRule`, sus permisos, diagnostics y la UI D2 son paquetes separados: exportar un handler en el ZIP no crea ese recurso automáticamente. Las pruebas con gate ON son fixtures locales, no activaciones productivas.

El input local anterior para `a6f29085` quedó marcado SUPERSEDED y no debe ejecutarse. El input nuevo necesita la identidad de este patch completo y una baseline R1.4 comprobada. La reversión conserva la versión publicada previa y su configuración; no borra reglas, experiencias ni auditoría. Apagar el gate pausa aprobaciones y aplicación, pero ya no bloquea revocación autorizada en este código.

El patch usa representaci?n binaria Git para conservar los finales de l?nea de las once fuentes bajo la pol?tica LF de `.gitattributes`. La receta desactiva conversi?n s?lo al aplicar ese patch. La reproducci?n de esta representaci?n conserv? el mismo ZIP `c9a64571`; no cambiaron fuente emitida ni resultados conductuales.
