import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const firestore = read("firestore.rules");
const storage = read("storage.rules");
const index = read("functions/src/index.ts");
const solicitudUpload = read("src/lib/uploadSolicitudDoc.ts");
const pagoUpload = read("src/lib/uploadPagoDoc.ts");
const dispersionUpload = read("src/lib/uploadDispersionDoc.ts");
const entityUpload = read("src/lib/uploadEntityDocument.ts");

console.log("=== H4-D67-A9 | Contrato real de permisos y Storage ===");

assert.match(firestore, /function hasClientSolicitudAccess\(/);
assert.match(firestore, /function hasClientPagoAccess\(/);
assert.match(
  firestore,
  /operateSolicitudes[\s\S]*permissions\.operateSolicitudes == true/,
);
assert.match(
  firestore,
  /operatePagos[\s\S]*permissions\.operatePagos == true/,
);
assert.match(
  firestore,
  /hasClientSolicitudAccessFromData\(resource\.data\)/,
);
assert.match(
  firestore,
  /hasClientPagoAccessFromData\(resource\.data\)/,
);
console.log("PASS Firestore exige permiso granular de Solicitudes o Pagos");

assert.match(storage, /function hasClientSolicitudAccess\(/);
assert.match(storage, /function hasClientPagoAccess\(/);
assert.match(storage, /function hasClientDispersionAccess\(/);
assert.match(storage, /permissions\.operateSolicitudes == true/);
assert.match(storage, /permissions\.operatePagos == true/);
assert.match(storage, /permissions\.operateDispersiones == true/);
assert.match(storage, /data\.status == "PENDING"/);
assert.match(storage, /data\.uploadStatus == "PENDING_UPLOAD"/);
assert.match(storage, /function preparedUploadMatchesById\(/);
assert.match(storage, /"uploadid" in request\.resource\.metadata/);
assert.match(storage, /function preparedEntityDocumentMatchesById\(/);
assert.match(storage, /"documentid" in request\.resource\.metadata/);
assert.doesNotMatch(
  storage,
  /allow\s+(?:read|write):[\s\S]{0,120}rootId == myRootId\(\)\s*;/,
);
console.log("PASS Storage exige modulo, registro pendiente y ruta exacta");

assert.match(index, /H4_D67_A9_GENERIC_UPLOAD_DISABLED/);
assert.match(
  index,
  /export const initUpload[\s\S]*Carga generica deshabilitada/,
);
assert.match(
  index,
  /export const finalizeUpload[\s\S]*Finalizacion generica deshabilitada/,
);
assert.doesNotMatch(
  index,
  /const storagePath = `roots\/\$\{rootId\}\/\$\{entityType\}\/\$\{entityId\}/,
);
assert.doesNotMatch(index, /status:\s*"pending"/);
console.log("PASS upload generico cerrado sin crear rutas arbitrarias");

for (const [name, source, initCallable, finalizeCallable] of [
  [
    "Solicitud",
    solicitudUpload,
    "initSolicitudDocumentUpload",
    "finalizeSolicitudDocumentUpload",
  ],
  [
    "Pago",
    pagoUpload,
    "initPagoDocumentUpload",
    "finalizePagoDocumentUpload",
  ],
  [
    "Dispersion",
    dispersionUpload,
    "initDispersionDocumentUpload",
    "finalizeDispersionDocumentUpload",
  ],
]) {
  assert.match(
    source,
    new RegExp(`CALLABLES\\.${initCallable}`),
  );
  assert.match(
    source,
    new RegExp(`CALLABLES\\.${finalizeCallable}`),
  );
  assert.match(
    source,
    /const\s*\{\s*uploadId,\s*storagePath\s*\}\s*=/,
  );
  assert.match(source, /if\s*\(!uploadId\s*\|\|\s*!storagePath\)/);
  assert.match(source, /ref\(storage,\s*storagePath\)/);
  assert.match(source, /uploadBytesResumable/);
  assert.match(
    source,
    /customMetadata\s*:\s*\{[\s\S]*\buploadid\s*:\s*uploadId\b/,
  );
  assert.match(
    source,
    /finalize\(\{\s*uploadId,\s*storagePath\s*\}\)/,
  );
  console.log(
    `PASS ${name} usa storagePath backend y upload preparado con uploadId`,
  );
}

assert.match(entityUpload, /uploadBytesResumable/);
assert.match(entityUpload, /customMetadata/);
assert.match(
  entityUpload,
  /\bdocumentid\s*:\s*initResult\.documentId\b/,
);
assert.match(entityUpload, /\bentityDocumentId\b/);
console.log("PASS papeleria fiscal usa documentId preparado");

console.log("H4-D67-A9 QA OK");