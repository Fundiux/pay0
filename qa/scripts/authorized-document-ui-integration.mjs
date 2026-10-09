import assert from "node:assert/strict";
import fs from "node:fs";
import { runAuthorizedDocumentAction, registerPrivateDocumentUrl, releasePrivateDocumentUrl, isPrivateDocumentUrl } from "../../src/lib/authorizedDocumentAction.ts";

const calls = [];
const deliveries = [];
const signedUrl = "blob:https://pay-0-system.web.app/authorized-local-document";
registerPrivateDocumentUrl(signedUrl);
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

const components = [
  "src/components/DocsModal.tsx",
  "src/components/PagoDocsModal.tsx",
  "src/components/DispersionDocsModal.tsx",
  "src/app/materialidad/[id]/page.tsx",
];
for (const name of components) {
  const source = fs.readFileSync(name, "utf8");
  assert.match(source, /runAuthorizedDocumentAction/);
  assert.match(source, /getAuthorizedDocumentDownloadUrl/);
  assert.doesNotMatch(source, /getDownloadURL\s*\(/);
}
const materiality = fs.readFileSync("src/app/materialidad/[id]/page.tsx", "utf8");
assert.match(materiality, /doc\?\.id \|\| doc\?\.uploadId/);
assert.match(materiality, /role="alert"/);
assert.doesNotMatch(materiality, /doc\.storagePath/);
const service = fs.readFileSync("src/services/authorizedDocuments.ts", "utf8");
assert.match(service, /getAuthorizedDocumentDownloadUrl/);
assert.match(service, /downloadPrivateDocument\("uploads", uploadId\)/);
assert.doesNotMatch(service, /httpsCallable/);
const bridge = fs.readFileSync("src/lib/downloadPrivateDocument.ts", "utf8");
assert.match(bridge, /method:\s*"POST"/);
assert.match(bridge, /getIdToken/);
assert.match(bridge, /createObjectURL/);
assert.match(bridge, /revision/);
await assert.rejects(() => runAuthorizedDocumentAction("upload-1", async () => "blob:https://pay-0-system.web.app/unregistered", async () => {}), /URL segura/);
releasePrivateDocumentUrl(signedUrl);
assert.equal(isPrivateDocumentUrl(signedUrl), false);

console.log(JSON.stringify({ ok: true, uiFamilies: ["SOLICITUD", "PAGO", "DISPERSION", "MATERIALIDAD"], bridgePayload: { family: "uploads", documentId: "upload-parent-scoped" }, localBlobDelivered: true, legacyStorageUrlRejected: true, visibleErrorContract: true }));
