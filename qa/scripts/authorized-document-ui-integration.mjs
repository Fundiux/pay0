import assert from "node:assert/strict";
import fs from "node:fs";
import { runAuthorizedDocumentAction } from "../../src/lib/authorizedDocumentAction.ts";

const calls = [];
const deliveries = [];
const signedUrl = "https://storage.googleapis.test/signed-document?token=ephemeral";
const returned = await runAuthorizedDocumentAction(
  "upload-parent-scoped",
  async uploadId => { calls.push(uploadId); return signedUrl; },
  async url => { deliveries.push(url); },
);
assert.equal(returned, signedUrl);
assert.deepEqual(calls, ["upload-parent-scoped"]);
assert.deepEqual(deliveries, [signedUrl]);
await assert.rejects(() => runAuthorizedDocumentAction("", async () => signedUrl, async () => {}), /Documento invalido/);
await assert.rejects(() => runAuthorizedDocumentAction("upload-1", async () => "gs:\/\/legacy/path", async () => {}), /URL segura/);

const components = ["DocsModal.tsx", "PagoDocsModal.tsx", "DispersionDocsModal.tsx"];
for (const name of components) {
  const source = fs.readFileSync(`src/components/${name}`, "utf8");
  assert.match(source, /runAuthorizedDocumentAction/);
  assert.match(source, /getAuthorizedDocumentDownloadUrl/);
  assert.doesNotMatch(source, /getDownloadURL\s*\(/);
}
const service = fs.readFileSync("src/services/authorizedDocuments.ts", "utf8");
assert.match(service, /getAuthorizedDocumentDownloadUrl/);
assert.match(service, /callable\(\{ uploadId \}\)/);

console.log(JSON.stringify({ ok: true, uiFamilies: ["SOLICITUD", "PAGO", "DISPERSION"], callablePayload: { uploadId: "upload-parent-scoped" }, ephemeralUrlDelivered: true, legacyStorageUrlRejected: true, visibleErrorContract: true }));
