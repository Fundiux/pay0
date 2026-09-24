import test from "node:test";
import assert from "node:assert/strict";
import { delegationForRealtimeTool, realtimeToolNames, realtimeTools } from "../src/realtimeTools.mjs";

test("Realtime registers the three canonical PAY0 read capabilities", () => {
  assert.deepEqual(realtimeToolNames.slice(0, 3), ["get_authorized_capabilities", "get_system_catalog", "count_clients_for_user"]);
  for (const tool of realtimeTools) {
    assert.equal(tool.type, "function");
    assert.equal(tool.parameters.additionalProperties, false);
  }
  assert.deepEqual(delegationForRealtimeTool("get_authorized_capabilities"), { request: "¿A qué tengo acceso?", toolName: "getAuthorizedCapabilities", toolInput: {} });
  assert.deepEqual(delegationForRealtimeTool("get_system_catalog"), { request: "¿Cuáles son los sistemas disponibles?", toolName: "getSystemCatalog", toolInput: {} });
  assert.equal(delegationForRealtimeTool("count_clients_for_user", { query: "Betel" }).toolInput.query, "Betel");
});

test("unknown Realtime tools fail closed", () => {
  assert.throws(() => delegationForRealtimeTool("invented_tool", {}), /UNKNOWN_REALTIME_TOOL/);
});
