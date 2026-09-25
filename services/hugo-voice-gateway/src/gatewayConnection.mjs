import { randomUUID } from "node:crypto";
import { ToolCallRegistry } from "./toolCallRegistry.mjs";
import { ResponseContinuationRegistry } from "./responseContinuationRegistry.mjs";
import { delegationForRealtimeTool, realtimeToolNames } from "./realtimeTools.mjs";

export const ConnectionState = Object.freeze({ NEW: "NEW", AUTHENTICATING: "AUTHENTICATING", AUTHORIZED: "AUTHORIZED", REALTIME_STARTING: "REALTIME_STARTING", REALTIME_ACTIVE: "REALTIME_ACTIVE", REJECTED: "REJECTED", CLOSED: "CLOSED" });
const safeErrorCodes = new Set(["CANARY_NOT_ALLOWED", "UNAUTHENTICATED", "AUTHENTICATION_TIMEOUT", "AUTHENTICATION_CANCELLED", "AUTHENTICATION_FAILED", "AUTHORIZATION_SCOPE_INVALID", "PERMISSION_DENIED", "UNAVAILABLE", "DEADLINE_EXCEEDED", "HUGO_VOICE_FORBIDDEN", "DUPLICATE_AUTHENTICATION", "OFFER_NOT_AUTHORIZED", "INVALID_OFFER", "INVALID_MESSAGE", "REALTIME_SECRET_FAILED", "REALTIME_CALL_FAILED", "SIDEBAND_TIMEOUT", "SIDEBAND_CONNECT_FAILED"]);

export function classifyRequestError(error) {
  if (safeErrorCodes.has(error?.message)) return error.message;
  if (typeof error?.code === "string" && error.code.startsWith("auth/")) return "AUTHENTICATION_FAILED";
  return "GATEWAY_REQUEST_FAILED";
}

function withTimeout(operation, timeoutMs, code) {
  let timer;
  return Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => { timer = setTimeout(() => reject(Error(code)), timeoutMs); })]).finally(() => clearTimeout(timer));
}

// Every invocation owns its state. No browser-supplied context or session identifier is trusted.
export function attachGatewayConnection(browser, { verifyIdToken, authorize, canaryUids, openRealtime, createSideband, callable, log, model, voice, authenticationTimeoutMs = 10000, sidebandTimeoutMs = 10000 }) {
  const socketBinding = Object.freeze({ socket: browser, gatewaySessionId: randomUUID() });
  const allowedUids = new Set(canaryUids);
  let state = ConnectionState.NEW, authorizedContext = null, token = "", sideband = null, sessionId = "", turnId = "", responseId = "";
  let pendingAuthenticationCleanup = null, realtimeController = null, realtimeCreationAttempts = 0;
  const connectedAt = Date.now(); let firstAudioAt = null;
  let registry = new ToolCallRegistry(), continuations = new ResponseContinuationRegistry();
  const controllers = new Map();
  const terminal = () => state === ConnectionState.REJECTED || state === ConnectionState.CLOSED;
  const send = value => !terminal() && browser.readyState === 1 && browser.send(JSON.stringify(value));
  const active = () => state === ConnectionState.REALTIME_ACTIVE && authorizedContext?.binding === socketBinding && socketBinding.socket === browser && browser.readyState === 1;
  const clearContext = () => {
    pendingAuthenticationCleanup?.(); pendingAuthenticationCleanup = null;
    realtimeController?.abort(); realtimeController = null;
    for (const controller of controllers.values()) controller.abort();
    controllers.clear();
    const oldSideband = sideband; sideband = null;
    if (oldSideband) { if (oldSideband.readyState === 0) oldSideband.terminate(); else oldSideband.close(); }
    token = ""; authorizedContext = null; sessionId = ""; turnId = ""; responseId = ""; firstAudioAt = null;
    registry = new ToolCallRegistry(); continuations = new ResponseContinuationRegistry();
  };
  const reject = error => {
    if (terminal()) return;
    const code = classifyRequestError(error);
    const clientCode = code === "CANARY_NOT_ALLOWED" ? code : ["UNAUTHENTICATED", "OFFER_NOT_AUTHORIZED"].includes(code) ? "UNAUTHENTICATED" : "GATEWAY_REQUEST_REJECTED";
    state = ConnectionState.REJECTED;
    clearContext();
    log("gateway.request_rejected", { gatewaySessionId: socketBinding.gatewaySessionId, code, realtimeCreationAttempts });
    if (browser.readyState === 1) browser.send(JSON.stringify({ type: "gateway.error", code: clientCode }));
    browser.close(1008, "Gateway policy rejected");
  };
  const authenticate = async event => {
    if (state !== ConnectionState.NEW) throw Error("DUPLICATE_AUTHENTICATION");
    state = ConnectionState.AUTHENTICATING;
    let candidateToken = typeof event.idToken === "string" ? event.idToken : "", decodedIdentity = null, scope = null;
    delete event.idToken;
    const controller = new AbortController();
    const cleanup = () => { candidateToken = ""; decodedIdentity = null; scope = null; controller.abort(); };
    pendingAuthenticationCleanup = cleanup;
    const stillAuthenticating = () => state === ConnectionState.AUTHENTICATING && pendingAuthenticationCleanup === cleanup && browser.readyState === 1 && !controller.signal.aborted;
    try {
      if (!candidateToken || candidateToken.length > 16384) throw Error("UNAUTHENTICATED");
      await withTimeout(async () => {
        decodedIdentity = await verifyIdToken(candidateToken, true);
        if (!stillAuthenticating()) { decodedIdentity = null; throw Error("AUTHENTICATION_CANCELLED"); }
        if (typeof decodedIdentity?.uid !== "string" || !decodedIdentity.uid) throw Error("AUTHENTICATION_FAILED");
        // Empty or missing canary configuration is also fail-closed.
        if (!allowedUids.has(decodedIdentity.uid)) throw Error("CANARY_NOT_ALLOWED");
        scope = await authorize(candidateToken, controller.signal);
        if (!stillAuthenticating()) { scope = null; throw Error("AUTHENTICATION_CANCELLED"); }
        if (scope?.ok !== true || scope.uid !== decodedIdentity.uid || typeof scope.rootId !== "string" || !scope.rootId || scope.rootId.trim() !== scope.rootId || scope.rootId.length > 128 || scope.rootId.includes("/") || typeof scope.role !== "string" || !scope.role.trim() || (decodedIdentity.rootId != null && decodedIdentity.rootId !== scope.rootId)) throw Error("AUTHORIZATION_SCOPE_INVALID");
        authorizedContext = Object.freeze({ binding: socketBinding, uid: decodedIdentity.uid, rootId: scope.rootId, authorization: Object.freeze({ ok: true, role: scope.role }) });
        token = candidateToken;
        state = ConnectionState.AUTHORIZED;
        log("gateway.authenticated", { gatewaySessionId: socketBinding.gatewaySessionId });
        send({ type: "authenticated" });
      }, authenticationTimeoutMs, "AUTHENTICATION_TIMEOUT");
    } finally {
      cleanup();
      if (pendingAuthenticationCleanup === cleanup) pendingAuthenticationCleanup = null;
    }
  };

  const onSidebandMessage = async message => {
    if (!active()) return;
    try {
      const item = JSON.parse(message.toString()), type = String(item.type || "");
      if (["conversation.item.created", "conversation.item.added", "conversation.item.done"].includes(type) && item.item?.type === "message" && item.item?.role === "user") {
        const recognizedTurnId = item.item.id || turnId || randomUUID();
        if (recognizedTurnId !== turnId) { turnId = recognizedTurnId; log("gateway.turn_recognized", { sessionId, turnId, modality: "TEXT" }); }
      }
      if (type === "input_audio_buffer.speech_started") { const previous = turnId; turnId = item.item_id || randomUUID(); const interrupted = registry.interrupt(previous); for (const id of interrupted.cancelled) controllers.get(id)?.abort(); log("gateway.interruption", { sessionId, turnId: previous, ...interrupted }); send({ type: "gateway.interruption", turnId: previous, ...interrupted }); }
      if (type === "response.created") responseId = item.response?.id || responseId;
      if (type === "response.output_audio.delta" && firstAudioAt === null) { firstAudioAt = Date.now(); log("gateway.first_audio", { sessionId, turnId, responseId, latencyMs: firstAudioAt - connectedAt }); }
      if (type === "response.done") {
        const doneResponseId = item.response?.id || responseId;
        const toolCallIds = (item.response?.output || []).filter(output => output.type === "function_call").map(output => output.call_id).filter(Boolean);
        log("gateway.response_done", { sessionId, turnId, responseId: doneResponseId, status: item.response?.status || null, usage: item.response?.usage || null });
        if (continuations.observeDone(doneResponseId, toolCallIds)) sideband.send(JSON.stringify({ type: "response.create" }));
      }
      if (type === "response.function_call_arguments.done" && realtimeToolNames.includes(item.name)) {
        const callResponseId = String(item.response_id || responseId || "");
        if (!turnId) { turnId = `turn_${callResponseId || item.call_id || randomUUID()}`; log("gateway.turn_recognized", { sessionId, turnId, modality: "TEXT_FALLBACK" }); }
        const toolCallId = String(item.call_id || item.item_id || ""), started = registry.begin(toolCallId, turnId); if (!started.accepted) { log("gateway.tool_duplicate", { sessionId, turnId, responseId: callResponseId, toolCallId }); return; }
        const controller = new AbortController(); controllers.set(toolCallId, controller); registry.running(toolCallId);
        try { const args = JSON.parse(item.arguments || "{}"), delegation = delegationForRealtimeTool(item.name, args), toolStartedAt = Date.now(); log("gateway.tool_started", { sessionId, turnId, responseId: callResponseId, toolCallId, tool: item.name }); const result = await callable(token, { ...delegation, sessionId, turnId, responseId: callResponseId, delegationId: toolCallId, toolCallId }, controller.signal); if (!active() || controller.signal.aborted) return; registry.complete(toolCallId, false); if (!registry.canDeliver(toolCallId)) return;
          sideband.send(JSON.stringify({ type: "conversation.item.create", item: { type: "function_call_output", call_id: toolCallId, output: JSON.stringify({ route: result.route, text: result.text }) } }));
          log("gateway.tool_output_sent", { sessionId, turnId, responseId: callResponseId, toolCallId, tool: item.name, route: result.route, sourceSystem: result.sourceSystem || null });
          send({ type: "gateway.tool_completed", sessionId, turnId, responseId: callResponseId, toolCallId, tool: item.name, route: result.route, sourceSystem: result.sourceSystem || null });
          if (continuations.outputDelivered(callResponseId, toolCallId)) sideband.send(JSON.stringify({ type: "response.create" }));
          log("gateway.tool_completed", { sessionId, turnId, responseId: callResponseId, toolCallId, tool: item.name, route: result.route, sourceSystem: result.sourceSystem || null, latencyMs: Date.now() - toolStartedAt, cost: result.cost || null });
        } catch (error) { if (!active() || controller.signal.aborted) return; registry.fail(toolCallId); if (error.name !== "AbortError") { sideband.send(JSON.stringify({ type: "conversation.item.create", item: { type: "function_call_output", call_id: toolCallId, output: JSON.stringify({ error: "HUGO_CORE_UNAVAILABLE" }) } })); if (continuations.outputDelivered(callResponseId, toolCallId)) sideband.send(JSON.stringify({ type: "response.create" })); log("gateway.tool_failed", { sessionId, turnId, responseId: callResponseId, toolCallId, code: classifyRequestError(error) }); } } finally { controllers.delete(toolCallId); }
      }
    } catch (error) { reject(error); }
  };

  browser.on("message", async raw => {
    if (terminal()) return;
    try {
      const event = JSON.parse(raw.toString());
      raw = null;
      if (!event || typeof event !== "object") throw Error("INVALID_MESSAGE");
      if (event.type === "authenticate") { await authenticate(event); return; }
      if (event.type !== "offer") throw Error("INVALID_MESSAGE");
      if (state !== ConnectionState.AUTHORIZED || authorizedContext?.binding !== socketBinding || socketBinding.socket !== browser || browser.readyState !== 1) throw Error("OFFER_NOT_AUTHORIZED");
      if (typeof event.sdp !== "string" || !event.sdp.trim() || event.sdp.length > 1024 * 1024 || Object.keys(event).some(key => !["type", "sdp"].includes(key))) throw Error("INVALID_OFFER");
      // Reserve synchronously before any await: duplicate offers cannot create a second call.
      state = ConnectionState.REALTIME_STARTING;
      realtimeController = new AbortController();
      const connectionController = realtimeController;
      realtimeCreationAttempts += 1;
      log("gateway.realtime_create_attempt", { gatewaySessionId: socketBinding.gatewaySessionId, realtimeCreationAttempts });
      const realtime = await openRealtime(event.sdp, connectionController.signal);
      if (state !== ConnectionState.REALTIME_STARTING || connectionController.signal.aborted || browser.readyState !== 1) return;
      sessionId = realtime.callId;
      const connectionSideband = createSideband(realtime.callId); sideband = connectionSideband;
      connectionSideband.on("error", () => reject(Error("SIDEBAND_CONNECT_FAILED")));
      connectionSideband.on("close", () => { if (!terminal()) { if (active()) send({ type: "gateway.sideband_closed" }); reject(Error("SIDEBAND_CONNECT_FAILED")); } });
      await new Promise((resolve, rejectConnection) => {
        const cleanup = () => { clearTimeout(timer); connectionSideband.off("open", opened); connectionSideband.off("error", failed); connectionController.signal.removeEventListener("abort", aborted); };
        const opened = () => { cleanup(); resolve(); };
        const failed = () => { cleanup(); rejectConnection(Error("SIDEBAND_CONNECT_FAILED")); };
        const aborted = () => { cleanup(); rejectConnection(Error("AUTHENTICATION_CANCELLED")); };
        const timer = setTimeout(() => { cleanup(); rejectConnection(Error("SIDEBAND_TIMEOUT")); }, sidebandTimeoutMs);
        connectionSideband.once("open", opened); connectionSideband.once("error", failed); connectionController.signal.addEventListener("abort", aborted, { once: true });
      });
      if (state !== ConnectionState.REALTIME_STARTING || connectionController.signal.aborted || browser.readyState !== 1) return;
      state = ConnectionState.REALTIME_ACTIVE;
      sideband.on("message", onSidebandMessage);
      log("gateway.session_ready", { gatewaySessionId: socketBinding.gatewaySessionId, sessionId, model, voice, tools: realtimeToolNames }); send({ type: "answer", sdp: realtime.answer, sessionId, model, voice, tools: realtimeToolNames });
    } catch (error) { reject(error); }
  });
  browser.on("error", () => reject(Error("GATEWAY_REQUEST_FAILED")));
  browser.on("close", () => {
    state = ConnectionState.CLOSED;
    clearContext();
    log("gateway.session_closed", { gatewaySessionId: socketBinding.gatewaySessionId, activeMs: Date.now() - connectedAt, realtimeCreationAttempts });
  });
  // Diagnostics expose presence/state only, never tokens, identities or transferable authorization.
  return Object.freeze({ inspect: () => Object.freeze({ state, hasAuthorizedContext: authorizedContext !== null, hasToken: token !== "", hasPendingAuthentication: pendingAuthenticationCleanup !== null, hasSession: sessionId !== "", hasSideband: sideband !== null, pendingTools: controllers.size, realtimeCreationAttempts, immutableContext: authorizedContext !== null && Object.isFrozen(authorizedContext) && Object.isFrozen(authorizedContext.authorization) && Object.isFrozen(authorizedContext.binding) }) });
}
