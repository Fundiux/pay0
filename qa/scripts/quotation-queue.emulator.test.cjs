const assert = require("node:assert/strict");
const admin = require("firebase-admin");
const fs = require("node:fs");
const ts = require("typescript");
const crypto = require("node:crypto");

if (!process.env.FIRESTORE_EMULATOR_HOST) throw Error("Firestore Emulator required");
if (!admin.apps.length) admin.initializeApp({ projectId: `demo-pay0-quote-${Date.now().toString(36)}` });

(async () => {
  const db = admin.firestore();
  const { FieldValue, Timestamp } = require("firebase-admin/firestore");
  class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
  const source = fs.readFileSync("functions/src/modules/cotizaciones/queueCallables.ts", "utf8");
  const ast = ts.createSourceFile("queue.ts", source, ts.ScriptTarget.Latest, true);
  const names = new Set(["MAX_ATTEMPTS", "TASK_NAME", "TERMINAL", "clean", "upper", "jobIdFor", "enqueueQuotationForConfirmedIq"]); const parts = [];
  const visit = node => { if (ts.isFunctionDeclaration(node) && names.has(node.name?.text)) parts.push(node.getText(ast).replace(/^export\s+/, "")); if (ts.isVariableDeclaration(node) && names.has(node.name.getText(ast))) parts.push(`const ${node.getText(ast)};`); ts.forEachChild(node, visit); };
  visit(ast); assert.equal(parts.length, 7);
  const extracted = {}; const tasks = new Map();
  const code = ts.transpileModule(`${parts.join("\n")}\nexports.enqueueQuotationForConfirmedIq=enqueueQuotationForConfirmedIq;`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  new Function("exports", "db", "FieldValue", "Timestamp", "HttpsError", "createHash", "logActivity", "enqueueIqOnDemandTaskH4D64", "isTerminalSolicitud", code)(extracted, db, FieldValue, Timestamp, HttpsError, crypto.createHash, async () => {}, async input => { tasks.set(input.taskId, input); return { taskId: input.taskId }; }, require("../../functions/lib/modules/cotizaciones/quotationPolicy.js").isTerminalSolicitud);
  const { enqueueQuotationForConfirmedIq } = extracted;
  const rootId = "quote-root";
  const seed = async (id, iqFolio = `IQ-${id}`, oc = `oc-${id}`) => db.doc(`solicitudes/${id}`).set({ rootId, folio: `S-${id}`, iqFolio, ocFiscalMetadataUploadId: oc, orderUploadId: oc, clienteId: "client", status: "PROCESANDO" });
  const enqueue = (id, iqFolio = `IQ-${id}`) => enqueueQuotationForConfirmedIq({ solicitudId: id, iqFolio, requestedBy: "origin", source: "LOCAL_TEST", batchId: "batch-qa" });
  const inWindows = async (items, size, operation) => { for (let index = 0; index < items.length; index += size) await Promise.all(items.slice(index, index + size).map(operation)); };

  await Promise.all(Array.from({ length: 6 }, (_, index) => seed(`six-${index}`)));
  await Promise.all(Array.from({ length: 6 }, (_, index) => enqueue(`six-${index}`)));
  assert.equal((await db.collection("solicitudQuotationJobs").where("batchId", "==", "batch-qa").get()).size, 6);

  const hundredIds = Array.from({ length: 100 }, (_, index) => `hundred-${index}`);
  // The emulator serializes transaction locks more aggressively than
  // production. Keep the recovery proof deterministic and bounded.
  await inWindows(hundredIds, 1, id => seed(id));
  for (let index = 0; index < hundredIds.length; index += 10) {
    await inWindows(hundredIds.slice(index, index + 10), 1, id => enqueue(id));
    console.log(`QUOTE_QUEUE_PROGRESS ${index + 10}/100`);
  }
  const batch = await db.collection("solicitudQuotationJobs").where("batchId", "==", "batch-qa").get();
  assert.equal(batch.size, 106);
  assert.equal(new Set(batch.docs.map(doc => doc.id)).size, 106);
  assert.equal(tasks.size, 106, "Each new IQ confirmation must dispatch its immediate task");

  await Promise.all(Array.from({ length: 4 }, () => enqueue("six-0")));
  console.log("QUOTE_QUEUE_PROGRESS duplicates");
  assert.equal((await db.collection("solicitudQuotationJobs").where("solicitudId", "==", "six-0").get()).size, 1);

  await seed("replacement", "IQ-OLD", "oc-old");
  await enqueue("replacement", "IQ-OLD");
  await db.doc("solicitudes/replacement").update({ iqFolio: "IQ-NEW", ocFiscalMetadataUploadId: "oc-new", orderUploadId: "oc-new" });
  await enqueue("replacement", "IQ-NEW");
  assert.equal((await db.collection("solicitudQuotationJobs").where("solicitudId", "==", "replacement").get()).size, 2);
  console.log("QUOTE_QUEUE_PROGRESS replacement");

  await seed("exhausted");
  await enqueue("exhausted");
  const exhaustedJob = (await db.collection("solicitudQuotationJobs").where("solicitudId", "==", "exhausted").get()).docs[0];
  await exhaustedJob.ref.update({ status: "FAILED_RETRYABLE", attemptCount: 2 });
  const taskCount = tasks.size;
  assert.equal((await enqueue("exhausted")).queued, false);
  assert.equal((await exhaustedJob.ref.get()).get("status"), "ESCALATED");
  assert.equal(tasks.size, taskCount);
  console.log("QUOTE_QUEUE_PROGRESS exhausted");

  await seed("no-folio", "", "oc-no-folio");
  await assert.rejects(enqueue("no-folio", ""), /folio IQ confirmado/);
  assert.equal((await db.collection("solicitudQuotationJobs").where("solicitudId", "==", "no-folio").get()).size, 0);
  await seed("terminal");
  await db.doc("solicitudes/terminal").update({ status: "CANCELADA" });
  await assert.rejects(enqueue("terminal"), /Solicitud terminal/);
  assert.equal((await db.collection("solicitudQuotationJobs").where("solicitudId", "==", "terminal").get()).size, 0);

  console.log("QUOTE_QUEUE_EVIDENCE", JSON.stringify({ batch6: 6, batch100: 100, duplicateJobs: 1, replacementJobs: 2, immediateTasks: tasks.size }));
})().catch(error => { console.error(error); process.exitCode = 1; });
