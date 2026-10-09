const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const { test } = require("node:test");
const exportsUnderTest = {};
function loadPure(file) { const output={}; const path=require("node:path"); new Function("exports","require",ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText)(output,name=>loadPure(path.resolve(path.dirname(file),name+".ts")));return output; }
class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
const source = ts.transpileModule(fs.readFileSync("functions/src/modules/agent007/firestoreHugoDataStore.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const deps = { "firebase-admin/firestore": {}, "firebase-functions/v2/https": { HttpsError }, "node:crypto": require("node:crypto"), "./hugoCore/memoryContract": { MEMORY_CONTRACT_VERSION: 1 }, "./hugoCore/conversationState": {}, "./hugoCore/evidenceIdentity": loadPure("functions/src/modules/agent007/hugoCore/evidenceIdentity.ts") };
new Function("exports", "require", source)(exportsUnderTest, name => { assert.ok(Object.hasOwn(deps, name), name); return deps[name]; });
const stamp = ms => ({ toMillis: () => ms, toDate: () => new Date(ms) });
function harness(changeBeforeCommit) {
  const rows = new Map([
    ["agent007Observations/observation", { rootId: "root-a", caseId: "case", caseType: "SOLICITUD", sourceSystem: "PAY0", source: "ACTIVITY_LOG", createdAt: stamp(1000), sourceEvent: "OBSERVED" }],
    ["agent007Memory/decision", { rootId: "root-a", kind: "DECISION", status: "CONFIRMED", entityReference: { sourceSystem: "PAY0", entityType: "SOLICITUD", entityId: "case" }, links: { observationId: "observation" }, decision: { decisionAt: new Date(2000).toISOString(), decisionType: "APPROVE" } }],
    ["agent007Observations/outcome", { rootId: "root-a", caseId: "case", caseType: "SOLICITUD", sourceSystem: "PAY0", source: "ACTIVITY_LOG", createdAt: stamp(3000), sourceEvent: "SOLICITUD_COMPLETADA" }],
  ]);
  let mutations = 0, attempts = 0, hook = changeBeforeCommit;
  const snapshot = key => { const row = rows.get(key); return { exists: !!row, data: () => row }; };
  const create = (ref, row) => { assert.ok(!rows.has(ref.key), "duplicate creation"); rows.set(ref.key, row); mutations++; };
  const db = {
    collection: name => ({ doc: id => ({ key: `${name}/${id}`, get: async () => snapshot(`${name}/${id}`), create: async function(row) { if (hook) { const fn=hook; hook=null; fn(rows); } create(this,row); } }) }),
    runTransaction: async fn => {
      for (;;) {
        attempts++;
        const writes=[], reads=new Map();
        const result=await fn({ get: async ref => { reads.set(ref.key, rows.get(ref.key)); return snapshot(ref.key); }, create: (ref,row) => writes.push([ref,row]) });
        // Simulate Firestore detecting changed read versions and retrying before any write.
        if (hook) { const change=hook; hook=null; change(rows); }
        if ([...reads].some(([key,version]) => rows.get(key) !== version)) continue;
        for (const [ref,row] of writes) create(ref,row);
        return result;
      }
    },
  };
  return { rows, store: new exportsUnderTest.FirestoreHugoDataStore(db), get mutations() { return mutations; }, get attempts() { return attempts; } };
}
const promote = h => h.store.linkVerifiedExperience("root-a", "observation", "decision", "outcome");
const denied = h => assert.rejects(promote(h), error => error.code === "failed-precondition");
test("valid chronological evidence promotes once and replay is idempotent", async () => {
 const h=harness(); const first=await promote(h); assert.equal(first.created,true); assert.deepEqual(await promote(h), {id:first.id,created:false}); assert.equal(h.mutations,1);
 const row=h.rows.get(`agent007Memory/${first.id}`); assert.equal(row.status,"CONFIRMED"); assert.equal(row.rootId,"root-a"); assert.equal(row.verification.outcomeKnown,true);
});
for (const date of ["not-a-date", "", "2026-99-99"]) test(`invalid decision chronology fails closed: ${date || "empty"}`, async () => {
 const h=harness(); h.rows.get("agent007Memory/decision").decision.decisionAt=date; await denied(h); assert.equal(h.mutations,0);
});
for (const key of ["agent007Observations/observation", "agent007Memory/decision", "agent007Observations/outcome"]) test(`foreign root evidence denied: ${key}`, async () => {
 const h=harness(); h.rows.get(key).rootId="root-b"; await denied(h); assert.equal(h.mutations,0);
});
for (const change of ["REJECTED", "SUPERSEDED", "foreign-root"]) test(`source change at commit cannot promote stale authority: ${change}`, async () => {
 const h=harness(rows=>{ const old=rows.get("agent007Memory/decision"); rows.set("agent007Memory/decision", {...old,...(change==="foreign-root"?{rootId:"root-b"}:{status:change})}); });
 await denied(h); assert.equal(h.mutations,0); assert.equal(h.attempts,2);
});
for (const ms of [NaN, Infinity, 0, -1, 4000]) test(`invalid observation time rejected: ${ms}`, async () => {
 const h=harness(); h.rows.get("agent007Observations/observation").createdAt=stamp(ms); await denied(h); assert.equal(h.mutations,0);
});
test("outcome before decision rejected",async()=>{const h=harness();h.rows.get("agent007Observations/outcome").createdAt=stamp(1500);await denied(h);assert.equal(h.mutations,0);});

test("existing deterministic destination with foreign root denied",async()=>{
 const h=harness();const first=await promote(h);h.rows.get(`agent007Memory/${first.id}`).rootId="root-b";await denied(h);assert.equal(h.mutations,1);
});
