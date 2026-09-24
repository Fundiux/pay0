import http from "node:http";
import { randomUUID } from "node:crypto";
import { initializeApp, applicationDefault, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { WebSocketServer, WebSocket } from "ws";
import { ToolCallRegistry } from "./toolCallRegistry.mjs";
import { delegationForRealtimeTool, realtimeToolNames, realtimeTools } from "./realtimeTools.mjs";

if (!getApps().length) initializeApp({ credential: applicationDefault() });
const port = Number(process.env.PORT || 8080), apiKey = process.env.OPENAI_API_KEY || "";
const delegateUrl = process.env.HUGO_DELEGATE_URL || "https://us-central1-pay-0-system.cloudfunctions.net/delegateHugoVoiceTurn";
const authorizeUrl = process.env.HUGO_AUTHORIZE_URL || "https://us-central1-pay-0-system.cloudfunctions.net/authorizeHugoVoiceGatewaySession";
const model = process.env.HUGO_REALTIME_MODEL || "gpt-realtime-2.1", voice = process.env.HUGO_REALTIME_VOICE || "marin";
const canaryUids = new Set(String(process.env.HUGO_CANARY_UIDS || "").split(",").map(value => value.trim()).filter(Boolean));

async function openRealtime(sdp) {
  const secretResponse = await fetch("https://api.openai.com/v1/realtime/client_secrets", { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ session: { type: "realtime", model, instructions: "Eres Hugo, asistente interno de PAY0. Para capacidades, sistemas y conteos usa siempre la herramienta deterministica correspondiente. Delega a Hugo Core solamente tareas complejas no cubiertas por esas herramientas. Comunica unicamente el resultado autorizado de la herramienta y no inventes acceso ni datos.", tools: realtimeTools, tool_choice: "auto", audio: { input: { noise_reduction: { type: "near_field" }, turn_detection: { type: "semantic_vad", eagerness: "low", create_response: true, interrupt_response: true } }, output: { voice } } } }) });
  const secret = await secretResponse.json(); if (!secretResponse.ok || !secret.value) throw Error("REALTIME_SECRET_FAILED");
  const call = await fetch("https://api.openai.com/v1/realtime/calls", { method: "POST", headers: { Authorization: `Bearer ${secret.value}`, "Content-Type": "application/sdp" }, body: sdp });
  const answer = await call.text(), location = call.headers.get("location"), callId = location?.split("/").pop();
  if (!call.ok || !callId) throw Error("REALTIME_CALL_FAILED");
  return { answer, callId };
}
function callable(token, data, signal) { return fetch(delegateUrl, { method: "POST", signal, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ data }) }).then(async response => { const body = await response.json(); if (!response.ok || body.error) throw Error(body.error?.status || "HUGO_CORE_FAILED"); return body.result; }); }
function authorize(token) { return fetch(authorizeUrl, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ data: {} }) }).then(async response => { const body = await response.json(); if (!response.ok || body.error || !body.result?.ok) throw Error(body.error?.status || "HUGO_VOICE_FORBIDDEN"); return body.result; }); }
function log(type, detail = {}) { console.log(JSON.stringify({ severity: "INFO", type, at: new Date().toISOString(), ...detail })); }
function classifyRequestError(error) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const message = error instanceof Error ? error.message : "";
  if (code.startsWith("auth/")) return "INVALID_FIREBASE_TOKEN";
  if (message === "CANARY_NOT_ALLOWED" || message === "UNAUTHENTICATED") return message;
  if (/^[A-Z][A-Z0-9_]+$/.test(message)) return message;
  return "GATEWAY_REQUEST_FAILED";
}

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url || "/", "http://gateway.internal").pathname;
  log("gateway.http", { method: req.method, pathname });
  const healthy = pathname === "/" || pathname === "/healthz" || pathname === "/healthz/";
  res.writeHead(healthy ? 200 : 404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(healthy ? "ok" : "not found");
});
const wss = new WebSocketServer({ server, path: "/voice", maxPayload: 1024 * 1024 });
wss.on("connection", browser => {
  let token = "", identity = null, sideband = null, sessionId = "", turnId = "", responseId = "";
  const connectedAt = Date.now(); let firstAudioAt = null;
  const registry = new ToolCallRegistry(), controllers = new Map();
  const send = value => browser.readyState === WebSocket.OPEN && browser.send(JSON.stringify(value));
  browser.on("message", async raw => { try {
    const event = JSON.parse(raw.toString());
    if (event.type === "authenticate") { token = String(event.idToken || ""); identity = await getAuth().verifyIdToken(token, true); if (canaryUids.size && !canaryUids.has(identity.uid)) throw Error("CANARY_NOT_ALLOWED"); const scope = await authorize(token); identity = { ...identity, rootId: scope.rootId, role: scope.role }; log("gateway.authenticated", { uid: identity.uid, rootId: identity.rootId, role: identity.role }); send({ type: "authenticated" }); return; }
    if (!identity) throw Error("UNAUTHENTICATED");
    if (event.type === "offer") {
      const realtime = await openRealtime(String(event.sdp || "")); sessionId = realtime.callId;
      sideband = new WebSocket(`wss://api.openai.com/v1/realtime?call_id=${encodeURIComponent(realtime.callId)}`, { headers: { Authorization: `Bearer ${apiKey}` } });
      await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error("SIDEBAND_TIMEOUT")), 10000); sideband.once("open", () => { clearTimeout(timer); resolve(); }); sideband.once("error", () => { clearTimeout(timer); reject(Error("SIDEBAND_CONNECT_FAILED")); }); });
      sideband.on("message", async message => { const item = JSON.parse(message.toString()), type = String(item.type || "");
        if (type === "input_audio_buffer.speech_started") { const previous = turnId; turnId = item.item_id || randomUUID(); const interrupted = registry.interrupt(previous); for (const id of interrupted.cancelled) controllers.get(id)?.abort(); log("gateway.interruption", { sessionId, turnId: previous, ...interrupted }); send({ type: "gateway.interruption", turnId: previous, ...interrupted }); }
        if (type === "response.created") responseId = item.response?.id || responseId;
        if (type === "response.output_audio.delta" && firstAudioAt === null) { firstAudioAt = Date.now(); log("gateway.first_audio", { sessionId, turnId, responseId, latencyMs: firstAudioAt - connectedAt }); }
        if (type === "response.done") log("gateway.response_done", { sessionId, turnId, responseId: item.response?.id || responseId, status: item.response?.status || null, usage: item.response?.usage || null });
        if (type === "response.function_call_arguments.done" && realtimeToolNames.includes(item.name)) {
          const toolCallId = String(item.call_id || item.item_id || ""), started = registry.begin(toolCallId, turnId); if (!started.accepted) { log("gateway.tool_duplicate", { sessionId, turnId, responseId, toolCallId }); return; }
          const controller = new AbortController(); controllers.set(toolCallId, controller); registry.running(toolCallId);
          try { const args = JSON.parse(item.arguments || "{}"), delegation = delegationForRealtimeTool(item.name, args), toolStartedAt = Date.now(); log("gateway.tool_started", { sessionId, turnId, responseId, toolCallId, tool: item.name }); const result = await callable(token, { ...delegation, sessionId, turnId, responseId, delegationId: toolCallId, toolCallId }, controller.signal); registry.complete(toolCallId, false); if (!registry.canDeliver(toolCallId)) return;
            sideband.send(JSON.stringify({ type: "conversation.item.create", item: { type: "function_call_output", call_id: toolCallId, output: JSON.stringify({ route: result.route, text: result.text }) } })); sideband.send(JSON.stringify({ type: "response.create" }));
            log("gateway.tool_completed", { sessionId, turnId, responseId, toolCallId, route: result.route, latencyMs: Date.now() - toolStartedAt, cost: result.cost || null });
          } catch (error) { registry.fail(toolCallId); if (error.name !== "AbortError") { sideband.send(JSON.stringify({ type: "conversation.item.create", item: { type: "function_call_output", call_id: toolCallId, output: JSON.stringify({ error: "HUGO_CORE_UNAVAILABLE" }) } })); sideband.send(JSON.stringify({ type: "response.create" })); log("gateway.tool_failed", { sessionId, turnId, responseId, toolCallId, code: error.message }); } } finally { controllers.delete(toolCallId); }
        }
      });
      sideband.on("close", () => send({ type: "gateway.sideband_closed" }));
      log("gateway.session_ready", { sessionId, uid: identity.uid, rootId: identity.rootId, model, voice, tools: realtimeToolNames }); send({ type: "answer", sdp: realtime.answer, sessionId, model, voice, tools: realtimeToolNames });
    }
  } catch (error) {
    const internalCode = classifyRequestError(error);
    const clientCode = internalCode === "CANARY_NOT_ALLOWED" ? "CANARY_NOT_ALLOWED" : internalCode === "UNAUTHENTICATED" ? "UNAUTHENTICATED" : "GATEWAY_REQUEST_REJECTED";
    log("gateway.request_rejected", { uid: identity?.uid || null, sessionId: sessionId || null, code: internalCode });
    send({ type: "gateway.error", code: clientCode });
  } });
  browser.on("close", () => { log("gateway.session_closed", { sessionId: sessionId || null, uid: identity?.uid || null, activeMs: Date.now() - connectedAt }); for (const controller of controllers.values()) controller.abort(); sideband?.close(); });
});
server.listen(port);
