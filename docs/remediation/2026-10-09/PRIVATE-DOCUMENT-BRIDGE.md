# Puente documental autenticado S01/S10

Candidato aislado: rama `remediation/private-document-bridge`, worktree `.worktrees/private-document-bridge-20261009`, base `6b8d2f7`. No se modifico integracion, no hay commit ni despliegue y `streamPrivateDocument` NO esta exportado desde `functions/src/index.ts`. Se copiaron los dos archivos S10 congelados (`clientDelegations/access.ts`, `service.ts`) para usar su lector transaccional; deben integrarse una sola vez con el lote S10.

## Contrato

`POST streamPrivateDocument` recibe `{family, documentId, offset?, revision?}` con Firebase ID token en Authorization. Acepta familias `uploads`, `entityDocuments` y `assetDocuments`. No admite query, storagePath, root, URL o generation elegidos por el cliente. Verifica el ID token con `checkRevoked=true`; errores no exponen datos internos. CORS permite solo los dos origenes PAY0 web.app/firebaseapp.com; localhost esta condicionado a Functions Emulator.

`downloadAccess.ts` resuelve el documento canonicamente y lee perfil, entidad y todos los ancestros de delegacion dentro de la misma transaccion. Conserva permisos por modulo/accion, root, familia, titular de dispersion USER, propietario ASSETS incluso frente a otro superadmin, y limite historico entidad superadmin que es el root. Rechaza entidades borradas/inactivas, uploads pendientes, rutas fuera de prefijo y estados documentales no vigentes. Uploads READY y registros legacy explicitamente activos sin status conservan compatibilidad. Documentos de entidad requieren FINALIZED/ACTIVE; ASSETS requiere ACTIVE.

El handler consulta metadata Storage, fija generation y vuelve a autorizar despues de esa consulta, inmediatamente antes del stream. La revision SHA256 vincula documento/ruta/updateTime/generation/tamano. Una segunda peticion con otra revision falla sin iniciar stream. Cada bloque se limita a 8 MiB, timeout55s y longitud exacta; el cliente ensambla el archivo solo despues de recibir todos los bloques y verificar su integridad de transporte. Limite del candidato: 32 MiB por archivo, que cubre el maximo configurado de entityDocuments (25 MiB). Los documentos historicos mayores necesitan inventario antes de retirar su ruta anterior.

La fragmentacion evita el limite oficial de 10 MB de respuestas streaming Functions2, manteniendo documentos legitimos de 10/15/25 MiB: [Firebase Functions quotas](https://firebase.google.com/docs/functions/quotas). No se usa una URL firmada como fallback ni una capability Telegram.

## Consumidores y compatibilidad

`src/lib/downloadPrivateDocument.ts` hace POST autenticado por bloque y devuelve exclusivamente un `blob:` local. Registra esas URLs en el helper puro `authorizedDocumentAction.ts`; el helper acepta solo blobs registrados o HTTPS legacy. Se liberan a los120s o al abandonar la pagina. Cambio de cuenta, fallo de bloque, revision distinta o revocacion no exponen un blob parcial.

`src/services/authorizedDocuments.ts` conserva la firma `getAuthorizedDocumentDownloadUrl(uploadId): Promise<string>` para DocsModal, PagoDocsModal, DispersionDocsModal, Materialidad y pagos. Ahora obtiene un blob local. EntityDocumentsPanel y ASSETS documentos usan el mismo transporte con su familia correspondiente.

Los uploads de solicitud/dispersion/entidad conservan init/upload/finalize; dejan de generar getDownloadURL y devuelven downloadURL vacio por compatibilidad. Los consumidores actuales ignoran ese campo. En dispersion ya no falla finalizacion por intentar descargar primero. El puente se solicita al abrir/descargar, no durante la carga.

El callable antiguo `getAuthorizedDocumentDownloadUrl` permanece temporalmente con su export y respuesta historica, reutilizando el resolver central. Por tanto TODAVIA puede emitir una URL firmada de cinco minutos a clientes antiguos. Esto es compatibilidad de rollout, no cierre de revocacion documental. Se debe retirar su emision despues de publicar/verificar todos los consumidores nuevos y definir una respuesta de migracion para clientes antiguos.

## Orden de integracion

1. Revisar y publicar endpoint nuevo mediante export puntual aprobado; conservar reglas actuales durante verificacion funcional.
2. Publicar consumers frontend y verificar descarga delegada legitima y negativa con actor/ancestro restringido.
3. Retirar callable firmado legacy mediante cambio aprobado y retirar lecturas delegadas Storage directas cuando baseline confirme cobertura de todas las familias.
4. Inventariar URLs persistidas y tokens Storage historicos; rotacion/revocacion requiere migracion expresamente aprobada. El nuevo puente no invalida esas URLs por si solo.

No activar frontend solo: el endpoint aun no exportado daria error, y deliberadamente no existe fallback que vuelva a emitir un bearer remoto.

## Verificaciones

- `node qa/scripts/remediation-private-download.test.cjs`: PASS. Resolver, handler y cadena S10 reales con Firestore/Storage/IDtoken falsos: 25MiB en4 bloques; revocacion de ancestro entre bloques; revocacion del actor durante metadata sin stream; token revocado; generation cambiada; IDs/familia/path forjados; origen/metodo incorrectos; limites/tamanos truncados/errores; perfil restricted malformado; upload pendiente; desconexion; entidad/ASSETS/USER funding.
- `node qa/scripts/remediation-private-download-ui.test.cjs`: PASS. Ensamblado real, credenciales/POST, registro/liberacion de URL local, rechazo de blob desconocido, sin blob parcial tras denegacion/cambio de revision/truncado/cambio de cuenta; ausencia de getDownloadURL en los cinco consumidores migrados y endpoint aun no exportado.
- Typecheck backend acotado con `tsc --noEmit --skipLibCheck --strict --target es2017 --module commonjs --moduleResolution node --esModuleInterop` sobre downloadAccess/documentDownloadHttp/authorizedDownload: PASS repetido despues del endurecimiento de lifecycle.
- No se ejercitaron Auth real, GCS real, Functions desplegadas, tokens reales ni proveedores. No se hicieron builds globales ni npm ci sobre junctions. Dependencias apuntan solo para lectura a las de integracion.

Cada bloque verifica autoridad actual antes de enviar sus bytes. Una revocacion durante un bloque ya iniciado impide el siguiente bloque; no puede recuperar bytes ya entregados. Un archivo ya descargado o un blob ya obtenido no puede revocarse retroactivamente. El cierre de consultas Firestore delegadas generales y la migracion S10 de grants sin procedencia son frentes separados: un proxy de archivos no resuelve ambos.

Suite historica `node --experimental-strip-types qa/scripts/authorized-document-ui-integration.mjs`: assertion migrada expresamente al contrato POST/blob, preservando cuatro familias y rechazo de referencias invalidas. Helper permanece puro, sin importar Firebase en esta prueba standalone.

Validacion final: typecheck frontend acotado de los ocho archivos y sus imports PASS al incluir `next/index.d.ts` resuelto desde el paquete instalado. Los primeros intentos del harness omitieron declaraciones globales Next y fallaron en `<style jsx>` de GlobalLoading, luego apuntaron a una ruta de types inexistente; no se modifico GlobalLoading ni se atribuyeron esos intentos a un PASS. Typecheck backend3modulos PASS, politica PASS, diff --check PASS, suite historica UI y dos suites nuevas PASS. No se ejecuto build global ni navegador.

Archivos del puente: backend documents/{downloadAccess.ts,documentDownloadHttp.ts,authorizedDownload.ts}; frontend lib/{downloadPrivateDocument.ts,authorizedDocumentAction.ts,uploadSolicitudDoc.ts,uploadDispersionDoc.ts,uploadEntityDocument.ts}, services/authorizedDocuments.ts, components/EntityDocumentsPanel.tsx, app/assets/documents/page.tsx; pruebas nuevas remediation-private-download.test.cjs/remediation-private-download-ui.test.cjs y ajuste autorizado de authorized-document-ui-integration.mjs; este informe. Los dos archivos clientDelegations copiados son dependencia S10 ya probada, no una segunda implementacion.

## Additional legacy compatibility gate

`verify-authorized-document-download.cjs` now loads current TypeScript (not stale functions/lib), requires a demo-pay0-document-* project and loopback Firestore emulator, and checks permission-denied codes rather than translated wording. Real Firestore emulator run on 127.0.0.1:18217 / demo-pay0-document-bridge passed: 42 authorized signer-mock calls, 14 document variants, three roles, revoked modules/delegation and cross-root/parent denial, missing metadata/object mapping; zero external document actions. Emulator stopped normally. This gate deliberately retains the legacy callable compatibility check; private-stream behavior remains covered by the separate backend/UI suites.

`config/release-baseline.json` retains prior history/capability guards and adds central transactional resolver, revoked-token verification, POST transport and completed local blob evidence. The obsolete ephemeralUrlDelivered assertion is now localBlobDelivered. Baseline verifier, four-family UI suite and git diff --check passed. No exports, global build or deployment performed.
