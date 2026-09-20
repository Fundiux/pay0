const assert = require("node:assert/strict");
const admin = require("../../functions/node_modules/firebase-admin");

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("FIRESTORE_EMULATOR_HOST requerido");
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || "pay-0-system" });

const db = admin.firestore();
const uid = "qa-hugo-superadmin";
const rootId = uid;

async function main() {
  await db.collection("users").doc(uid).set({ role: "superadmin", rootId, nombre: "Eduardo", email: "eduardo@example.test" });
  await db.collection("solicitudes").doc("qa-solicitud").set({ rootId, folio: "S1C35U1E28", amount: 14893.62, status: "PROCESANDO", facturamaStatus: "AUTO_DRAFT_FISCAL_VALIDATED", createdAt: admin.firestore.FieldValue.serverTimestamp() });

  const callables = require("../../functions/lib/modules/agent007/callables.js");
  const auth = { uid, token: { role: "superadmin" } };
  const hello = await callables.sendAgent007Message.run({ auth, data: { text: "hola" } });
  assert.equal(hello.ok, true);
  assert.match(hello.message.text, /Hola, Eduardo/i);

  const folio = await callables.sendAgent007Message.run({ auth, data: { text: "¿Qué pasó con S1C35U1E28?" } });
  assert.equal(folio.ok, true);
  assert.match(folio.message.text, /S1C35U1E28/);
  assert.match(folio.message.text, /AUTO_DRAFT_FISCAL_VALIDATED/);

  const listed = await callables.listAgent007Messages.run({ auth, data: {} });
  assert.equal(listed.messages.length, 4);
  assert.deepEqual(listed.messages.map((message) => message.role), ["user", "assistant", "user", "assistant"]);

  await db.collection("agent007Messages").doc("qa-unread").set({ rootId, conversationId: `${rootId}_${uid}`, role: "assistant", text: "Aviso", recipientUid: uid, read: false, createdAt: admin.firestore.FieldValue.serverTimestamp() });
  const marked = await callables.markAgent007MessagesRead.run({ auth, data: {} });
  assert.equal(marked.marked, 1);
  assert.equal((await db.collection("agent007Messages").doc("qa-unread").get()).data().read, true);

  console.log(JSON.stringify({ ok: true, greeting: hello.message.text, folioReply: folio.message.text, historyMessages: listed.messages.length, markedRead: marked.marked }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
