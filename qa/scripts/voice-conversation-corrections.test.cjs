const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const crypto = require("node:crypto");
const ts = require("../../functions/node_modules/typescript");
const file = path.resolve(__dirname, "../../functions/src/modules/agent007/voiceConversationCorrections.ts");
const source = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 } }).outputText;
const loaded = new Module(file, module);
loaded.filename = file;
loaded.paths = module.paths;
loaded.require = name => {
  if (name === "firebase-functions/v2/https") return { HttpsError: class extends Error { constructor(code, message) { super(message); this.code = code; } } };
  // This suite tests the voice resolver; canonical authorization/transaction is tested by the shared helper suite.
  if (name === "./conversationCorrections") return { persistConversationCorrection: async (db, input, resolve) => {
    const resolved = await resolve(db.tx);
    db.received = { input, resolved };
    return { id: "correction1", correction: { version: input.expectedVersion + 1, content: input.content } };
  } };
  return require(name);
};
loaded._compile(source, file);
const { persistVoiceConversationCorrection, voiceCorrectionSourceResolver, voiceCorrectionSourceId } = loaded.exports;

function fixture() {
  const input = { uid: "actor", rootId: "root", gatewayCallId: "rtc1", sessionId: "sess1", turnId: "turn1", responseId: "response1", correctionTurnId: "turn2", correction: "Prefiero el periodo antes del total.", expectedVersion: 0 };
  const conversationId = "root_actor_global", base = `agent007Conversations/${conversationId}/voiceSessions/sess1`;
  const a = { rootId: "root", ownerUid: "actor", sessionId: "sess1", speaker: "HUGO", turnId: "turn1", responseId: "response1", status: "COMPLETED", interrupted: false, text: "Respuesta anterior", timestampMs: 100 };
  const c = { rootId: "root", ownerUid: "actor", sessionId: "sess1", speaker: "USER", turnId: "turn2", transcriptionStatus: "REALTIME_NATIVE", text: input.correction, timestampMs: 200 };
  const session = { rootId: "root", ownerUid: "actor", sessionId: "sess1", conversationId, gatewayCallId: "rtc1", status: "ACTIVE" };
  const userId = crypto.createHash("sha256").update("turn2:USER:input").digest("hex").slice(0, 40);
  const rows = new Map([[base, session], [`${base}/turns/${voiceCorrectionSourceId("turn1", "response1")}`, a], [`${base}/turns/${userId}`, c]]);
  const ref = p => ({ path: p, collection: name => ({ doc: id => ref(`${p}/${name}/${id}`) }) });
  const db = { doc: ref, tx: { get: async r => ({ data: () => rows.get(r.path) }) } };
  return { input, db, session, a, c, rows };
}

test("voice adapter binds exact persisted source and returns ACK only after shared helper", async () => {
  const f = fixture(), result = await persistVoiceConversationCorrection(f.db, f.input);
  assert.equal(result.persisted, true);
  assert.equal(result.scope, "SESSION");
  assert.equal(result.correctionId, "correction1");
  assert.equal(result.version, 1);
  assert.equal(f.db.received.input.content, f.c.text);
  assert.equal(f.db.received.resolved.provenance.transcriptAuthority, "CLIENT_TRANSCRIPT_NOT_FACT");
  assert.equal(f.db.received.resolved.data.sourceText, f.a.text);
});

test("foreign root/owner/session/gateway and ended session never reach acknowledgment", async () => {
  for (const [part, field, value] of [["session", "rootId", "foreign"], ["session", "ownerUid", "foreign"], ["session", "gatewayCallId", "other"], ["session", "status", "COMPLETED"], ["a", "rootId", "foreign"], ["a", "ownerUid", "foreign"], ["c", "sessionId", "foreign"]]) {
    const f = fixture(); f[part][field] = value;
    await assert.rejects(persistVoiceConversationCorrection(f.db, f.input), error => error.code === "failed-precondition");
    assert.equal(f.db.received, undefined);
  }
});

test("missing, interrupted, invented or failed native transcripts fail closed", async () => {
  for (const mutate of [f => f.rows.clear(), f => { f.a.interrupted = true; }, f => { f.a.status = "IN_PROGRESS"; }, f => { f.a.speaker = "USER"; }, f => { f.c.transcriptionStatus = "FAILED"; }, f => { f.c.text = "different user text"; }, f => { f.c.timestampMs = 50; }, f => { f.input.responseId = "invented"; }]) {
    const f = fixture(); mutate(f);
    await assert.rejects(persistVoiceConversationCorrection(f.db, f.input));
    assert.equal(f.db.received, undefined);
  }
});

test("invalid IDs and versions are rejected before any source read", async () => {
  for (const delta of [{ sessionId: "../foreign" }, { correctionTurnId: "" }, { expectedVersion: -1 }, { expectedVersion: 0.5 }, { correction: "x".repeat(1001) }]) {
    const f = fixture(); let reads = 0; f.db.tx.get = () => { reads++; throw Error("UNEXPECTED_READ"); };
    await assert.rejects(persistVoiceConversationCorrection(f.db, { ...f.input, ...delta }), error => error.code === "invalid-argument");
    assert.equal(reads, 0);
  }
});

test("resolver constructs provenance from validated origin without accepting role or source text", async () => {
  const f = fixture();
  const result = await voiceCorrectionSourceResolver(f.db, { ...f.input, role: "owner", sourceText: "invented" })(f.db.tx);
  assert.equal(result.data.sourceText, f.a.text);
  assert.equal(result.provenance.responseId, "response1");
  assert.equal(result.data.role, undefined);
});
