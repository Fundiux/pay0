const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const root = path.resolve(__dirname, "../..");
const ts = require("../../functions/node_modules/typescript");

function load(relative, stubs = {}) {
  const file = path.join(root, relative);
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = new Module(file, module);
  mod.filename = file;
  mod.paths = Module._nodeModulePaths(path.dirname(file));
  const realRequire = mod.require.bind(mod);
  mod.require = (id) => (id in stubs ? stubs[id] : realRequire(id));
  mod._compile(code, file);
  return mod.exports;
}

const { dispersionProgress } = load("src/lib/dispersionClientStatus.ts");
const incident = load("functions/src/modules/iq/dispersionIqIncident.ts", {
  "firebase-admin": {},
  "firebase-admin/firestore": { FieldValue: { serverTimestamp: () => "TS" } },
  "../agentOperations/incidentResolution": { resolveIncident: async () => true },
  "../agentOperations/time": { mexicoDayKey: () => "2026-11-22" },
});

const base = { forwardOnlyVersion: "H4_D82_A3_A2_FORWARD_ONLY_V1", status: "REGISTRADA", fundingSource: { holderType: "CLIENT" } };

test("progress words follow the automatic generation and the receipt", () => {
  assert.equal(dispersionProgress({ ...base }), "EN PROCESO");
  assert.equal(dispersionProgress({ ...base, iqGenerationStatus: "IQ_PENDIENTE" }), "EN PROCESO");
  assert.equal(dispersionProgress({ ...base, iqGenerationStatus: "IQ_PARCIAL" }), "PROCESANDO");
  assert.equal(dispersionProgress({ ...base, iqGenerationStatus: "IQ_REQUIERE_REVISION" }), "PROCESANDO");
  assert.equal(dispersionProgress({ ...base, iqGenerationStatus: "IQ_ERROR_SEGURO" }), "PROCESANDO");
  assert.equal(dispersionProgress({ ...base, iqGenerationStatus: "IQ_GENERADA" }), "GENERADA");
  assert.equal(dispersionProgress({ ...base, iqGenerationStatus: "IQ_GENERADA", iqReceiptStatus: "READY" }), "COMPLETADA");
  assert.equal(dispersionProgress({ ...base, iqGenerationStatus: "IQ_GENERADA", iqReceiptUploadId: "u1" }), "COMPLETADA");
});

test("a rejected dispersion shows RECHAZADA even when a receipt exists", () => {
  assert.equal(dispersionProgress({ ...base, incidentStatus: "RECHAZADA", iqReceiptStatus: "READY" }), "RECHAZADA");
  assert.equal(dispersionProgress({ ...base, reservationStatus: "rechazado" }), "RECHAZADA");
});

test("withdrawals of the user's own funds and legacy rows keep their own status", () => {
  assert.equal(dispersionProgress({ ...base, fundingSource: { holderType: "USER" } }), null);
  assert.equal(dispersionProgress({ status: "REGISTRADA" }), null);
});

test("no progress word names the external system", () => {
  for (const generation of ["", "IQ_PENDIENTE", "IQ_PARCIAL", "IQ_REQUIERE_REVISION", "IQ_ERROR_SEGURO", "IQ_GENERADA"]) {
    assert.doesNotMatch(String(dispersionProgress({ ...base, iqGenerationStatus: generation })), /IQ/i);
  }
});

test("incident decision opens on review or safe error and closes on success", () => {
  assert.equal(incident.dispersionIqIncidentDecision("IQ_REQUIERE_REVISION"), "OPEN");
  assert.equal(incident.dispersionIqIncidentDecision("IQ_ERROR_SEGURO"), "OPEN");
  assert.equal(incident.dispersionIqIncidentDecision("IQ_GENERADA"), "RESOLVE");
  assert.equal(incident.dispersionIqIncidentDecision("IQ_PENDIENTE"), "NONE");
  assert.equal(incident.dispersionIqIncidentDecision("IQ_PARCIAL"), "NONE");
});

test("incident cause is Spanish and never names the external system", () => {
  for (const status of ["IQ_REQUIERE_REVISION", "IQ_ERROR_SEGURO"]) assert.doesNotMatch(incident.dispersionIqIncidentCause(status), /IQ/i);
});

function fakeDb(existing) {
  const writes = [];
  const ref = { id: "ref" };
  return {
    writes,
    collection: () => ({ doc: () => ref }),
    runTransaction: async (fn) => fn({
      get: async () => ({ exists: !!existing, get: (key) => (existing || {})[key] }),
      set: (_ref, data) => writes.push(data),
    }),
  };
}

test("opening is idempotent while an incident is open, and reopens a closed one", async () => {
  const args = { rootId: "r", dispersionId: "d1", aggregateStatus: "IQ_ERROR_SEGURO" };
  const open = fakeDb({ status: "OPEN" });
  await incident.syncDispersionIqIncident({ db: open, ...args });
  assert.equal(open.writes.length, 0);

  const none = fakeDb(null);
  await incident.syncDispersionIqIncident({ db: none, ...args });
  assert.equal(none.writes.length, 1);
  assert.equal(none.writes[0].entityType, "dispersion");
  assert.equal(none.writes[0].status, "OPEN");
  assert.equal(none.writes[0].rootId, "r");

  const closed = fakeDb({ status: "RESOLVED" });
  await incident.syncDispersionIqIncident({ db: closed, ...args });
  assert.equal(closed.writes.length, 1);
});

test("a pending or partial result never writes an incident", async () => {
  const store = fakeDb(null);
  await incident.syncDispersionIqIncident({ db: store, rootId: "r", dispersionId: "d1", aggregateStatus: "IQ_PARCIAL" });
  assert.equal(store.writes.length, 0);
});
