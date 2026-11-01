const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

const component = fs.readFileSync("src/components/hugo/HugoRealtimeVoice.tsx", "utf8");
const gateway = fs.readFileSync("services/hugo-voice-gateway/src/server.mjs", "utf8") + fs.readFileSync("services/hugo-voice-gateway/src/gatewayConnection.mjs", "utf8");
const tools = fs.readFileSync("services/hugo-voice-gateway/src/realtimeTools.mjs", "utf8");
const history = fs.readFileSync("functions/src/modules/agent007/voiceHistory.ts", "utf8");

assert.match(component, /NEXT_PUBLIC_HUGO_VOICE_GATEWAY_URL/);
// Inspect the real token initializer: the bounded startup must still use the
// authenticated Firebase user, with its existing no-user guard intact.
const componentAst = ts.createSourceFile("HugoRealtimeVoice.tsx", component, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let tokenInitializer;
function visitVoiceContract(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(componentAst) === "idToken") tokenInitializer = node.initializer;
  ts.forEachChild(node, visitVoiceContract);
}
visitVoiceContract(componentAst);
assert.ok(tokenInitializer && ts.isAwaitExpression(tokenInitializer));
const tokenCall = tokenInitializer.expression;
assert.ok(ts.isCallExpression(tokenCall) && tokenCall.expression.getText(componentAst) === "withVoiceStartupAbort");
assert.equal(tokenCall.arguments.length, 2);
assert.equal(tokenCall.arguments[1].getText(componentAst), "startup.signal");
const tokenOperation = tokenCall.arguments[0];
assert.ok(ts.isArrowFunction(tokenOperation) && tokenOperation.parameters.length === 0 && ts.isCallExpression(tokenOperation.body));
assert.equal(tokenOperation.body.expression.getText(componentAst), "currentUser.getIdToken");
assert.equal(tokenOperation.body.arguments.length, 0);
assert.match(component, /const currentUser = auth\.currentUser;\s*if \(!currentUser\) throw new Error\(/);
assert.match(component, /lateStream => lateStream\.getTracks\(\)\.forEach\(track => track\.stop\(\)\)/);
assert.match(component, /STARTUP_TIMEOUT_MS = 45000/);
assert.match(component, /Cancelar conexión/);
assert.match(component, /new WebSocket\(gatewayUrl!\)/);
assert.doesNotMatch(component, /createHugoRealtimeSession/);
assert.doesNotMatch(component, /api\.openai\.com\/v1\/realtime\/calls/);
assert.doesNotMatch(component, /voiceCanary/);

const expectedTools = ["buscar_solicitudes", "ver_solicitud", "buscar_pagos", "buscar_personas", "get_earnings_by_client_report", "get_authorized_capabilities", "get_system_catalog", "count_clients_for_user", "count_my_visible_clients", "get_payment_complement_status", "explain_last_operation", "delegate_to_hugo_core", "correct_current_voice_response"];
const removedTools = ["consult_hugo_team", "get_latest_solicitud", "get_latest_solicitud_for_user", "get_latest_payment_for_user", "query_received_payments", "get_payment_details", "get_recent_session_context"];
for (const tool of expectedTools) {
  assert.match(tools, new RegExp(`name: "${tool}"`));
}
for (const tool of removedTools) assert.doesNotMatch(tools, new RegExp(`"${tool}"`));
// The model chooses filters only: delegation must whitelist inputs, never forward identity or root scope.
assert.match(tools, /export function readToolInput/);
assert.doesNotMatch(tools, /(?:args|source)\.(?:rootId|uid|identity)\b/);
assert.match(gateway, /boundToolData\(result\.data\)/);
assert.match(gateway, /MAX_TOOL_DATA_BYTES = 16 \* 1024/);
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
