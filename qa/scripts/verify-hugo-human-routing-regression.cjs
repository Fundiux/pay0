const assert = require("node:assert/strict");
const { buildHugoContextV2 } = require("../../functions/lib/modules/agent007/hugoCore/contextBuilderV2");
const { normalizeConversationState } = require("../../functions/lib/modules/agent007/hugoCore/conversationState");
const { MOVEMENT_CLARIFICATION, normalizePay0Brand, canonicalErrorCategory, formatAuthorizedCapabilities, formatLatestSolicitud, formatSystemCatalog } = require("../../functions/lib/modules/agent007/hugoCore/interactionSemantics");
const { resolveUserReference } = require("../../functions/lib/modules/agent007/platformReadConnector");

const rootId = "root-test";
const resultFor = name => ({ sourceSystem: "PAY0", tool: name, retrievedAt: new Date(0).toISOString(), scope: { rootId }, completeness: "COMPLETE", evidence: [], trace: { latencyMs: 0, result: "OK" }, data:
  name === "countClientsForUser" ? { matchStatus: "EXACT", user: { displayName: "BETELL" }, clientCount: 21 } :
  name === "getLatestSolicitud" ? { item: { id: "opaque", folio: "S00001", cliente: "Cliente autorizado" }, order: { field: "createdAt", direction: "desc" } } :
  name === "getAuthorizedCapabilities" ? { role: "superadmin", modules: { clientes: { view: true } } } :
  name === "getSystemCatalog" ? [{ id: "PAY0", status: "CONNECTED", allowed: true }, { id: "HUGO", status: "CONNECTED", allowed: true }, { id: "ASSETS", status: "NOT_CONNECTED", allowed: true }, { id: "TTT", status: "NOT_CONNECTED", allowed: true }] : null });

async function route(message) {
  const calls = [];
  const built = await buildHugoContextV2({ message, rootId, conversationState: normalizeConversationState(undefined, rootId), router: { execute: async request => { calls.push(request); return resultFor(request.name); } } });
  return { built, calls };
}

(async () => {
  for (const question of ["¿Cuál fue el último movimiento del usuario Betel?", "¿Cuál fue el último movimiento de Evasor?"]) {
    const { built, calls } = await route(question);
    assert.equal(built.clarification, MOVEMENT_CLARIFICATION);
    assert.equal(built.context.errorCategory, "AMBIGUOUS_INTENT");
    assert.equal(calls.length, 0);
  }
  assert.deepEqual((await route("¿Cuántos clientes tiene registrados Betel?")).calls.map(x => x.name), ["countClientsForUser"]);
  assert.deepEqual((await route("¿Qué cliente hizo la última solicitud?")).calls.map(x => x.name), ["getLatestSolicitud"]);
  assert.deepEqual((await route("¿Evasor cuántos clientes tiene?")).calls.map(x => x.name), ["countClientsForUser"]);
  assert.deepEqual((await route("Soy superadmin, ¿por qué no puedo verlo?")).calls.map(x => x.name), ["getAuthorizedCapabilities", "getLastOperationDiagnostic"]);
  assert.deepEqual((await route("¿Cuáles son los tres sistemas que manejamos?")).calls.map(x => x.name), ["getSystemCatalog"]);
  assert.deepEqual((await route("¿Qué puedes consultar en Assets?")).calls.map(x => x.name), ["getSystemCatalog", "getAuthorizedCapabilities"]);
  const candidates = [{ id: "current", displayName: "EBASOR", values: ["EBASOR", "ebasor@example.test"] }];
  assert.equal(resolveUserReference("EBASOR", "current", candidates).matchStatus, "EXACT");
  assert.equal(resolveUserReference("Ebasor", "current", candidates).matchStatus, "EXACT");
  assert.equal(resolveUserReference("Evasor", "current", candidates).matchStatus, "CONFIRM_CURRENT_USER");
  assert.equal(resolveUserReference("yo", "current", candidates).matchStatus, "CURRENT_USER");
  assert.equal(resolveUserReference("mi usuario", "current", candidates).matchStatus, "CURRENT_USER");
  assert.equal(resolveUserReference("Alex", "current", [{ id: "a", displayName: "Alex", values: ["Alex"] }, { id: "b", displayName: "Alex", values: ["Alex"] }]).matchStatus, "AMBIGUOUS");
  assert.equal(normalizePay0Brand("PayZero, Pay Zero, Pay cero, pay0"), "PAY0, PAY0, PAY0, PAY0");
  assert.equal(canonicalErrorCategory(Error("PERMISSION_DENIED")), "PERMISSION_DENIED");
  assert.equal(canonicalErrorCategory(Error("HUGO_TOOL_NOT_ALLOWED")), "CAPABILITY_NOT_AVAILABLE");
  const catalog = resultFor("getSystemCatalog").data;
  assert.match(formatSystemCatalog(catalog), /Hay 4 sistemas registrados/);
  assert.match(formatSystemCatalog(catalog), /Aparte de HUGO son 3: PAY0, ASSETS, TTT/);
  assert.match(formatSystemCatalog(catalog, "¿Qué puedes consultar en Assets?"), /NOT_CONNECTED.*no hay un conector activo/);
  assert.equal(formatLatestSolicitud(resultFor("getLatestSolicitud").data), "El cliente asociado a la solicitud más reciente visible es Cliente autorizado.");
  assert.match(formatAuthorizedCapabilities(resultFor("getAuthorizedCapabilities").data, { status: "ERROR", errorCategory: "CAPABILITY_NOT_AVAILABLE" }), /no por una denegación de permisos demostrada/);
  console.log(JSON.stringify({ ok: true, questions: 8, ambiguousQueriesExecutedTools: 0, writes: 0, realtimeSessions: 0 }));
})().catch(error => { console.error(error); process.exitCode = 1; });
