# D3 — Confirmación idempotente de retiro personal

Estado: `LOCAL_VALIDATED_INTEGRATION_PENDING`. No publicado.

La revisión existente retiraba correctamente el recuerdo, pero un reintento después de perder el primer ACK devolvía solamente `changed:false`. La UI lo interpretaba como fallo. No se añade otro endpoint ni mecanismo de memoria.

Para correcciones personales, `reviewMemoryCandidate` añade `retirement:{memoryId,status:"REJECTED",scope:"CONVERSATION_ONLY"|"USER_TOPIC"}` después de revalidar dentro de la transacción actor, root, autor, propietario y referencias. Se devuelve tanto tras retirar como al reencontrar el mismo registro ya `REJECTED`. Otros estados y la revisión genérica conservan su contrato; `changed:false` solo no acredita retiro. El reintento no vuelve a escribir ni genera otra mutación.

La UI comprueba ID, estado y alcance exactos. Un ACK ausente, de otro recuerdo o de otro alcance mantiene la indicación visible y muestra error controlado. Conserva el aislamiento de UID/root/rol y descarta respuestas asíncronas de contextos anteriores. Para opciones o notas personales exige `USER_TOPIC`.

## Comprobaciones

- Firestore emulado aislado: 16 comprobaciones, código 0. Productor canónico compilado actual y store editado transpilado aisladamente, sin simular persistencia. Ambas duraciones, otro actor del mismo root, otro root, actor revocado, ACK perdido/reintento sin segunda escritura y estado `SUPERSEDED` sin ACK. No equivale a probar un ZIP desplegable.
- Chromium: 18 comprobaciones, código 0; componente y wrapper reales con transporte sintético. Incluye respuesta antigua sin ACK, ID/alcance incorrectos, retiro idempotente válido y limpieza de contexto.
- Build NORMAL Functions, código 0, sin instalación: `tmp/d3-memory-retirement-functions-build.log`.
- Verificador de autorización `PAY0-USERS-PERMISSIONS@1` PASS; política frontend/Functions/Firestore sincronizada. No se modificó la política.
- Build canónico frontend privado, código 0 y 47 rutas: fuente `2eaab272dce343dbcf5938f699dd7999c2086d0a`, hija de MAT `63c70651bf1c2fbdeb0ce891599d7be1013cc70e`. Se verificaron ambos archivos UI completos contra la base antes de aplicar únicamente los hunks D3. Build SHA256 `972c7b84cc2b5d59f2de15f536da5913c079a41ce827dcf73ecd1bf916808b86`, pointer privado `.firebase/modular-release/d3-memory-retirement-ui-build-pointer.json`. Chromium 18 PASS también sobre ese clon con transporte sintético.

Logs privados: `tmp/d3-memory-retirement-emulator.log`, `tmp/d3-memory-retirement-browser.log`. Sin proveedores, datos reales, reglas nuevas ni escrituras financieras. No interviene en comprobantes ni en el handler de chat.

Pendiente: overlay mínimo de `reviewAgent007MemoryCandidate` sobre su baseline propia y preparación/verificación SSR del candidato UI contra la publicación MAT confirmada. No hay input productivo ni permiso de despliegue D3. Publicar backend compatible antes de esta UI: el backend antiguo puede retirar un recuerdo, pero no devuelve este ACK, por lo que la UI nueva mostraría error controlado hasta actualizar el backend. Conservar los lectores y el endpoint protegido de revisión en cualquier reversión; no borrar recuerdos personales.
