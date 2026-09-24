import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { RTCPeerConnection } from "werift";
import WebSocket from "ws";

const gatewayUrl = process.env.HUGO_GATEWAY_URL;
const firebaseApiKey = process.env.FIREBASE_WEB_API_KEY;
const canaryUid = process.env.HUGO_CANARY_UID;
if (!gatewayUrl || !firebaseApiKey || !canaryUid) throw Error("E2E_CONFIG_MISSING");

initializeApp({ credential: applicationDefault(), projectId: "pay-0-system", serviceAccountId: "firebase-adminsdk-fbsvc@pay-0-system.iam.gserviceaccount.com" });

const waitFor = (subscribe, timeoutMs, code) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(Error(code)), timeoutMs);
  subscribe(value => { clearTimeout(timer); resolve(value); });
});

async function firebaseIdToken() {
  const customToken = await getAuth().createCustomToken(canaryUid);
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(firebaseApiKey)}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  });
  const body = await response.json();
  if (!response.ok || !body.idToken) throw Error(`FIREBASE_EXCHANGE_FAILED_${response.status}`);
  const verified = await getAuth().verifyIdToken(body.idToken, true);
  if (verified.uid !== canaryUid) throw Error("FIREBASE_UID_MISMATCH");
  console.log(JSON.stringify({ type: "HUGO_E2E_IDENTITY_VERIFIED", uid: verified.uid, aud: verified.aud, iss: verified.iss }));
  return body.idToken;
}

async function connect(idToken) {
  const control = new WebSocket(gatewayUrl);
  const peer = new RTCPeerConnection();
  peer.addTransceiver("audio", { direction: "recvonly" });
  const channel = peer.createDataChannel("oai-events");
  const gatewayEvents = [], realtimeEvents = [];
  control.on("message", raw => gatewayEvents.push(JSON.parse(String(raw))));
  channel.onMessage.subscribe(raw => realtimeEvents.push(JSON.parse(Buffer.from(raw).toString())));
  await new Promise((resolve, reject) => { control.once("open", resolve); control.once("error", reject); });
  control.send(JSON.stringify({ type: "authenticate", idToken }));
  await waitFor(handler => {
    const listener = raw => { const event = JSON.parse(String(raw)); if (event.type === "authenticated") { control.off("message", listener); handler(event); } };
    control.on("message", listener);
  }, 15000, "GATEWAY_AUTH_TIMEOUT");
  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);
  control.send(JSON.stringify({ type: "offer", sdp: offer.sdp }));
  const answer = await waitFor(handler => {
    const listener = raw => { const event = JSON.parse(String(raw)); if (event.type === "answer") { control.off("message", listener); handler(event); } };
    control.on("message", listener);
  }, 30000, "GATEWAY_ANSWER_TIMEOUT");
  await peer.setRemoteDescription({ type: "answer", sdp: answer.sdp });
  if (channel.readyState !== "open") await waitFor(handler => channel.stateChanged.subscribe(state => { if (state === "open") handler(state); }), 20000, "DATA_CHANNEL_TIMEOUT");
  return { control, peer, channel, gatewayEvents, realtimeEvents, sessionId: answer.sessionId, tools: answer.tools };
}

async function runTurn(connection, prompt, expectedTool, sequence) {
  const startIndex = connection.realtimeEvents.length;
  const eventId = `e2e-user-${sequence}`;
  connection.channel.send(JSON.stringify({ type: "conversation.item.create", event_id: eventId, item: { type: "message", role: "user", content: [{ type: "input_text", text: prompt }] } }));
  connection.channel.send(JSON.stringify({ type: "response.create", event_id: `e2e-response-${sequence}` }));
  const completion = await waitFor(handler => {
    const timer = setInterval(() => {
      const events = connection.realtimeEvents.slice(startIndex);
      const tool = events.find(event => event.type === "response.function_call_arguments.done" && event.name === expectedTool);
      const toolDone = connection.gatewayEvents.find(event => event.type === "gateway.tool_completed" && event.tool === expectedTool && event.toolCallId === tool?.call_id);
      const final = [...events].reverse().find(event => event.type === "response.done" && event.response?.status === "completed" && event.response?.output?.some(item => item.type === "message"));
      if (tool && toolDone && final) { clearInterval(timer); handler({ tool, toolDone, final, events }); }
    }, 100);
  }, 60000, `TURN_${sequence}_TIMEOUT`);
  const transcript = completion.events.filter(event => event.type === "response.output_audio_transcript.done").at(-1)?.transcript
    || completion.final.response.output?.flatMap(item => item.content || []).find(content => content.transcript)?.transcript || "";
  const created = completion.events.find(event => event.type === "conversation.item.created" && event.item?.role === "user");
  return {
    turnId: created?.item?.id || null,
    responseId: completion.final.response?.id || null,
    toolCallId: completion.tool.call_id,
    tool: completion.tool.name,
    route: completion.toolDone.route,
    sourceSystem: completion.toolDone.sourceSystem,
    transcript,
    usage: completion.final.response?.usage || null,
  };
}

const idToken = await firebaseIdToken();
const connection = await connect(idToken);
const turns = [];
try {
  turns.push(await runTurn(connection, "¿Qué puedes hacer por mí?", "get_authorized_capabilities", 1));
  turns.push(await runTurn(connection, "¿Qué sistemas tenemos?", "get_system_catalog", 2));
  turns.push(await runTurn(connection, "¿Me puedes decir cuántos usuarios tiene Betel?", "count_clients_for_user", 3));
  console.log(JSON.stringify({ type: "HUGO_VOICE_E2E_RESULT", sessionId: connection.sessionId, registeredTools: connection.tools, turns }));
} finally {
  connection.control.close();
  connection.peer.close();
}
