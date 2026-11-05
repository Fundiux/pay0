// Emulator gate: the real frontend orchestration (src/services/iqHistoricalImport.ts)
// drives the real P4 engine (functions/lib) against the Firestore emulator.
// Only the IQ HTTP boundary is faked (profile access + fetchIq); everything the
// engine does with Firestore, manifests, scopes, approvals, canary, resume and
// verification is production code. Run through iq-historical-sync-chain-emulator-run.ps1.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

if (process.env.GCLOUD_PROJECT !== "demo-pay0" || !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || "")) throw Error("DEMO_LOOPBACK_REQUIRED");
process.env.IQ_CREDENTIALS_KEY = "demo-secret-never-used";
global.fetch = async () => { throw Error("EXTERNAL_NETWORK_FORBIDDEN"); };

const root = path.resolve(__dirname, "..", "..");
const lib = (file) => path.join(root, "functions/lib/modules", file);
const ROOT_UID = "Ab4z0RttIqXbZFT0NuWsDjBkt6J2"; // EBASOR, the R3 policy root
const BETELL_UID = "lcOz4nO5DTbksM3Lbz3hJcCpCdu1";
const ELIUT_PROFILE = "bEGPMuplqNHMZ3lvYkeb";
const CLIENT_NAME = "CLIENTE DEMO SA DE CV";
const COMPANY_NAME = "EMPRESA DEMO";

// ---------------------------------------------------------------------------
// Fake IQ. Two groups exist in the engine; only ELIUT's profile has rows.
// ---------------------------------------------------------------------------
const PROFILES = {
  [ELIUT_PROFILE]: { username: "ELIUT", associatedName: "ELIUT" },
  Q3TaFdNTdR2mLPh7KcTi: { username: "RR", associatedName: "RR" },
  LxyRRZrJsAYoiAU62scb: { username: "RR", associatedName: "RR" },
};
const financial = (extra) => ({ client: CLIENT_NAME, company: COMPANY_NAME, currency: "MXN", operation_status: "EN OPERACION", ...extra });
const IQ = {
  "/clients": [{ id: "501", name: CLIENT_NAME, rfc: "CDE010101AAA", status: "ACTIVO" }],
  "/invoices": [
    financial({ id: "7001", invoice_type: "PUE", cfdi_uuid: "UUID-7001", sum: 1000, created_at: "2026-09-03T10:00:00" }),
    financial({ id: "7002", invoice_type: "PUE", cfdi_uuid: "UUID-7002", sum: 500, created_at: "2026-09-06T09:30:00" }),
  ],
  "/deposits": [
    financial({ id: "8001", voucher: "V-8001", deposit_date: "2026-09-04", conciliation_status: "CONCILIADO", sum: 1000, created_at: "2026-09-04T11:00:00" }),
    financial({ id: "8002", voucher: "V-8002", deposit_date: "2026-09-07", conciliation_status: "CONCILIADO", sum: 500, created_at: "2026-09-07T11:00:00" }),
  ],
  "/payment_applications": [
    financial({ id: "9001", invoice_id: "7001", deposit_id: "8001", applied_amount: 1000, sum: 1000, created_at: "2026-09-05T12:00:00" }),
    financial({ id: "9002", invoice_id: "7002", deposit_id: "8002", applied_amount: 500, sum: 500, created_at: "2026-09-08T12:00:00" }),
  ],
};
const iqMetrics = { reads: 0, writes: 0 };
function serve(profileId, url) {
  const match = url.pathname.match(/^(\/[a-z_]+)(?:\/([^/]+))?$/);
  assert.ok(match, `unexpected IQ path ${url.pathname}`);
  const [, endpoint, pathId] = match;
  if (PROFILES[profileId].username !== "ELIUT") return [];
  const rows = IQ[endpoint] || [];
  const id = pathId || url.searchParams.get("id");
  if (id) return rows.filter((row) => row.id === id);
  if (Number(url.searchParams.get("offset") || 0) > 0) return [];
  const start = url.searchParams.get("start_date"), end = url.searchParams.get("end_date");
  if (start && end) return rows.filter((row) => String(row.created_at).slice(0, 10) >= start && String(row.created_at).slice(0, 10) <= end);
  return rows;
}
const access = require(lib("iq/iqCanonicalAccess.js"));
access.loadIqCanonicalProfileById = async ({ profileId }) => ({ profileId, profileAlias: profileId, ...PROFILES[profileId], password: "", erpUrl: "http://iq.invalid" });
access.openIqCanonicalSession = async ({ access: row }) => ({ apiOrigin: "http://iq.invalid", accessToken: `token-${row.profileId}` });
const http = require(lib("iq/iqHttpClient.js"));
http.fetchIq = async (input, init = {}) => {
  const url = new URL(String(input instanceof URL ? input.href : input));
  if (String(init.method || "GET").toUpperCase() !== "GET") { iqMetrics.writes++; throw Error("IQ_WRITE_FORBIDDEN"); }
  const profileId = String(init.headers?.Authorization || "").replace("Bearer token-", "");
  iqMetrics.reads++;
  const rows = serve(profileId, url);
  return { ok: true, status: 200, json: async () => rows };
};

// ---------------------------------------------------------------------------
// Real engine + real frontend service.
// ---------------------------------------------------------------------------
const admin = require(path.join(root, "functions/node_modules/firebase-admin"));
if (!admin.apps.length) admin.initializeApp({ projectId: "demo-pay0" });
const db = admin.firestore();
const { manageP4HistoricalIqImport } = require(lib("iqHistoricalImport/service.js"));
const { R3_OPERATIONAL_POLICY, R3_OPERATIONAL_POLICY_HASH } = require(lib("iqHistoricalImport/r3OperationalPolicy.js"));

const calls = [], executions = [];
async function invoke(data) {
  calls.push(String(data.mode));
  try {
    const reply = await manageP4HistoricalIqImport.run({ data, auth: { uid: ROOT_UID, token: { uid: ROOT_UID } }, rawRequest: {} });
    if (data.mode === "PREVIEW_SCOPE") console.error(JSON.stringify({ step: "PREVIEW", scopeId: reply.scope?.scopeId, selected: reply.selected, excluded: (reply.scope?.excluded || []).map((row) => `${row.iqEntityId}:${row.reason}`) }));
    if (data.mode === "VERIFY_SCOPE") console.error(JSON.stringify({ step: "VERIFY", scopeId: data.scopeId, summary: reply.summary, scopeComplete: reply.scopeComplete }));
    if (/^(EXECUTE|RESUME)_SCOPE$/.test(String(data.mode))) {
      executions.push({ mode: data.mode, executionMode: data.executionMode, status: reply.status, batch: reply.batch });
      console.error(JSON.stringify({ step: data.mode, executionMode: data.executionMode, status: reply.status, batch: reply.batch }));
    }
    return reply;
  } catch (error) {
    if (error && error.code && error.httpErrorCode) throw Object.assign(new Error(error.message), { code: `functions/${error.code}`, details: error.details });
    throw error;
  }
}
function loadFrontendService() {
  const ts = require(path.join(root, "node_modules/typescript"));
  const source = fs.readFileSync(path.join(root, "src/services/iqHistoricalImport.ts"), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const deps = {
    "firebase/functions": { httpsCallable: (_functions, name, _options) => { assert.equal(name, "manageP4HistoricalIqImport"); return async (data) => ({ data: await invoke(data) }); } },
    "@/lib/firebaseClient": { functions: {} },
  };
  const exports = {};
  new Function("exports", "require", code)(exports, (name) => { assert.ok(name in deps, `unexpected frontend dependency ${name}`); return deps[name]; });
  return exports;
}

async function seed() {
  const batch = db.batch();
  batch.set(db.doc(`users/${ROOT_UID}`), { role: "superadmin", rootId: ROOT_UID, active: true, username: "EBASOR", displayName: "EBASOR" });
  batch.set(db.doc(`users/${BETELL_UID}`), { role: "admin", rootId: ROOT_UID, active: true, username: "BETELL", displayName: "BETELL" });
  batch.set(db.doc("companies/company-demo"), { rootId: ROOT_UID, nombre: COMPANY_NAME, despachoId: "despacho-demo", companyNumber: 7 });
  await batch.commit();
  const activated = await invoke({ mode: "ACTIVATE_R3_OPERATIONAL_POLICY", confirmation: `ACTIVATE_R3_POLICY:${R3_OPERATIONAL_POLICY.policyVersion}:${R3_OPERATIONAL_POLICY_HASH}` });
  assert.equal(activated.ok, true, "R3 policy must activate");
}

// Diagnostics when a plan does not match expectations: planner summary plus every action's operation and reason.
async function dumpManifest(manifestId, plan) {
  const { decodeManifestChunks } = require(lib("iqHistoricalImport/manifestStorage.js"));
  const ref = db.collection("p4ImportManifests").doc(manifestId);
  const [snap, chunks] = await Promise.all([ref.get(), ref.collection("chunks").orderBy("index").get()]);
  const manifest = decodeManifestChunks(chunks.docs.map((doc) => String(doc.get("payload") || "")));
  console.error(JSON.stringify({
    planningSummary: snap.get("planningSummary"),
    planningMetrics: snap.get("planningMetrics"),
    previewCounts: plan.preview.counts,
    excluded: plan.preview.scope.excluded,
    actions: manifest.actions.map((action) => ({ entityType: action.entityType, iqEntityId: action.iqEntityId, operation: action.operation, reason: action.reason, readiness: action.canonicalEvidence?.readiness, reviewReasons: action.canonicalEvidence?.reviewReasons, date: action.historicalTime?.normalizedDate, deps: action.dependencies })),
  }, null, 1));
}

async function imported(collection) {
  const snap = await db.collection(collection).where("rootId", "==", ROOT_UID).get();
  return snap.docs.map((doc) => doc.data()).filter((row) => row.source === "IQ_IMPORT");
}

async function main() {
  await seed();
  const service = loadFrontendService();
  const period = { month: "2026-09", block: "01_10" };
  const phases = [];
  const onProgress = (progress) => phases.push(progress.phase);
  let checks = 0;

  // Layer 1: the client does not exist in PAY0, so only the client is executable.
  const plan1 = await service.prepareP4Sync(period);
  if (plan1.writes !== 1) await dumpManifest(plan1.manifestId, plan1);
  console.error(JSON.stringify({ step: "plan1", writes: plan1.writes, planned: plan1.planned, excluded: plan1.excluded, counts: plan1.preview.counts }));
  assert.equal(plan1.writes, 1); assert.equal(plan1.planned.clientes, 1); assert.ok(plan1.excluded.review >= 6, "invoices, deposits and applications wait for the client"); checks += 3;
  const result1 = await service.runP4Sync(plan1, onProgress);
  console.error(JSON.stringify({ step: "run1", result: result1, phases, calls, clients: (await db.collection("clients").get()).docs.map((doc) => ({ id: doc.id, rootId: doc.get("rootId"), source: doc.get("source"), p4ActionId: doc.get("p4ActionId") })) }));
  assert.equal(result1.ok, true, JSON.stringify(result1)); assert.equal(result1.summary.pending, 0); checks += 2;
  const clients = await imported("clients");
  assert.equal(clients.length, 1); assert.equal(clients[0].originalIqEntityId, "501"); assert.equal(clients[0].adminId, ROOT_UID); checks += 3;

  // Layer 2: with the client in place, invoices, deposits and applications become executable.
  const plan2 = await service.prepareP4Sync(period);
  console.error(JSON.stringify({ step: "plan2", writes: plan2.writes, planned: plan2.planned, excluded: plan2.excluded, counts: plan2.preview.counts }));
  // The client now exists with a strong IQ link, so the planner marks it NO_OP and the scope lists it as unchanged.
  assert.deepEqual({ ...plan2.planned }, { solicitudes: 2, pagos: 2, aplicaciones: 2, clientes: 0, conciliaciones: 0 }); assert.equal(plan2.writes, 6); assert.equal(plan2.excluded.unchanged, 1); checks += 3;
  phases.length = 0; calls.length = 0; executions.length = 0;
  const result2 = await service.runP4Sync(plan2, onProgress);
  assert.equal(result2.ok, true, JSON.stringify(result2)); assert.equal(result2.summary.pending, 0); assert.equal(result2.summary.failed, 0); assert.equal(result2.summary.completed, 6); checks += 4;
  // The canary must really write one row even though its client dependency is a NO_OP in this manifest.
  assert.equal(executions[0].executionMode, "CANARY"); assert.equal(executions[0].batch.completed, 1);
  assert.equal(executions[executions.length - 1].status, "COMPLETED"); assert.equal(executions.reduce((sum, row) => sum + row.batch.completed, 0), 6); checks += 4;
  for (const phase of ["CANARIO", "VERIFICANDO", "CONTINUANDO", "COMPLETO"]) { assert.ok(phases.includes(phase), `phase ${phase}`); checks++; }
  const chain = calls.join(" ");
  assert.match(chain, /PREVIEW_SCOPE APPROVE_SCOPE EXECUTE_SCOPE VERIFY_SCOPE/, "canary is approved on a fresh preview");
  assert.match(chain, /PREVIEW_SCOPE APPROVE_SCOPE RESUME_SCOPE VERIFY_SCOPE/, "each resume is approved on a fresh preview");
  assert.ok(!chain.includes("LIST_MANIFESTS")); checks += 3;
  assert.equal((await imported("solicitudes")).length, 2); assert.equal((await imported("pagos")).length, 2); checks += 2;
  const applications = await imported("pagoAplicaciones");
  assert.equal(applications.length, 2); assert.ok(applications.every((row) => row.importManifestId === plan2.manifestId)); checks += 2;

  // The scope the operator confirmed is stale after the canary: reusing its ids must be
  // rejected by the server. This is the blocker the chain above avoids.
  await assert.rejects(
    () => invoke({ mode: "RESUME_SCOPE", executionMode: "SCOPED_FULL", manifestId: plan2.manifestId, manifestHash: plan2.manifestHash, scope: plan2.preview.scope.request, scopeId: plan2.preview.scope.scopeId, scopeHash: plan2.preview.scope.scopeHash, selectorVersion: plan2.preview.scope.selectorVersion, budget: plan2.preview.budget }),
    (error) => error.code === "functions/failed-precondition" && error.message === "P4_SCOPE_APPROVAL_MISMATCH",
  ); checks++;

  // Layer 3: nothing left. The page shows "ya sincronizado" because the exclusions are COMPLETED.
  const plan3 = await service.prepareP4Sync(period);
  console.error(JSON.stringify({ step: "plan3", writes: plan3.writes, excluded: plan3.excluded }));
  // A fresh plan sees the written rows as strong IQ links (NO_OP), so they are "unchanged" rather than "completed".
  assert.equal(plan3.writes, 0); assert.equal(plan3.excluded.unchanged, 7); assert.equal(plan3.excluded.review, 0); checks += 3;

  assert.equal(iqMetrics.writes, 0); assert.ok(iqMetrics.reads > 0); checks += 2;
  console.log(JSON.stringify({ mode: "IQ_HISTORICAL_SYNC_CHAIN_EMULATOR", checks, writes: { clients: 1, solicitudes: 2, pagos: 2, pagoAplicaciones: 2 }, layers: 2, resumeRounds: result2.rounds, iqReads: iqMetrics.reads, iqWrites: iqMetrics.writes, callChainLayer2: chain }));
}

main().then(() => process.exit(0)).catch((error) => { console.error({ error: "IQ_HISTORICAL_SYNC_CHAIN_EMULATOR_FAILED", code: error.code || "ASSERTION", message: error.message, details: error.details }); process.exit(1); });
