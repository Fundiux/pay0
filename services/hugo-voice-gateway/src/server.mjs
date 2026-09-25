import http from "node:http";
import { initializeApp, applicationDefault, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { WebSocketServer, WebSocket } from "ws";
import { realtimeTools } from "./realtimeTools.mjs";
import { attachGatewayConnection } from "./gatewayConnection.mjs";

if (!getApps().length) initializeApp({ credential: applicationDefault(), projectId: process.env.GOOGLE_CLOUD_PROJECT || "pay-0-system" });
const port = Number(process.env.PORT || 8080), apiKey = process.env.OPENAI_API_KEY || "";
const delegateUrl = process.env.HUGO_DELEGATE_URL || "https://us-central1-pay-0-system.cloudfunctions.net/delegateHugoVoiceTurn";
const authorizeUrl = process.env.HUGO_AUTHORIZE_URL || "https://us-central1-pay-0-system.cloudfunctions.net/authorizeHugoVoiceGatewaySession";
const model = process.env.HUGO_REALTIME_MODEL || "gpt-realtime-2.1", voice = process.env.HUGO_REALTIME_VOICE || "marin";
const canaryUids = new Set(String(process.env.HUGO_CANARY_UIDS || "").split(",").map(value => value.trim()).filter(Boolean));

async function openRealtime(sdp, signal) {
  const instructions = [
    "Eres Hugo, asistente interno de PAY0. Habla siempre en español de México y conserva ese idioma durante toda la sesión.",
    "Normaliza Pay Zero, PayZero, Pay cero, pay0 y cualquier variante de mayusculas al nombre textual oficial PAY0; nunca digas PayYO.",
    "Si el usuario pide el ultimo movimiento o actividad sin decir pago, solicitud, dispersion o actividad operativa, delega a Hugo Core para aclarar; nunca supongas que significa pago.",
    "Para sistemas, capacidades, clientes, pagos y diagnósticos usa primero la herramienta determinística correspondiente. No sustituyas una consulta disponible con evidencia genérica.",
    "'Yo', 'mi usuario', 'mi sesión' y 'los que puedo ver' significan el usuario autenticado actual; usa count_my_visible_clients y no una búsqueda por nombre.",
    "Para último pago, últimos cinco, anterior, monto, pagador, conciliación y complemento conserva la referencia opaca devuelta. Si hubo reconexión o falta la referencia, usa get_recent_session_context.",
    "Una lectura nunca debe crear, conciliar, aplicar, cancelar ni solicitar complementos. Delega a Hugo Core solamente tareas complejas no cubiertas por herramientas directas.",
    "Comunica únicamente el resultado autorizado. No inventes scopes como todo el país, datos, herramientas ni acceso. Si falla una consulta, usa explain_last_operation y da una explicación operacional breve sin código, secretos ni tokens.",
  ].join(" ");
  const secretResponse = await fetch("https://api.openai.com/v1/realtime/client_secrets", { method: "POST", signal, headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ session: { type: "realtime", model, instructions, tools: realtimeTools, tool_choice: "auto", audio: { input: { noise_reduction: { type: "near_field" }, turn_detection: { type: "semantic_vad", eagerness: "low", create_response: true, interrupt_response: true } }, output: { voice } } } }) });
  const secret = await secretResponse.json(); if (!secretResponse.ok || !secret.value) throw Error("REALTIME_SECRET_FAILED");
  const call = await fetch("https://api.openai.com/v1/realtime/calls", { method: "POST", signal, headers: { Authorization: `Bearer ${secret.value}`, "Content-Type": "application/sdp" }, body: sdp });
  const answer = await call.text(), location = call.headers.get("location"), callId = location?.split("/").pop();
  if (!call.ok || !callId) throw Error("REALTIME_CALL_FAILED");
  return { answer, callId };
}
function callable(token, data, signal) { return fetch(delegateUrl, { method: "POST", signal, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ data }) }).then(async response => { const body = await response.json(); if (!response.ok || body.error) throw Error(body.error?.status || "HUGO_CORE_FAILED"); return body.result; }); }
function authorize(token, signal) { return fetch(authorizeUrl, { method: "POST", signal, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ data: {} }) }).then(async response => { const body = await response.json(); if (!response.ok || body.error || !body.result?.ok) throw Error(body.error?.status || "HUGO_VOICE_FORBIDDEN"); return body.result; }); }
function log(type, detail = {}) { console.log(JSON.stringify({ severity: "INFO", type, at: new Date().toISOString(), ...detail })); }
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url || "/", "http://gateway.internal").pathname;
  log("gateway.http", { method: req.method, pathname });
  const healthy = pathname === "/" || pathname === "/healthz" || pathname === "/healthz/";
  res.writeHead(healthy ? 200 : 404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(healthy ? "ok" : "not found");
});
const wss = new WebSocketServer({ server, path: "/voice", maxPayload: 1024 * 1024 });
wss.on("connection", browser => attachGatewayConnection(browser, {
  verifyIdToken: (token, checkRevoked) => getAuth().verifyIdToken(token, checkRevoked),
  authorize, canaryUids, openRealtime, callable, log, model, voice,
  createSideband: callId => new WebSocket(`wss://api.openai.com/v1/realtime?call_id=${encodeURIComponent(callId)}`, { headers: { Authorization: `Bearer ${apiKey}` } }),
}));
server.listen(port);
