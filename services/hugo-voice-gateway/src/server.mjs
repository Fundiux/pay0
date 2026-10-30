import http from "node:http";
import { initializeApp, applicationDefault, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { WebSocketServer, WebSocket } from "ws";
import { realtimeToolsFor } from "./realtimeTools.mjs";
import { attachGatewayConnection } from "./gatewayConnection.mjs";
import { handleHttpRequest, isAllowedVoiceOrigin } from "./httpPolicy.mjs";
import { HUGO_VOICE, HUGO_VOICE_SPEED, REALTIME_MODEL } from "./voiceConfig.mjs";
import { buildSessionInstructions } from "./sessionInstructions.mjs";

if (!getApps().length) initializeApp({ credential: applicationDefault(), projectId: process.env.GOOGLE_CLOUD_PROJECT || "pay-0-system" });
const port = Number(process.env.PORT || 8080), apiKey = process.env.OPENAI_API_KEY || "";
const delegateUrl = process.env.HUGO_DELEGATE_URL || "https://us-central1-pay-0-system.cloudfunctions.net/delegateHugoVoiceTurn";
const teamDelegateUrl = process.env.HUGO_TEAM_DELEGATE_URL || "https://us-central1-pay-0-system.cloudfunctions.net/delegateHugoTeamVoiceTurn";
const authorizeUrl = process.env.HUGO_AUTHORIZE_URL || "https://us-central1-pay-0-system.cloudfunctions.net/authorizeHugoVoiceGatewaySession";
const historyUrl = process.env.HUGO_HISTORY_URL || "https://us-central1-pay-0-system.cloudfunctions.net/saveHugoVoiceHistory";
const memoryReviewUrl = process.env.HUGO_MEMORY_REVIEW_URL || "https://us-central1-pay-0-system.cloudfunctions.net/reviewAgent007MemoryCandidate";
const model = REALTIME_MODEL, voice = HUGO_VOICE;
const interruptionConfirmationMs = 300;
const runtimeMetadata = Object.freeze({
  service: process.env.K_SERVICE || "hugo-voice-gateway-local",
  revision: process.env.K_REVISION || "LOCAL",
  commit: process.env.HUGO_BUILD_COMMIT || "UNSET",
  branch: process.env.HUGO_BUILD_BRANCH || "UNSET",
  version: process.env.HUGO_BUILD_VERSION || "p0.5",
  vad: Object.freeze({ type: "semantic_vad", eagerness: "low", createResponse: true, interruptResponse: false, confirmationMs: interruptionConfirmationMs }),
  transcription: Object.freeze({ model: "gpt-4o-mini-transcribe", language: "es" }),
});
const canaryUids = new Set(String(process.env.HUGO_CANARY_UIDS || "").split(",").map(value => value.trim()).filter(Boolean));
const allowedOrigins = new Set(String(process.env.HUGO_ALLOWED_ORIGINS || "").split(",").map(value => value.trim()).filter(Boolean));

async function openRealtime(sdp, signal, { endCall = false } = {}) {
  const instructions = buildSessionInstructions(new Date());
  const secretResponse = await fetch("https://api.openai.com/v1/realtime/client_secrets", { method: "POST", signal, headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ session: { type: "realtime", model, instructions, tools: realtimeToolsFor({ endCall }), tool_choice: "auto", include: ["item.input_audio_transcription.logprobs"], audio: { input: { noise_reduction: { type: "near_field" }, transcription: { model: runtimeMetadata.transcription.model, language: runtimeMetadata.transcription.language }, turn_detection: { type: "semantic_vad", eagerness: "low", create_response: true, interrupt_response: false } }, output: { voice, speed: HUGO_VOICE_SPEED } } } }) });
  const secret = await secretResponse.json(); if (!secretResponse.ok || !secret.value) throw Error("REALTIME_SECRET_FAILED");
  const call = await fetch("https://api.openai.com/v1/realtime/calls", { method: "POST", signal, headers: { Authorization: `Bearer ${secret.value}`, "Content-Type": "application/sdp" }, body: sdp });
  const answer = await call.text(), location = call.headers.get("location"), callId = location?.split("/").pop();
  if (!call.ok || !callId) throw Error("REALTIME_CALL_FAILED");
  return { answer, callId };
}
function callable(token, data, signal) { return fetch(data?.toolName === "consultHugoTeam" ? teamDelegateUrl : delegateUrl, { method: "POST", signal, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ data }) }).then(async response => { const body = await response.json(); if (!response.ok || body.error) throw Error(body.error?.status || "HUGO_CORE_FAILED"); return body.result; }); }
function protectedRequest(url, token, data, signal) { return fetch(url, { method: "POST", signal, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ data }) }).then(async response => { const body = await response.json(); if (!response.ok || body.error) throw Error(body.error?.status || "HUGO_CORE_FAILED"); return body.result; }); }
function authorize(token, signal) { return fetch(authorizeUrl, { method: "POST", signal, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ data: {} }) }).then(async response => { const body = await response.json(); if (!response.ok || body.error || !body.result?.ok) throw Error(body.error?.status || "HUGO_VOICE_FORBIDDEN"); return body.result; }); }
function log(type, detail = {}) { console.log(JSON.stringify({ severity: "INFO", type, at: new Date().toISOString(), ...detail })); }
const server = http.createServer((req, res) => {
  const pathname = handleHttpRequest(req, res, runtimeMetadata);
  log("gateway.http", { method: req.method, pathname });
});
const wss = new WebSocketServer({ server, path: "/voice", maxPayload: 1024 * 1024,
  verifyClient: ({ req }) => isAllowedVoiceOrigin(req.headers.origin, allowedOrigins),
});
wss.on("connection", browser => attachGatewayConnection(browser, {
  verifyIdToken: (token, checkRevoked) => getAuth().verifyIdToken(token, checkRevoked),
  authorize, canaryUids, openRealtime, callable,
  saveHistory: (token, data, signal) => protectedRequest(historyUrl, token, data, signal),
  reviewMemory: (token, data, signal) => protectedRequest(memoryReviewUrl, token, data, signal),
  log, model, voice, runtimeMetadata, interruptionConfirmationMs,
  createSideband: callId => new WebSocket(`wss://api.openai.com/v1/realtime?call_id=${encodeURIComponent(callId)}`, { headers: { Authorization: `Bearer ${apiKey}` } }),
}));
server.listen(port);
