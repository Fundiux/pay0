const assert = require("node:assert/strict");
const admin = require("../../functions/node_modules/firebase-admin");
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("FIRESTORE_EMULATOR_HOST requerido");
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || "pay-0-system" });
const db = admin.firestore(), rootId = "qa-history-root", uid = "qa-history-user", otherUid = "qa-history-other";
const auth = value => ({ uid: value, token: { role: "superadmin" } });

async function main() {
  await Promise.all([
    db.doc(`users/${uid}`).set({ role: "superadmin", rootId, active: true }),
    db.doc(`users/${otherUid}`).set({ role: "superadmin", rootId, active: true }),
  ]);
  const conversationId = `${rootId}_${uid}_global`;
  const messages = [
    ["before", "2026-09-24T05:59:59.999Z"], ["one", "2026-09-24T06:00:00.000Z"],
    ["two", "2026-09-24T12:00:00.000Z"], ["three", "2026-09-25T05:59:59.999Z"], ["after", "2026-09-25T06:00:00.000Z"],
  ];
  await Promise.all(messages.map(([id, at]) => db.collection("agent007Messages").doc(`qa-history-${id}`).set({ rootId, conversationId, role: "user", text: id, createdAt: admin.firestore.Timestamp.fromDate(new Date(at)) })));
  const callables = require("../../functions/lib/modules/agent007/callables.js");
  const voice = require("../../functions/lib/modules/agent007/voiceHistory.js");
  const first = await callables.listAgent007Messages.run({ auth: auth(uid), data: { scope: "GLOBAL", dateKey: "2026-09-24", limit: 2 } });
  assert.deepEqual(first.messages.map(row => row.text), ["two", "three"]);
  assert.ok(first.nextMessageCursor);
  const second = await callables.listAgent007Messages.run({ auth: auth(uid), data: { scope: "GLOBAL", dateKey: "2026-09-24", limit: 2, messageCursor: first.nextMessageCursor } });
  assert.deepEqual(second.messages.map(row => row.text), ["one"]);
  await voice.saveHugoVoiceHistory.run({ auth: auth(uid), data: { sessionId: "sess_history_1", model: "gpt-realtime-2.1", status: "COMPLETED", durationMs: 5000,
    turns: [{ turnId: "turn_1", responseId: "resp_1", speaker: "HUGO", text: "Respuesta", timestampMs: 1000, durationMs: 1200, interrupted: false, status: "COMPLETED", transcriptionStatus: "REALTIME_NATIVE" }], events: [] } });
  const own = await voice.getHugoVoiceSession.run({ auth: auth(uid), data: { sessionId: "sess_history_1" } });
  assert.equal(own.turns[0].text, "Respuesta");
  await assert.rejects(() => voice.getHugoVoiceSession.run({ auth: auth(otherUid), data: { sessionId: "sess_history_1" } }), error => error.code === "not-found");
  console.log(JSON.stringify({ ok: true, dailyBounds: true, pagination: true, isolation: true, voiceSession: true }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });

