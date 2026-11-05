// Contract test: the IQ reverse-sync page only asks for a period and a
// confirmation; the service chains the P4 engine modes in the safe order and
// never lets the browser pick manifests, scope members or budgets above the
// approved ones.
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

test("prepare: PLAN for the period, then a read-only PREVIEW_SCOPE on that manifest", () => {
  const prepare = service.slice(service.indexOf("export async function prepareP4Sync"), service.indexOf("function scopeFields"));
  order(prepare, ['mode: "PLAN"', "profileGroups: PLAN_GROUPS", 'mode: "PREVIEW_SCOPE"', "manifestId: planned.manifestId", "manifestHash: planned.manifestHash", "preview.readOnly", "expectedIqWrites !== 0", "expectedExternalEffects !== 0"]);
  assert.match(prepare, /"iq-group-rr"|PLAN_GROUPS/, "both IQ groups are planned server side");
});

test("run: APPROVE_SCOPE, one-write CANARY, VERIFY_SCOPE, bounded RESUME_SCOPE, stop on first failure", () => {
  const run = service.slice(service.indexOf("export async function runP4Sync"));
  order(run, ['mode: "APPROVE_SCOPE"', "confirmation: `APPROVE_SCOPE:", 'mode: "EXECUTE_SCOPE"', 'executionMode: "CANARY"', "budget: canaryBudget", "verifyScope(preview.scope.scopeId)", "summary.failed > 0", "MAX_RESUME_ROUNDS", 'mode: "RESUME_SCOPE"', 'executionMode: "SCOPED_FULL"', "budget: preview.budget"]);
  assert.match(service, /mode: "VERIFY_SCOPE"/, "verification uses VERIFY_SCOPE");
  assert.match(service, /const canaryBudget[^;]*maxActions: 1, maxWrites: 1/, "the canary writes at most one record");
  assert.match(service, /const MAX_RESUME_ROUNDS = \d+/, "resume rounds per confirmation are bounded");
});

test("the browser never selects manifests, members or raw budgets", () => {
  const payloads = [...service.matchAll(/callP4<[^>]*>\(\{([\s\S]*?)\}\)/g)].map((row) => row[1]).join("\n");
  for (const forbidden of ["LIST_MANIFESTS", "actionId", "actionIds", "targetPath", "componentId", "maxWrites: 100"]) {
    assert.ok(!payloads.includes(forbidden), `callable payloads must not send ${forbidden}`);
  }
  for (const forbidden of ["LIST_MANIFESTS", "actionIds", "targetPath", "componentId", "maxWrites: 100"]) {
    assert.ok(!service.includes(forbidden), `service must not send ${forbidden}`);
  }
  for (const forbidden of ["manifestId", "scopeHash", "LIST_MANIFESTS", "APROBAR", "EJECUTAR 1", "CONTINUAR", "<select"]) {
    const hits = page.split(forbidden).length - 1;
    const allowed = forbidden === "<select" ? 1 : 0;
    assert.equal(hits, allowed, `page must not expose ${forbidden}`);
  }
  assert.match(page, /type="month"/, "the page asks for a month");
  assert.match(page, /Confirmar y escribir/, "writes happen only after an explicit confirmation");
});

test("period ranges match the server MONTH_BLOCK selector", () => {
  const body = service.slice(service.indexOf("export function periodRange"), service.indexOf("function tally"));
  assert.match(body, /"01_10" \? "01" : period.block === "11_20" \? "11" : "21"/);
  assert.match(body, /"01_10" \? "10" : period.block === "11_20" \? "20"/);
  assert.match(body, /setUTCDate\(0\)/, "21_END ends on the last day of the month");
});
