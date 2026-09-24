const assert = require("node:assert/strict");
const fs = require("node:fs");

const component = fs.readFileSync("src/components/hugo/HugoRealtimeVoice.tsx", "utf8");
const gateway = fs.readFileSync("services/hugo-voice-gateway/src/server.mjs", "utf8");
const tools = fs.readFileSync("services/hugo-voice-gateway/src/realtimeTools.mjs", "utf8");
const history = fs.readFileSync("functions/src/modules/agent007/voiceHistory.ts", "utf8");

assert.match(component, /NEXT_PUBLIC_HUGO_VOICE_GATEWAY_URL/);
assert.match(component, /const idToken = await currentUser\.getIdToken\(\)/);
assert.match(component, /new WebSocket\(gatewayUrl!\)/);
assert.doesNotMatch(component, /createHugoRealtimeSession/);
assert.doesNotMatch(component, /api\.openai\.com\/v1\/realtime\/calls/);
assert.doesNotMatch(component, /voiceCanary/);

for (const tool of ["get_authorized_capabilities", "get_system_catalog", "count_clients_for_user", "delegate_to_hugo_core"]) {
  assert.match(tools, new RegExp(`name: "${tool}"`));
}
assert.match(gateway, /authorize\(token\)/);
assert.match(gateway, /rootId: identity\.rootId/);
assert.match(gateway, /function_call_output/);
assert.match(gateway, /response\.create/);
assert.match(history, /agent007Conversations/);
assert.match(history, /voiceSessions/);
assert.match(history, /rootId: actor\.rootId/);
assert.match(history, /ownerUid: actor\.uid/);

console.log(JSON.stringify({
  ok: true,
  canonicalRuntime: "SERVER_SIDE_GATEWAY",
  browserDirectRealtimeDisabled: true,
  registeredTools: 4,
  toolContinuationRequired: true,
  historyScopedByRootAndOwner: true,
  externalActions: 0,
}));
