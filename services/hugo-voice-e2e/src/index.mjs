import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { chromium } from "playwright-core";

const gatewayUrl = process.env.HUGO_GATEWAY_URL;
const firebaseApiKey = process.env.FIREBASE_WEB_API_KEY;
const canaryUid = process.env.HUGO_CANARY_UID;
if (!gatewayUrl || !firebaseApiKey || !canaryUid) throw Error("E2E_CONFIG_MISSING");
initializeApp({ credential: applicationDefault(), projectId: "pay-0-system", serviceAccountId: "firebase-adminsdk-fbsvc@pay-0-system.iam.gserviceaccount.com" });

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

const idToken = await firebaseIdToken();
const browser = await chromium.launch({ headless: true, executablePath: "/usr/bin/chromium", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  const page = await browser.newPage();
  const result = await page.evaluate(async ({ gatewayUrl, idToken }) => {
    const waitFor = (predicate, timeoutMs, code) => new Promise((resolve, reject) => {
      const started = Date.now();
      const timer = setInterval(() => {
        const value = predicate();
        if (value) { clearInterval(timer); resolve(value); }
        else if (Date.now() - started > timeoutMs) { clearInterval(timer); reject(new Error(code)); }
      }, 50);
    });
    const controlEvents = [], realtimeEvents = [];
    const control = new WebSocket(gatewayUrl);
    control.onmessage = event => controlEvents.push(JSON.parse(String(event.data)));
    await new Promise((resolve, reject) => { control.onopen = resolve; control.onerror = () => reject(new Error("CONTROL_SOCKET_FAILED")); });
    control.send(JSON.stringify({ type: "authenticate", idToken }));
    await waitFor(() => controlEvents.find(event => event.type === "authenticated"), 15000, "GATEWAY_AUTH_TIMEOUT");
    const peer = new RTCPeerConnection();
    peer.addTransceiver("audio", { direction: "recvonly" });
    const channel = peer.createDataChannel("oai-events");
    channel.onmessage = event => realtimeEvents.push(JSON.parse(String(event.data)));
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    await waitFor(() => peer.iceGatheringState === "complete", 15000, "ICE_GATHERING_TIMEOUT");
    control.send(JSON.stringify({ type: "offer", sdp: peer.localDescription.sdp }));
    const answer = await waitFor(() => controlEvents.find(event => event.type === "answer"), 30000, "GATEWAY_ANSWER_TIMEOUT");
    await peer.setRemoteDescription({ type: "answer", sdp: answer.sdp });
    await waitFor(() => channel.readyState === "open", 20000, "DATA_CHANNEL_TIMEOUT");
    const runTurn = async (prompt, expectedTool, sequence) => {
      const startIndex = realtimeEvents.length;
      channel.send(JSON.stringify({ type: "conversation.item.create", event_id: `e2e-user-${sequence}`, item: { type: "message", role: "user", content: [{ type: "input_text", text: prompt }] } }));
      channel.send(JSON.stringify({ type: "response.create", event_id: `e2e-response-${sequence}` }));
      const completed = await waitFor(() => {
        const events = realtimeEvents.slice(startIndex);
        const tool = events.find(event => event.type === "response.function_call_arguments.done" && event.name === expectedTool);
        const toolDone = controlEvents.find(event => event.type === "gateway.tool_completed" && event.tool === expectedTool && event.toolCallId === tool?.call_id);
        const final = [...events].reverse().find(event => event.type === "response.done" && event.response?.status === "completed" && event.response?.output?.some(item => item.type === "message"));
        return tool && toolDone && final ? { events, tool, toolDone, final } : null;
      }, 60000, `TURN_${sequence}_TIMEOUT`);
      const transcript = completed.events.filter(event => event.type === "response.output_audio_transcript.done").at(-1)?.transcript
        || completed.final.response.output?.flatMap(item => item.content || []).find(content => content.transcript)?.transcript || "";
      const created = completed.events.find(event => event.type === "conversation.item.created" && event.item?.role === "user");
      return { turnId: created?.item?.id || null, responseId: completed.final.response?.id || null, toolCallId: completed.tool.call_id,
        tool: completed.tool.name, route: completed.toolDone.route, sourceSystem: completed.toolDone.sourceSystem, transcript, usage: completed.final.response?.usage || null };
    };
    const turns = [];
    turns.push(await runTurn("¿Qué puedes hacer por mí?", "get_authorized_capabilities", 1));
    turns.push(await runTurn("¿Qué sistemas tenemos?", "get_system_catalog", 2));
    turns.push(await runTurn("¿Me puedes decir cuántos usuarios tiene Betel?", "count_clients_for_user", 3));
    control.close(); peer.close();
    return { type: "HUGO_VOICE_E2E_RESULT", sessionId: answer.sessionId, registeredTools: answer.tools, turns };
  }, { gatewayUrl, idToken });
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
