// Contract test: the IQ reverse-sync page only asks for a period and a
// confirmation; the service chains the P4 engine modes in the safe order,
// re-previews and re-approves the scope before every execution, and never lets
// the browser pick manifests, scope members or budgets above the approved ones.
// The behavioural proof lives in iq-historical-sync-chain-emulator.test.cjs.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const service = read("src/services/iqHistoricalImport.ts");
const page = read("src/app/integraciones/iq/historico/page.tsx");

function order(source, markers) {
  let cursor = -1;
  for (const marker of markers) {
    const at = source.indexOf(marker, cursor + 1);
    assert.ok(at > cursor, `expected "${marker}" after position ${cursor}`);
    cursor = at;
  }
}
const slice = (from, to) => service.slice(service.indexOf(from), to ? service.indexOf(to) : undefined);

test("prepare: PLAN for the period, then a read-only PREVIEW_SCOPE on that manifest", () => {
  const prepare = slice("export async function prepareP4Sync", "function scopeFields");
  order(prepare, ['mode: "PLAN"', "profileGroups: PLAN_GROUPS", "previewScope(planned.manifestId, planned.manifestHash", "assertReadOnlyPreview(preview)"]);
  assert.match(service, /mode: "PREVIEW_SCOPE"/);
  assert.match(slice("function assertReadOnlyPreview", "function previewScope"), /readOnly[\s\S]*expectedIqWrites !== 0[\s\S]*expectedExternalEffects !== 0/);
});

test("every execution runs on a freshly previewed and approved scope that stays within what the operator confirmed", () => {
  const refresh = slice("async function refreshScope", "async function approveScope");
  order(refresh, ["previewScope(plan.manifestId, plan.manifestHash, request)", "assertReadOnlyPreview(preview)", "fresh.month !== request.month", "confirmed.has(member.actionId)", 'row.reason === "COMPLETED"']);
  const next = slice("async function nextScope", "// Canario");
  order(next, ["refreshScope(plan, confirmed)", "fresh.unseen > 0", '"ALCANCE_CAMBIADO"', "fresh.review > 0", '"REQUIERE_REVISION"', "selected === 0", "done(summary)", "approveScope(fresh.preview)"]);
  assert.match(slice("async function approveScope", "function executeScope"), /mode: "APPROVE_SCOPE"[\s\S]*confirmation: `APPROVE_SCOPE:/);
});

test("run: canary of one write with a bounded retry, VERIFY_SCOPE after each execution, bounded resume rounds, stop on the first failure or when nothing advances", () => {
  const run = slice("export async function runP4Sync");
  order(run, [
    'nextScope("CANARIO"', '"EXECUTE_SCOPE" : "RESUME_SCOPE"', '"CANARY" : "SCOPED_FULL"', "canaryBudget", "verifyScope(step.fresh.preview.scope.scopeId)", '"CANARIO_FALLIDO"', "batch?.completed || 0) === 1",
    '"SIN_ANCE"'.replace("ANCE", "AVANCE"), "MAX_RESUME_ROUNDS", '"TOPE_DE_LOTES"', 'nextScope("CONTINUANDO"', '"RESUME_SCOPE", "SCOPED_FULL", scopeBudget', "verifyScope(step.fresh.preview.scope.scopeId)", '"PAUSED_ERROR"', '"REGISTROS_FALLIDOS"', "batch?.processed || 0) === 0", '"REQUIERE_REVISION"',
  ]);
  assert.match(service, /const canaryBudget[^;]*maxActions: 1, maxWrites: 1/, "the canary writes at most one record");
  assert.match(service, /const MAX_CANARY_ATTEMPTS = \d+/);
  assert.match(service, /const MAX_RESUME_ROUNDS = \d+/);
  assert.match(service, /mode: "VERIFY_SCOPE"/);
});

test("the browser never selects manifests, members or raw budgets, and never reuses a stale scope id", () => {
  const payloads = [...service.matchAll(/callP4<[^>]*>\(\{([\s\S]*?)\}\)/g)].map((row) => row[1]).join("\n");
  for (const forbidden of ["LIST_MANIFESTS", "actionId", "actionIds", "targetPath", "componentId", "maxWrites: 100", "plan.scopeId", "plan.preview.scope.scopeId"]) {
    assert.ok(!payloads.includes(forbidden), `callable payloads must not send ${forbidden}`);
  }
  assert.ok(!service.includes("LIST_MANIFESTS"));
  for (const forbidden of ["scopeHash", "LIST_MANIFESTS", "APROBAR", "EJECUTAR 1", "CONTINUAR", "<select"]) {
    const hits = page.split(forbidden).length - 1;
    assert.equal(hits, forbidden === "<select" ? 1 : 0, `page must not expose ${forbidden}`);
  }
  assert.match(page, /type="month"/, "the page asks for a month");
  assert.match(page, /Confirmar y escribir/, "writes happen only after an explicit confirmation");
});

test("the page retries only after a batch cap, re-prepares after success without auto-approving, and shows the audit ids", () => {
  assert.match(page, /const canRetry = result\?\.stoppedReason === "TOPE_DE_LOTES"/);
  assert.match(page, /showConfirm = plan !== null && plan\.writes > 0 && \(!result \|\| canRetry\)/);
  assert.match(page, /if \(outcome\.ok && followUp < MAX_FOLLOW_UPS\)[\s\S]*await prepare\(followUp \+ 1\)/);
  // A follow-up layer with writes clears the previous result so the confirm button is offered again;
  // without writes it only closes the progress panel.
  const prepare = page.slice(page.indexOf("async function prepare"), page.indexOf("async function confirm"));
  assert.match(prepare, /if \(nextFollowUp > 0\) \{[\s\S]*if \(next\.writes > 0\) \{ setResult\(null\); setProgress\(null\); \}[\s\S]*else setProgress\(/);
  assert.ok(!/runP4Sync\([^)]*\)[\s\S]{0,200}runP4Sync\(/.test(page.slice(page.indexOf("async function confirm"))), "a follow-up layer needs a new confirmation");
  for (const code of ["P4_SCOPE_MANIFEST_MISMATCH", "P4_SCOPE_NOT_FOUND", "P4_SCOPE_BUDGET_EXCEEDS_APPROVAL", "P4_SCOPE_FENCE_CONFLICT", "P4_SCOPE_HISTORICAL_EVIDENCE_VERSION_MISMATCH"]) {
    assert.ok(page.includes(`${code}: "`), `ERROR_COPY covers ${code}`);
  }
  assert.ok(!service.includes("en tres intentos"), "the canary attempt count is interpolated, not hard-coded");
  assert.match(page, /P4_SCOPE_APPROVAL_MISMATCH: "Se escribieron registros/);
  assert.match(page, /Plan \{plan\.manifestId\} · alcance \{plan\.scopeId\}/);
  assert.match(page, /alreadySynced = plan !== null && plan\.writes === 0 && \(plan\.excluded\.completed > 0 \|\| plan\.excluded\.unchanged > 0\)/);
});

test("period ranges match the server MONTH_BLOCK selector", () => {
  const body = slice("export function periodRange", "function tally");
  assert.match(body, /"01_10" \? "01" : period.block === "11_20" \? "11" : "21"/);
  assert.match(body, /"01_10" \? "10" : period.block === "11_20" \? "20"/);
  assert.match(body, /setUTCDate\(0\)/, "21_END ends on the last day of the month");
});
