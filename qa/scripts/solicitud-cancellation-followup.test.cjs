const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "../..");
function compile(source, context = {}) {
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, ...context });
  return exports;
}

const { canAutomaticallyRefreshCancellation } = compile(fs.readFileSync(
  path.join(root, "src/lib/solicitudCancellationFollowup.ts"), "utf8",
));
const source = ts.createSourceFile("page.tsx", fs.readFileSync(
  path.join(root, "src/app/solicitudes/page.tsx"), "utf8",
), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let refreshFunction;
let followupEffect;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === "refreshCancellation") {
    refreshFunction = node.initializer.getText(source);
  }
  if (ts.isCallExpression(node) && node.expression.getText(source) === "useEffect" &&
      node.arguments[0]?.getText(source).includes("canAutomaticallyRefreshCancellation(item")) {
    followupEffect = node.arguments[0].getText(source);
  }
  ts.forEachChild(node, visit);
}
visit(source);
assert.ok(refreshFunction && followupEffect, "Exercise the actual page callbacks");

const issued = {
  id: "fixture-ready", folio: "TEST-001", companyId: "fixture-company",
  monto: 116, facturamaInvoiceId: "fixture-invoice", facturamaEnvironment: "PRODUCTION",
  facturamaAutoDraftStatus: "PRODUCTION_ISSUED",
  facturaUuid: "11111111-2222-3333-4444-555555555555", status: "PROCESANDO",
};
const ready = { ...issued, facturamaCancellationStatus: "PENDING" };
const sandboxDraft = {
  id: "fixture-draft", folio: "TEST-002", companyId: "fixture-company", monto: 116,
  facturamaInvoiceId: "fixture-draft-invoice", facturamaAutoDraftStatus: "AUTO_DRAFT_FISCAL_VALIDATED",
};

async function run() {
  assert.equal(canAutomaticallyRefreshCancellation(sandboxDraft, true), false);
  assert.equal(canAutomaticallyRefreshCancellation({ ...ready, facturamaEnvironment: "SANDBOX" }, true), false);
  assert.equal(canAutomaticallyRefreshCancellation({ ...ready, facturamaAutoDraftStatus: "AUTO_DRAFT_NEEDS_RECEIVER_DATA" }, true), false);
  assert.equal(canAutomaticallyRefreshCancellation(issued, true), false, "Missing display/date alone is not cancellation");
  assert.equal(canAutomaticallyRefreshCancellation({ ...issued, status: "EN_SUSTITUCION" }, true), false);
  assert.equal(canAutomaticallyRefreshCancellation(ready, false), false, "Respect superadmin-only callable");
  assert.equal(canAutomaticallyRefreshCancellation(ready, true), true);
  assert.equal(canAutomaticallyRefreshCancellation({ ...ready, facturamaCancellationStatus: "REQUESTED" }, true), true);
  assert.equal(canAutomaticallyRefreshCancellation({ ...issued, sustitucionStatus: "CANCELACION_SOLICITADA" }, true), true);
  assert.equal(canAutomaticallyRefreshCancellation({ ...ready, facturamaEnvironment: undefined }, true), true, "Issued production status supports legacy metadata");
  for (const patch of [
    { id: "" }, { facturamaInvoiceId: "" }, { facturaUuid: "" }, { facturaUuid: "incomplete" },
    { companyId: "" }, { monto: 0 }, { monto: -1 }, { monto: "invalid" },
  ]) assert.equal(canAutomaticallyRefreshCancellation({ ...ready, ...patch }, true), false, JSON.stringify(patch));
  const canceled = { ...issued, status: "CANCELADA", facturamaCancellationStatus: "CANCELED" };
  assert.equal(canAutomaticallyRefreshCancellation(canceled, true), true);
  assert.equal(canAutomaticallyRefreshCancellation({ ...canceled, cancellationReceiptUploadId: "fixture-receipt" }, true), false);
  assert.equal(canAutomaticallyRefreshCancellation({ ...issued, status: "CANCELADA" }, true), false);

  const calls = [];
  const requestSeq = { current: 7 };
  const loadedSeq = { current: 7 };
  const checked = { current: new Set() };
  const effect = compile(`export const runEffect = ${followupEffect};`, {
    solicitudesRequestSeq: requestSeq, loadedSolicitudesRequestSeq: loadedSeq,
    canViewSolicitudes: true, solicitudes: [sandboxDraft, issued, { ...ready, id: "fixture-incomplete", facturaUuid: "" }, ready],
    canAutomaticallyRefreshCancellation, role: "superadmin", isSuperAdmin: role => role === "superadmin",
    checkedCancellationIds: checked,
    refreshCancellation: async (row, seq) => { calls.push({ id: row.id, seq }); },
  }).runEffect;
  effect(); effect();
  assert.deepEqual(calls, [{ id: ready.id, seq: 7 }], "Only one ready cancellation is checked once");
  checked.current.clear(); loadedSeq.current = 6;
  effect();
  assert.equal(calls.length, 1, "Do not query old rows while the next period is loading");

  let rows = [sandboxDraft, ready];
  let errors = {};
  const originalRows = rows;
  const callbacks = {
    solicitudesRequestSeq: requestSeq,
    setPageMsg: () => { throw Error("SAT must not overwrite the list's message"); },
    setSolicitudes: update => { rows = update(rows); },
    setCancellationErrors: update => { errors = update(errors); },
  };
  const fail = compile(`export const refresh = ${refreshFunction};`, {
    ...callbacks,
    refreshFacturamaProductionCancellationStatus: async () => { throw Error("Fixture: metadatos incompletos"); },
  }).refresh;
  await fail(ready, 7);
  assert.equal(rows, originalRows, "A failed SAT read preserves all list rows");
  assert.deepEqual(Object.keys(errors), [ready.id], "The warning belongs only to the affected row");
  assert.match(errors[ready.id], /metadatos incompletos/);

  errors = {};
  await fail(ready, 6);
  assert.equal(Object.keys(errors).length, 0, "Ignore errors from a previous list request");
  const success = compile(`export const refresh = ${refreshFunction};`, {
    ...callbacks,
    refreshFacturamaProductionCancellationStatus: async () => ({ status: "CANCELADO", terminal: true }),
  }).refresh;
  await success(ready, 6);
  assert.equal(rows, originalRows, "Ignore old terminal responses after navigation");
  await success(ready, 7);
  assert.equal(rows.length, 2);
  assert.equal(rows[0], sandboxDraft);
  assert.equal(rows[1].status, "CANCELADA", "Retain genuine cancellation updates");
  console.log(JSON.stringify({ ok: true, checks: ["draft and sandbox excluded", "production readiness", "real cancellation required", "role gate", "one check per loaded row", "row-scoped failure", "stale response ignored", "terminal result retained"], externalActions: 0 }));
}

run().catch(error => { console.error(error); process.exitCode = 1; });
