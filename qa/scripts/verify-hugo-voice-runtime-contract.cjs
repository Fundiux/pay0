const assert = require("node:assert/strict");
const fs = require("node:fs");

const component = fs.readFileSync("src/components/hugo/HugoRealtimeVoice.tsx", "utf8");
const gateway = fs.readFileSync("services/hugo-voice-gateway/src/server.mjs", "utf8") + fs.readFileSync("services/hugo-voice-gateway/src/gatewayConnection.mjs", "utf8");
const tools = fs.readFileSync("services/hugo-voice-gateway/src/realtimeTools.mjs", "utf8");
const history = fs.readFileSync("functions/src/modules/agent007/voiceHistory.ts", "utf8");

assert.match(component, /NEXT_PUBLIC_HUGO_VOICE_GATEWAY_URL/);
assert.match(component, /const idToken = await currentUser\.getIdToken\(\)/);
assert.match(component, /new WebSocket\(gatewayUrl!\)/);
assert.doesNotMatch(component, /createHugoRealtimeSession/);
assert.doesNotMatch(component, /api\.openai\.com\/v1\/realtime\/calls/);
assert.doesNotMatch(component, /voiceCanary/);

const expectedTools = ["get_authorized_capabilities", "get_system_catalog", "count_clients_for_user", "count_my_visible_clients", "get_latest_solicitud", "query_received_payments", "get_payment_details", "get_payment_complement_status", "get_recent_session_context", "explain_last_operation", "delegate_to_hugo_core"];
for (const tool of expectedTools) {
  assert.match(tools, new RegExp(`name: "${tool}"`));
}
assert.match(gateway, /authorize\(candidateToken, controller\.signal\)/);
assert.match(gateway, /rootId: scope\.rootId/);
assert.match(gateway, /function_call_output/);
assert.match(gateway, /response\.create/);
assert.match(gateway, /interrupt_response: false/);
assert.match(gateway, /interruptionConfirmationMs = 300/);
assert.match(gateway, /output_audio_buffer\.clear/);
assert.doesNotMatch(component, /audioRef\.current\.muted = true/);
assert.match(history, /agent007Conversations/);
assert.match(history, /voiceSessions/);
assert.match(history, /rootId: actor\.rootId/);
assert.match(history, /ownerUid: actor\.uid/);
assert.doesNotMatch(history, /data\.turns\) \? data\.turns\.slice/);
assert.doesNotMatch(history, /data\.events\) \? data\.events\.slice/);
assert.match(history, /turnId}:\$\{speaker}:\$\{responseId \|\| "input"}/);
assert.match(gateway, /gpt-4o-mini-transcribe/);
assert.match(gateway, /HUGO_BUILD_COMMIT/);
assert.match(component, /pendingTurns/);
assert.match(component, /conversation\.item\.input_audio_transcription\.failed/);
assert.match(component, /CANARY · \{gatewayRevision\} · frontend/);
assert.match(component, /NEXT_PUBLIC_PAY0_BUILD_COMMIT/);
assert.match(component, /setGatewayRuntime\(answer\.runtime\?\.revision && answer\.runtime\?\.commit/);
assert.doesNotMatch(component, /NEXT_PUBLIC_HUGO_GATEWAY_REVISION/);

console.log(JSON.stringify({
  ok: true,
  canonicalRuntime: "SERVER_SIDE_GATEWAY",
  browserDirectRealtimeDisabled: true,
  registeredTools: expectedTools.length,
  toolContinuationRequired: true,
  confirmedInterruptions: true,
  historyScopedByRootAndOwner: true,
  incrementalHistory: true,
  nativeInputTranscription: true,
  collisionSafeResponseIdentity: true,
  externalActions: 0,
}));
