const assert = require("node:assert/strict");
const admin = require("firebase-admin");

if (!admin.apps.length) admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || "pay0-system" });
const db = admin.firestore();
const { getAuthorizedDocumentDownloadUrlCore } = require(
  "../../functions/lib/modules/documents/authorizedDownload.js",
);

const runId = `doc-access-${Date.now()}`;
const rootA = `${runId}-root-a`;
const rootB = `${runId}-root-b`;
const clientA = `${runId}-client-a`;
const signed = [];
const signer = async (storagePath) => {
  signed.push(storagePath);
  return `https://signed.invalid/${encodeURIComponent(storagePath)}`;
};
const auth = (uid) => ({ uid, token: {} });

async function seed(path, data) { await db.doc(path).set(data); }
async function expectDenied(promise, label) {
  await assert.rejects(promise, /No tienes permisos|No autorizado|fuera del root|fuera de scope|no esta activo/i, label);
}
async function expectCode(promise, code, label) {
  await assert.rejects(promise, (error) => {
    assert.equal(error?.code, code, label);
    return true;
  });
}

(async () => {
  const users = {
    superA: { role: "superadmin", rootId: rootA, active: true },
    adminA: { role: "admin", rootId: rootA, active: true },
    operatorA: { role: "operador", rootId: rootA, active: true },
    revokedA: { role: "operador", rootId: rootA, active: true },
    disabledA: { role: "admin", rootId: rootA, active: true, modules: { pagos: { view: false } } },
    disabledOperatorA: { role: "operador", rootId: rootA, active: true, modules: { wallet: { view: false } } },
    adminB: { role: "admin", rootId: rootB, active: true },
  };
  for (const [uid, data] of Object.entries(users)) await seed(`users/${runId}-${uid}`, data);
  await seed(`clients/${clientA}`, { rootId: rootA, active: true, adminId: `${runId}-adminA`, operadorId: `${runId}-operatorA` });
  await seed(`pagos/${runId}-pago`, { rootId: rootA, clientId: clientA, createdBy: `${runId}-operatorA` });
  await seed(`clientDispersions/${runId}-disp`, { rootId: rootA, clientId: clientA, createdBy: `${runId}-operatorA` });
  await seed(`solicitudes/${runId}-sol`, { rootId: rootA, clientId: clientA, createdBy: `${runId}-operatorA` });
  await seed(`userClientAccess/${runId}-revokedA/clients/${clientA}`, {
    active: true, revokedAt: admin.firestore.Timestamp.now(), permissions: { operatePagos: true },
  });

  const documentMatrix = [
    ...["FACTURA_PDF", "FACTURA_XML", "ORDEN_COMPRA", "COTIZACION", "EVIDENCIA_ENTREGA", "EVIDENCIA_OPERATIVA", "CONSTANCIA_RECEPCION_SATISFACCION", "OTRO"]
      .map(type => ({ id: `sol-${type}`, family: "solicitudes", parentId: `${runId}-sol`, fields: { entityType: "solicitudes", solicitudId: `${runId}-sol` }, type })),
    { id: "sol-HISTORICO_OTRO", family: "solicitudes", parentId: `${runId}-sol`, fields: { solicitudId: `${runId}-sol` }, type: "OTRO_HISTORICO" },
    ...["COMPROBANTE_PAGO", "COMPLEMENTO_PAGO_XML", "COMPLEMENTO_PAGO_PDF", "OTRO"]
      .map(type => ({ id: `pago-${type}`, family: "pagos", parentId: `${runId}-pago`, fields: { entityType: "pagos", pagoId: `${runId}-pago` }, type })),
    { id: "disp-COMPROBANTE_DISPERSION", family: "dispersiones", parentId: `${runId}-disp`, fields: { entityType: "clientDispersions", dispersionId: `${runId}-disp` }, type: "COMPROBANTE_DISPERSION" },
  ];
  for (const row of documentMatrix) await seed(`uploads/${runId}-${row.id}`, {
    ...row.fields, rootId: rootA, active: true, status: "READY", documentType: row.type,
    storagePath: `roots/${rootA}/${row.family}/${row.parentId}/docs/${row.type}/document`,
  });

  for (const uid of ["superA", "adminA", "operatorA"]) {
    for (const row of documentMatrix) {
      const result = await getAuthorizedDocumentDownloadUrlCore({
        auth: auth(`${runId}-${uid}`), data: { uploadId: `${runId}-${row.id}` },
      }, signer);
      assert.match(result.url, /^https:\/\/signed\.invalid\//);
    }
  }

  await expectDenied(getAuthorizedDocumentDownloadUrlCore({
    auth: auth(`${runId}-disabledA`), data: { uploadId: `${runId}-pago-COMPROBANTE_PAGO` },
  }, signer), "modulo admin revocado");
  await expectDenied(getAuthorizedDocumentDownloadUrlCore({
    auth: auth(`${runId}-disabledOperatorA`), data: { uploadId: `${runId}-disp-COMPROBANTE_DISPERSION` },
  }, signer), "modulo operador revocado");
  await expectDenied(getAuthorizedDocumentDownloadUrlCore({
    auth: auth(`${runId}-revokedA`), data: { uploadId: `${runId}-pago-COMPROBANTE_PAGO` },
  }, signer), "delegacion revocada");
  await expectDenied(getAuthorizedDocumentDownloadUrlCore({
    auth: auth(`${runId}-adminB`), data: { uploadId: `${runId}-pago-COMPROBANTE_PAGO` },
  }, signer), "otro root");
  await seed(`solicitudes/${runId}-foreign-parent`, { rootId: rootB, clientId: clientA });
  await seed(`uploads/${runId}-foreign-parent-doc`, { rootId: rootA, active: true, status: "READY", entityType: "solicitudes", solicitudId: `${runId}-foreign-parent`, storagePath: `roots/${rootA}/solicitudes/${runId}-foreign-parent/docs/OTRO/document` });
  await expectDenied(getAuthorizedDocumentDownloadUrlCore({
    auth: auth(`${runId}-adminA`), data: { uploadId: `${runId}-foreign-parent-doc` },
  }, signer), "recurso padre fuera de scope");
  await expectCode(getAuthorizedDocumentDownloadUrlCore({
    auth: auth(`${runId}-adminA`), data: { uploadId: `${runId}-missing-upload` },
  }, signer), "not-found", "documento inexistente");
  await seed(`uploads/${runId}-incomplete`, { rootId: rootA, active: true, status: "READY", solicitudId: `${runId}-sol` });
  await expectCode(getAuthorizedDocumentDownloadUrlCore({
    auth: auth(`${runId}-adminA`), data: { uploadId: `${runId}-incomplete` },
  }, signer), "failed-precondition", "metadata incompleta");
  const missingObjectId = `${runId}-missing-object`;
  await seed(`uploads/${missingObjectId}`, {
    rootId: rootA, active: true, status: "READY", solicitudId: `${runId}-sol`,
    storagePath: `roots/${rootA}/solicitudes/${runId}-sol/docs/OTRO/missing`,
  });
  await expectCode(getAuthorizedDocumentDownloadUrlCore({
    auth: auth(`${runId}-adminA`), data: { uploadId: missingObjectId },
  }, async () => { const error = new Error("storage object missing"); error.code = 404; throw error; }), "not-found", "objeto Storage inexistente");
  assert.equal(signed.length, documentMatrix.length * 3, "solo accesos autorizados deben llegar al firmador");
  console.log(JSON.stringify({ ok: true, signedDownloads: signed.length, documentTypes: documentMatrix.map(row => row.type), historicalMetadata: true, roles: ["superadmin", "admin", "operador"], denied: 8, missingObjectCode: "not-found", incompleteMetadataCode: "failed-precondition", externalActions: 0 }));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
