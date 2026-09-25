import test from "node:test";
import assert from "node:assert/strict";
import { delegationForRealtimeTool, realtimeToolNames, realtimeTools } from "../src/realtimeTools.mjs";

test("Realtime registers the canonical PAY0 read capabilities", () => {
  assert.deepEqual(realtimeToolNames.slice(0, 3), ["get_authorized_capabilities", "get_system_catalog", "count_clients_for_user"]);
  for (const tool of realtimeTools) {
    assert.equal(tool.type, "function");
    assert.equal(tool.parameters.additionalProperties, false);
  }
  assert.deepEqual(delegationForRealtimeTool("get_authorized_capabilities"), { request: "¿A qué tengo acceso?", toolName: "getAuthorizedCapabilities", toolInput: {} });
  assert.deepEqual(delegationForRealtimeTool("get_system_catalog"), { request: "¿Cuáles son los sistemas disponibles?", toolName: "getSystemCatalog", toolInput: {} });
  assert.equal(delegationForRealtimeTool("count_clients_for_user", { query: "Betel" }).toolInput.query, "Betel");
  assert.deepEqual(delegationForRealtimeTool("count_my_visible_clients"), { request: "¿Cuántos clientes activos puedo ver?", toolName: "countClientsForCurrentUser", toolInput: {} });
  assert.deepEqual(delegationForRealtimeTool("get_latest_solicitud"), { request: "¿Qué cliente hizo la última solicitud?", toolName: "getLatestSolicitud", toolInput: {} });
  assert.deepEqual(delegationForRealtimeTool("query_received_payments", { operation: "LATEST" }).toolInput, { position: "LATEST", limit: 1 });
  assert.deepEqual(delegationForRealtimeTool("query_received_payments", { operation: "LIST", limit: 5 }).toolInput, { position: "LATEST", limit: 5 });
  assert.deepEqual(delegationForRealtimeTool("query_received_payments", { operation: "PREVIOUS" }).toolInput, { position: "PREVIOUS", limit: 1 });
  assert.equal(delegationForRealtimeTool("get_payment_details", { payment_id: "opaque-payment" }).toolInput.paymentId, "opaque-payment");
  assert.equal(delegationForRealtimeTool("get_payment_complement_status", { folio: "P-1" }).toolInput.folio, "P-1");
  assert.equal(delegationForRealtimeTool("get_recent_session_context").toolName, "getSessionContext");
  assert.equal(delegationForRealtimeTool("explain_last_operation").toolName, "getLastOperationDiagnostic");
});

test("payment list limits are bounded and tool schemas remain fail closed", () => {
  assert.equal(delegationForRealtimeTool("query_received_payments", { operation: "LIST", limit: 99 }).toolInput.limit, 5);
  assert.equal(delegationForRealtimeTool("query_received_payments", { operation: "LIST", limit: -2 }).toolInput.limit, 1);
  assert.equal(delegationForRealtimeTool("query_received_payments", { operation: "UNKNOWN" }).toolInput.limit, 1);
  assert.ok(realtimeToolNames.includes("query_received_payments"));
  assert.ok(realtimeToolNames.includes("explain_last_operation"));
  assert.equal(realtimeToolNames.length, 11);
  assert.match(realtimeTools.find(tool => tool.name === "query_received_payments").description, /Nunca interpretes movimiento/);
});

test("unknown Realtime tools fail closed", () => {
  assert.throws(() => delegationForRealtimeTool("invented_tool", {}), /UNKNOWN_REALTIME_TOOL/);
});
