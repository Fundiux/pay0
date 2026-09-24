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

(async () => {
  const users = {
    superA: { role: "superadmin", rootId: rootA, active: true },
    adminA: { role: "admin", rootId: rootA, active: true },
    operatorA: { role: "operador", rootId: rootA, active: true },
    revokedA: { role: "operador", rootId: rootA, active: true },
    disabledA: { role: "admin", rootId: rootA, active: true, modules: { pagos: { view: false } } },
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

  const docs = [
    ["sol", { entityType: "solicitudes", solicitudId: `${runId}-sol` }],
    ["pago", { entityType: "pagos", pagoId: `${runId}-pago` }],
    ["disp", { entityType: "clientDispersions", dispersionId: `${runId}-disp` }],
  ];
  for (const [id, fields] of docs) await seed(`uploads/${runId}-${id}`, {
    ...fields, rootId: rootA, active: true, status: "READY",
    storagePath: id === "sol"
      ? `roots/${rootA}/solicitudes/${runId}-sol/docs/FACTURA_PDF/document.pdf`
      : id === "pago"
        ? `roots/${rootA}/pagos/${runId}-pago/docs/COMPROBANTE_PAGO/document.pdf`
        : `roots/${rootA}/dispersiones/${runId}-disp/docs/COMPROBANTE_DISPERSION/document.pdf`,
  });

  for (const [uid, uploadId] of [
    ["superA", "sol"], ["adminA", "pago"], ["operatorA", "disp"],
  ]) {
    const result = await getAuthorizedDocumentDownloadUrlCore({
      auth: auth(`${runId}-${uid}`), data: { uploadId: `${runId}-${uploadId}` },
    }, signer);
    assert.match(result.url, /^https:\/\/signed\.invalid\//);
  }

  await expectDenied(getAuthorizedDocumentDownloadUrlCore({
    auth: auth(`${runId}-disabledA`), data: { uploadId: `${runId}-pago` },
  }, signer), "modulo revocado");
  await expectDenied(getAuthorizedDocumentDownloadUrlCore({
    auth: auth(`${runId}-revokedA`), data: { uploadId: `${runId}-pago` },
  }, signer), "delegacion revocada");
  await expectDenied(getAuthorizedDocumentDownloadUrlCore({
    auth: auth(`${runId}-adminB`), data: { uploadId: `${runId}-pago` },
  }, signer), "otro root");
  assert.equal(signed.length, 3, "solo accesos autorizados deben llegar al firmador");
  console.log(JSON.stringify({ ok: true, signedDownloads: signed.length, denied: 3, externalActions: 0 }));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
