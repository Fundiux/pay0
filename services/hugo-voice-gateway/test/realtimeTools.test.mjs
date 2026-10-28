import test from "node:test";
import assert from "node:assert/strict";
import { delegationForRealtimeTool, readToolInput, realtimeToolNames, realtimeTools } from "../src/realtimeTools.mjs";

const EXPECTED_TOOLS = ["buscar_solicitudes", "ver_solicitud", "buscar_pagos", "buscar_personas", "get_earnings_by_client_report", "get_authorized_capabilities", "get_system_catalog",
  "count_clients_for_user", "count_my_visible_clients", "get_payment_complement_status", "explain_last_operation", "delegate_to_hugo_core", "correct_current_voice_response",
  "request_voice_topic_memory", "confirm_voice_topic_memory", "select_voice_memory_topic", "clear_voice_memory_topic", "retire_current_voice_topic_memory"];
const REMOVED_TOOLS = ["consult_hugo_team", "get_latest_solicitud", "get_latest_solicitud_for_user", "get_latest_payment_for_user", "query_received_payments", "get_payment_details", "get_recent_session_context"];
const schema = name => realtimeTools.find(tool => tool.name === name).parameters;

test("Realtime registers the general read tools and the kept canonical capabilities only", () => {
  assert.deepEqual(realtimeToolNames, EXPECTED_TOOLS);
  for (const name of REMOVED_TOOLS) {
    assert.ok(!realtimeToolNames.includes(name), name);
    assert.throws(() => delegationForRealtimeTool(name, {}), /UNKNOWN_REALTIME_TOOL/);
  }
  for (const tool of realtimeTools) {
    assert.equal(tool.type, "function");
    assert.equal(tool.parameters.additionalProperties, false);
  }
  assert.deepEqual(delegationForRealtimeTool("get_authorized_capabilities"), { request: "¿A qué tengo acceso?", toolName: "getAuthorizedCapabilities", toolInput: {} });
  assert.deepEqual(delegationForRealtimeTool("get_system_catalog"), { request: "¿Cuáles son los sistemas disponibles?", toolName: "getSystemCatalog", toolInput: {} });
  assert.equal(delegationForRealtimeTool("count_clients_for_user", { query: "Betel" }).toolInput.query, "Betel");
  assert.deepEqual(delegationForRealtimeTool("count_my_visible_clients"), { request: "¿Cuántos clientes activos puedo ver?", toolName: "countClientsForCurrentUser", toolInput: {} });
  assert.equal(delegationForRealtimeTool("get_payment_complement_status", { folio: "P-1" }).toolInput.folio, "P-1");
  assert.equal(delegationForRealtimeTool("explain_last_operation").toolName, "getLastOperationDiagnostic");
  assert.deepEqual(delegationForRealtimeTool("delegate_to_hugo_core", { request: " ¿último movimiento? " }), { request: "¿último movimiento?" });
});

test("general read tool schemas mirror the backend contract and fail closed", () => {
  const solicitudes = schema("buscar_solicitudes"), pagos = schema("buscar_pagos"), personas = schema("buscar_personas"), detalle = schema("ver_solicitud");
  assert.deepEqual(Object.keys(solicitudes.properties).sort(), ["cliente", "creadoPor", "desde", "empresa", "estado", "factura", "folio", "hasta", "limite", "monto", "montoMax", "montoMin", "orden", "soloConteo"]);
  assert.deepEqual(Object.keys(pagos.properties).sort(), ["cliente", "conciliado", "creadoPor", "desde", "empresa", "estado", "folio", "hasta", "limite", "monto", "montoMax", "montoMin", "orden", "pagador", "soloConteo"]);
  assert.deepEqual(Object.keys(detalle.properties).sort(), ["folio", "id"]);
  assert.deepEqual(Object.keys(personas.properties).sort(), ["limite", "texto", "tipo"]);
  for (const s of [solicitudes, pagos, detalle]) assert.deepEqual(s.required, []);
  assert.deepEqual(personas.required, ["texto"]);
  for (const s of [solicitudes, pagos, personas]) { assert.equal(s.properties.limite.minimum, 1); assert.equal(s.properties.limite.maximum, 20); }
  assert.deepEqual(solicitudes.properties.orden.enum, ["RECIENTES", "ANTIGUAS", "MONTO_DESC", "MONTO_ASC"]);
  assert.deepEqual(personas.properties.tipo.enum, ["USUARIO", "CLIENTE", "EMPRESA", "TODOS"]);
  assert.equal(solicitudes.properties.soloConteo.type, "boolean");
  assert.equal(pagos.properties.conciliado.type, "boolean");
  assert.match(solicitudes.properties.desde.description, /AAAA-MM-DD.*Ciudad de México/);
  assert.match(realtimeTools.find(tool => tool.name === "buscar_solicitudes").description, /proveedor/);
  assert.match(realtimeTools.find(tool => tool.name === "ver_solicitud").description, /analiza la OC/);
  assert.match(realtimeTools.find(tool => tool.name === "buscar_pagos").description, /'movimiento' o 'actividad' ambiguos no son pagos/);
  for (const name of ["buscar_solicitudes", "ver_solicitud", "buscar_pagos", "buscar_personas"]) assert.match(realtimeTools.find(tool => tool.name === name).description, /Sólo lectura/);
});

test("general read delegations whitelist and coerce model input; identity keys never pass", () => {
  const delegated = delegationForRealtimeTool("buscar_solicitudes", { cliente: "  ACIER   capital ", empresa: "Betel", rootId: "foreign-root", uid: "foreign-user", identity: { uid: "x" },
    desde: "2026-10-20", hasta: "2026-02-30", monto: "7,540", montoMin: -1, orden: "INVENTADO", limite: 99, soloConteo: "true", conciliado: true, toolName: "deleteAll" });
  assert.deepEqual(delegated, { request: "Buscar solicitudes con filtros.", toolName: "findSolicitudes",
    toolInput: { cliente: "ACIER capital", empresa: "Betel", desde: "2026-10-20", monto: 7540, limite: 20 } });
  assert.deepEqual(delegationForRealtimeTool("buscar_pagos", { pagador: "Juan", conciliado: false, soloConteo: true, limite: 0, orden: "MONTO_DESC", rootId: "r" }),
    { request: "Buscar pagos con filtros.", toolName: "findPagos", toolInput: { pagador: "Juan", orden: "MONTO_DESC", limite: 1, soloConteo: true, conciliado: false } });
  assert.deepEqual(delegationForRealtimeTool("ver_solicitud", { id: "sol-1", uid: "u", rootId: "r" }), { request: "Ver el detalle de una solicitud.", toolName: "getSolicitudDetail", toolInput: { id: "sol-1" } });
  assert.deepEqual(delegationForRealtimeTool("buscar_personas", { texto: "betel", tipo: "CLIENTE", limite: "3", rootId: "r" }),
    { request: "Buscar usuarios, clientes o empresas por nombre.", toolName: "findPeople", toolInput: { texto: "betel", tipo: "CLIENTE", limite: 3 } });
  assert.deepEqual(readToolInput("buscar_personas", { texto: "x", tipo: "ROOT" }), { texto: "x" });
  assert.equal(readToolInput("buscar_solicitudes", { folio: "F".repeat(500) }).folio.length, 120);
  assert.deepEqual(readToolInput("buscar_solicitudes", { cliente: { $ne: "" }, estado: ["x"], limite: true, monto: true }), {});
  assert.deepEqual(delegationForRealtimeTool("buscar_solicitudes"), { request: "Buscar solicitudes con filtros.", toolName: "findSolicitudes", toolInput: {} });
  assert.throws(() => delegationForRealtimeTool("buscar_personas", { texto: "  " }), /INVALID_TOOL_INPUT/);
  assert.throws(() => delegationForRealtimeTool("ver_solicitud", { rootId: "r" }), /INVALID_TOOL_INPUT/);
});

test("earnings report delegates explicit dates without allowing a model-provided identity", () => {
  const delegated = delegationForRealtimeTool("get_earnings_by_client_report", { dateFrom: "2026-10-01", dateTo: "2026-10-19", rootId: "foreign-root", uid: "foreign-user" });
  assert.deepEqual(delegated.toolInput, { dateFrom: "2026-10-01", dateTo: "2026-10-19", limit: 5000 });
  assert.equal(delegated.toolName, "getEarningsByClientReport");
  const report = schema("get_earnings_by_client_report");
  assert.deepEqual(report.required, ["dateFrom", "dateTo"]);
  assert.equal(report.properties.limit.maximum, 5000);
  assert.equal(delegationForRealtimeTool("get_earnings_by_client_report", { dateFrom: "2026-10-01", dateTo: "2026-10-19", includeCompensated: true }).toolInput.includeCompensated, true);
  const comparison = delegationForRealtimeTool("get_earnings_by_client_report", { dateFrom: "2026-10-01", dateTo: "2026-10-19", compareDateFrom: "2026-09-01", compareDateTo: "2026-09-30" });
  assert.equal(comparison.toolInput.compareDateFrom, "2026-09-01");
  assert.equal(comparison.toolInput.compareDateTo, "2026-09-30");
});

test("voice-topic and correction tools keep their model-input-free delegations", () => {
  const topics = { request_voice_topic_memory: "REQUEST", confirm_voice_topic_memory: "CONFIRM", select_voice_memory_topic: "SELECT", clear_voice_memory_topic: "CLEAR", retire_current_voice_topic_memory: "RETIRE" };
  for (const [name, action] of Object.entries(topics)) {
    assert.deepEqual(schema(name), { type: "object", additionalProperties: false, properties: {}, required: [] });
    assert.deepEqual(delegationForRealtimeTool(name, { label: "injected", memoryId: "x" }), { request: "Procesar la declaración privada del tema observado en esta sesión.", voiceTopicAction: action });
  }
  assert.deepEqual(schema("correct_current_voice_response"), { type: "object", additionalProperties: false, properties: {}, required: [] });
  assert.deepEqual(delegationForRealtimeTool("correct_current_voice_response", { content: "injected" }), { request: "Registrar la corrección explícita del turno de voz.", recordResponseCorrection: true });
});

test("unknown Realtime tools fail closed", () => {
  assert.throws(() => delegationForRealtimeTool("invented_tool", {}), /UNKNOWN_REALTIME_TOOL/);
  assert.throws(() => delegationForRealtimeTool("toString", {}), /UNKNOWN_REALTIME_TOOL/);
});
