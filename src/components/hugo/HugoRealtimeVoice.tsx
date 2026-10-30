"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, MicOff, PhoneOff, Volume2 } from "lucide-react";
import { auth } from "@/lib/firebaseClient";
import { saveHugoVoiceHistory } from "@/services/agent007";
import { withVoiceStartupAbort } from "@/lib/hugoVoiceStartup";
import { ELIUT_VOICE_UID, selectHugoVoiceGateway } from "@/lib/hugoVoiceGateway.mjs";

type VoiceState = "IDLE" | "CONNECTING" | "LISTENING" | "FINALIZING" | "ERROR";
type RealtimeEvent = Record<string, any> & { type?: string; event_id?: string };
type TraceEntry = {
  at: string;
  elapsedMs: number;
  sessionId: string;
  turnId: string | null;
  responseId: string | null;
  type: string;
  detail?: Record<string, unknown>;
};
type VoiceTurnDraft = { turnId: string; responseId: string | null; speaker: "USER" | "HUGO"; text: string; timestampMs: number; durationMs: number; interrupted: boolean; status: string; transcriptionStatus: string; transcriptionConfidence?: number | null };
type VoiceEventDraft = { eventId: string; type: string; turnId: string | null; responseId: string | null; timestampMs: number; detail?: string };
type VoiceHistoryStatus = "ACTIVE" | "COMPLETED" | "FAILED";
type VoiceHistoryDraft = { sessionId: string; gatewayCallId: string; model: string; voice: string; gateway: Record<string, string | null>; realtime: Record<string, any>; startedAt: number; audioUsage: { input: number; cachedInput: number; output: number }; turns: Map<string, VoiceTurnDraft>; events: Map<string, VoiceEventDraft>; pendingTurns: Map<string, VoiceTurnDraft>; pendingEvents: Map<string, VoiceEventDraft>; persistChain: Promise<void>; acceptingEvents: boolean; finalization: Promise<void> | null };

const FINALIZATION_TIMEOUT_MS = 8000;
const STARTUP_TIMEOUT_MS = 45000;
const teamAgents = { hugo: "Hugo", maria: "María", sofia: "Sofía", sentinel: "Sentinel" } as const;
type TeamAgent = keyof typeof teamAgents;
const isTeamAgent = (value: unknown): value is TeamAgent => typeof value === "string" && Object.prototype.hasOwnProperty.call(teamAgents, value);

export async function withVoiceFinalizationTimeout(operation: Promise<void>, timeoutMs = FINALIZATION_TIMEOUT_MS) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      operation,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("VOICE_FINALIZATION_TIMEOUT")), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

declare global {
  interface Window { __HUGO_REALTIME_TRACE__?: TraceEntry[]; }
}

export default function HugoRealtimeVoice({ onHistorySaved }: { onHistorySaved?: () => void } = {}) {
  const [state, setState] = useState<VoiceState>("IDLE");
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState("");
  const [gatewayRuntime, setGatewayRuntime] = useState<{ revision: string; commit: string } | null>(null);
  const [liveTurns, setLiveTurns] = useState<Array<{ speaker: string; text: string }>>([]);
  const [teamResults, setTeamResults] = useState<Array<{ agent: string; activity: string; evidence: Array<{ kind: string; folio: string }>; toolsUsed: string[] }>>([]);
  const [activeAgent, setActiveAgent] = useState<TeamAgent>("hugo");
  const activeAgentRef = useRef<TeamAgent>("hugo");
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const gatewayRef = useRef<WebSocket | null>(null);
  const startingRef = useRef(false);
  const generationRef = useRef(0);
  const startupRef = useRef<AbortController | null>(null);
  const startupTimerRef = useRef<number | null>(null);
  const gatewayTimerRef = useRef<number | null>(null);
  const historyRef = useRef<VoiceHistoryDraft | null>(null);
  // Set when Hugo asks to hang up; the call ends after the goodbye audio finishes playing.
  const endCallRef = useRef<{ heardGoodbye: boolean; timer: number } | null>(null);
  const frontendCommit = process.env.NEXT_PUBLIC_PAY0_BUILD_COMMIT || "unverified";
  const gatewayRevision = gatewayRuntime?.revision || "sin metadatos";
  const gatewayCommit = gatewayRuntime?.commit || "sin metadatos";

  const persistHistory = async (status: VoiceHistoryStatus) => {
    const history = historyRef.current;
    if (!history?.sessionId) return;
    history.persistChain = history.persistChain.catch(() => undefined).then(async () => {
      const turns = [...history.pendingTurns.entries()], events = [...history.pendingEvents.entries()];
      history.pendingTurns.clear(); history.pendingEvents.clear();
      try {
        await saveHugoVoiceHistory({ sessionId: history.sessionId, gatewayCallId: history.gatewayCallId, model: history.model, voice: history.voice, gateway: history.gateway, realtime: history.realtime, status,
          durationMs: Math.max(0, Date.now() - history.startedAt), audioUsage: history.audioUsage,
          turns: turns.map(([, value]) => value), events: events.map(([, value]) => value) });
        onHistorySaved?.();
      } catch (cause) {
        for (const [key, value] of turns) if (!history.pendingTurns.has(key)) history.pendingTurns.set(key, value);
        for (const [key, value] of events) if (!history.pendingEvents.has(key)) history.pendingEvents.set(key, value);
        throw cause;
      }
    });
    await history.persistChain;
  };

  const queueTerminationEvent = (reason: string) => {
    const history = historyRef.current;
    if (!history?.sessionId) return;
    const eventId = `client.session_ending:${reason}`;
    const event: VoiceEventDraft = { eventId, type: "peer.connection_state", turnId: null, responseId: null, timestampMs: Math.max(0, Date.now() - history.startedAt), detail: `termination:${reason}` };
    history.events.set(eventId, event);
    history.pendingEvents.set(eventId, { ...event });
  };

  const finalizeHistory = (status: Exclude<VoiceHistoryStatus, "ACTIVE">, reason: string) => {
    const history = historyRef.current;
    if (!history?.sessionId) return Promise.resolve();
    if (history.finalization) return history.finalization;
    history.acceptingEvents = false;
    queueTerminationEvent(reason);
    history.finalization = withVoiceFinalizationTimeout((async () => {
      try {
        await persistHistory(status);
      } catch {
        await persistHistory(status);
      }
    })());
    return history.finalization;
  };

  const cleanup = () => {
    generationRef.current += 1;
    startingRef.current = false;
    startupRef.current?.abort();
    startupRef.current = null;
    if (endCallRef.current) window.clearTimeout(endCallRef.current.timer);
    endCallRef.current = null;
    if (startupTimerRef.current !== null) window.clearTimeout(startupTimerRef.current);
    if (gatewayTimerRef.current !== null) window.clearTimeout(gatewayTimerRef.current);
    startupTimerRef.current = null;
    gatewayTimerRef.current = null;
    const channel = channelRef.current;
    const gateway = gatewayRef.current;
    if (gateway) {
      gateway.onopen = null;
      gateway.onclose = null;
      gateway.onerror = null;
      gateway.onmessage = null;
      if (gateway.readyState < WebSocket.CLOSING) gateway.close();
    }
    if (channel) {
      channel.onopen = null;
      channel.onclose = null;
      channel.onerror = null;
      channel.onmessage = null;
      if (channel.readyState !== "closed") channel.close();
    }
    const peer = peerRef.current;
    if (peer) {
      peer.ontrack = null;
      peer.onconnectionstatechange = null;
      peer.oniceconnectionstatechange = null;
      peer.close();
    }
    streamRef.current?.getTracks().forEach(track => track.stop());
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.srcObject = null;
    }
    channelRef.current = null;
    gatewayRef.current = null;
    peerRef.current = null;
    streamRef.current = null;
    audioRef.current = null;
  };

  const stop = async () => {
    setState("FINALIZING");
    try {
      await finalizeHistory("COMPLETED", "USER_STOP");
    } catch (cause: any) {
      setError(cause?.message === "VOICE_FINALIZATION_TIMEOUT" ? "La conversacion termino, pero el cierre del historial excedio el tiempo de espera." : "La conversacion termino, pero el ultimo guardado no pudo confirmarse.");
    } finally {
      cleanup();
      setMuted(false);
      setState("IDLE");
    }
  };

  const finishRequestedCall = () => {
    if (!endCallRef.current) return;
    window.clearTimeout(endCallRef.current.timer);
    endCallRef.current = null;
    void stop();
  };

  useEffect(() => {
    const flushWhileHidden = () => {
      if (document.visibilityState === "hidden" && historyRef.current?.acceptingEvents) void persistHistory("ACTIVE").catch(() => undefined);
    };
    const abandon = () => { void finalizeHistory("FAILED", "PAGEHIDE").catch(() => undefined); };
    document.addEventListener("visibilitychange", flushWhileHidden);
    window.addEventListener("pagehide", abandon);
    return () => {
      document.removeEventListener("visibilitychange", flushWhileHidden);
      window.removeEventListener("pagehide", abandon);
      void finalizeHistory("FAILED", "COMPONENT_UNMOUNT").catch(() => undefined);
      cleanup();
    };
  }, []);

  const start = async () => {
    if (startingRef.current || peerRef.current) return;
    startingRef.current = true;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setState("CONNECTING");
    setError("");
    setGatewayRuntime(null);
    setLiveTurns([]);
    setTeamResults([]);
    setActiveAgent("hugo");
    activeAgentRef.current = "hugo";
    const startup = new AbortController();
    startupRef.current = startup;
    startup.signal.addEventListener("abort", () => {
      if (generationRef.current !== generation || startup.signal.reason?.message !== "VOICE_STARTUP_TIMEOUT") return;
      cleanup();
      setError("La conexión de voz excedió el tiempo de espera. Revisa la sesión y el permiso del micrófono e inténtalo de nuevo.");
      setState("ERROR");
    }, { once: true });
    startupTimerRef.current = window.setTimeout(() => startup.abort(new Error("VOICE_STARTUP_TIMEOUT")), STARTUP_TIMEOUT_MS);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Este navegador no permite usar el microfono.");
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error("Tu sesion expiro. Inicia sesion nuevamente.");
      const gatewayUrl = selectHugoVoiceGateway(currentUser.uid, process.env.NEXT_PUBLIC_HUGO_VOICE_GATEWAY_URL);
      if (!gatewayUrl) throw new Error("El gateway server-side de María no esta configurado en esta version.");
      const idToken = await withVoiceStartupAbort(() => currentUser.getIdToken(), startup.signal);
      if (generationRef.current !== generation) return;
      const stream = await withVoiceStartupAbort(() => navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      }), startup.signal, lateStream => lateStream.getTracks().forEach(track => track.stop()));
      if (generationRef.current !== generation) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      const peer = new RTCPeerConnection();
      const audio = new Audio();
      audio.autoplay = true;
      peer.ontrack = event => { audio.srcObject = event.streams[0]; };
      stream.getTracks().forEach(track => peer.addTrack(track, stream));
      const channel = peer.createDataChannel("oai-events");
      const startedAt = performance.now();
      const fallbackSessionId = crypto.randomUUID();
      let sessionId = fallbackSessionId;
      let turnId: string | null = null;
      let responseId: string | null = null;
      let expectedVoice = "";
      let turnSequence = 0;
      const seenEventIds = new Set<string>();
      historyRef.current = { sessionId: "", gatewayCallId: "", model: "gateway-pending", voice: "gateway-pending", gateway: {}, realtime: {}, startedAt: Date.now(), audioUsage: { input: 0, cachedInput: 0, output: 0 }, turns: new Map(), events: new Map(), pendingTurns: new Map(), pendingEvents: new Map(), persistChain: Promise.resolve(), acceptingEvents: true, finalization: null };
      const upsertTurn = (key: string, value: VoiceTurnDraft) => { historyRef.current?.turns.set(key, value); historyRef.current?.pendingTurns.set(key, { ...value }); };
      const dirtyTurn = (key: string) => { const value = historyRef.current?.turns.get(key); if (value) historyRef.current?.pendingTurns.set(key, { ...value }); };
      const recordEvent = (value: VoiceEventDraft) => { historyRef.current?.events.set(value.eventId, value); historyRef.current?.pendingEvents.set(value.eventId, { ...value }); };
      window.__HUGO_REALTIME_TRACE__ = [];
      const trace = (type: string, detail?: Record<string, unknown>) => {
        const entry: TraceEntry = {
          at: new Date().toISOString(), elapsedMs: Math.round(performance.now() - startedAt),
          sessionId, turnId, responseId, type, detail,
        };
        const history = window.__HUGO_REALTIME_TRACE__ || [];
        history.push(entry);
        if (history.length > 500) history.splice(0, history.length - 500);
        window.__HUGO_REALTIME_TRACE__ = history;
        console.debug("[Hugo Realtime]", entry);
      };
      channel.onopen = () => trace("data_channel.open");
      channel.onclose = () => trace("data_channel.close");
      channel.onerror = () => trace("data_channel.error");
      channel.onmessage = message => {
        let event: RealtimeEvent;
        try { event = JSON.parse(String(message.data)); }
        catch { trace("event.invalid_json"); return; }
        const type = String(event.type || "event.unknown");
        if (historyRef.current && !historyRef.current.acceptingEvents) return;
        if (event.event_id) {
          if (seenEventIds.has(event.event_id)) {
            trace("event.duplicate", { eventType: type, eventId: event.event_id });
            return;
          }
          seenEventIds.add(event.event_id);
        }
        if (type === "session.created" && event.session?.id) {
          sessionId = event.session.id;
          const actualVoice = String(event.session?.audio?.output?.voice || event.session?.voice || "");
          if (!actualVoice || !expectedVoice || actualVoice !== expectedVoice) {
            trace("session.voice_mismatch", { expectedVoice, actualVoice: actualVoice || null });
            setError("La sesion de voz no confirmo la configuracion server-side esperada.");
            cleanup();
            setState("ERROR");
            return;
          }
          trace("session.voice_verified", { voice: actualVoice });
        }
        if (type === "session.created" && event.session?.id && historyRef.current) { historyRef.current.sessionId = event.session.id; void persistHistory("ACTIVE").catch(() => undefined); }
        if (type === "input_audio_buffer.speech_started") {
          turnSequence += 1;
          turnId = event.item_id || `${sessionId}:turn:${turnSequence}`;
          upsertTurn(`USER:${turnId}`, { turnId, responseId: null, speaker: "USER", text: "", timestampMs: Math.round(performance.now() - startedAt), durationMs: 0, interrupted: false, status: "RECORDING", transcriptionStatus: "PENDING_NATIVE", transcriptionConfidence: null });
        }
        if (type === "input_audio_buffer.speech_stopped") {
          if (event.item_id) turnId = event.item_id;
          const userTurn = turnId ? historyRef.current?.turns.get(`USER:${turnId}`) : null;
          if (userTurn) { userTurn.durationMs = Math.max(0, Math.round(performance.now() - startedAt) - userTurn.timestampMs); userTurn.status = "COMPLETED"; dirtyTurn(`USER:${turnId}`); }
        }
        if (type === "conversation.item.input_audio_transcription.completed") {
          const id = event.item_id || turnId;
          const userTurn = id ? historyRef.current?.turns.get(`USER:${id}`) : null;
          if (userTurn) { const logprobs = Array.isArray(event.logprobs) ? event.logprobs.map((entry: any) => Number(entry?.logprob)).filter(Number.isFinite) : []; userTurn.text = String(event.transcript || ""); userTurn.transcriptionStatus = "REALTIME_NATIVE"; userTurn.transcriptionConfidence = logprobs.length ? logprobs.reduce((sum: number, value: number) => sum + Math.exp(value), 0) / logprobs.length : null; dirtyTurn(`USER:${id}`); void persistHistory("ACTIVE").catch(() => undefined); }
          if (event.transcript) setLiveTurns(current => [...current.slice(-7), { speaker: "Tú", text: String(event.transcript) }]);
        }
        if (type === "conversation.item.input_audio_transcription.failed") {
          const id = event.item_id || turnId;
          const userTurn = id ? historyRef.current?.turns.get(`USER:${id}`) : null;
          if (userTurn) { userTurn.transcriptionStatus = "FAILED"; dirtyTurn(`USER:${id}`); void persistHistory("ACTIVE").catch(() => undefined); }
        }
        if (type === "response.created") {
          responseId = event.response?.id || null;
          if (audioRef.current) audioRef.current.muted = false;
          if (responseId) upsertTurn(`HUGO:${responseId}`, { turnId: turnId || responseId, responseId, speaker: "HUGO", text: "", timestampMs: Math.round(performance.now() - startedAt), durationMs: 0, interrupted: false, status: "IN_PROGRESS", transcriptionStatus: "REALTIME_NATIVE" });
        }
        // Audio already playing when the hang-up arrives is not the goodbye; wait for a fresh start.
        if (type === "output_audio_buffer.started" && endCallRef.current) endCallRef.current.heardGoodbye = true;
        if (type === "output_audio_buffer.stopped" && endCallRef.current?.heardGoodbye) finishRequestedCall();
        if (type === "response.output_audio_transcript.delta" && responseId) {
          const assistant = historyRef.current?.turns.get(`HUGO:${responseId}`);
          if (assistant) { assistant.text += String(event.delta || ""); dirtyTurn(`HUGO:${responseId}`); }
        }
        if (type === "response.output_audio_transcript.done") {
          const id = event.response_id || responseId;
          const assistant = id ? historyRef.current?.turns.get(`HUGO:${id}`) : null;
          if (assistant && event.transcript) { assistant.text = String(event.transcript); dirtyTurn(`HUGO:${id}`); }
          if (event.transcript) setLiveTurns(current => [...current.slice(-7), { speaker: teamAgents[activeAgentRef.current], text: String(event.transcript) }]);
        }
        trace(type, {
          eventId: event.event_id || null,
          itemId: event.item_id || event.item?.id || null,
          responseStatus: event.response?.status || null,
          errorCode: event.error?.code || null,
        });
        const persistedTypes = new Set(["session.created", "input_audio_buffer.speech_started", "input_audio_buffer.speech_stopped", "conversation.item.input_audio_transcription.completed", "conversation.item.input_audio_transcription.failed", "response.created", "response.output_audio_transcript.done", "response.done", "response.cancelled", "error"]);
        if (persistedTypes.has(type) && historyRef.current) {
          const eventId = String(event.event_id || `${type}:${Math.round(performance.now() - startedAt)}`);
          recordEvent({ eventId, type, turnId, responseId, timestampMs: Math.round(performance.now() - startedAt), detail: event.error?.code || event.response?.status || undefined });
        }
        if (type === "response.done" || type === "response.cancelled") {
          if (type === "response.done" && historyRef.current) {
            const usage = event.response?.usage || {};
            historyRef.current.audioUsage.input += Number(usage.input_token_details?.audio_tokens || 0);
            historyRef.current.audioUsage.cachedInput += Number(usage.input_token_details?.cached_tokens_details?.audio_tokens || 0);
            historyRef.current.audioUsage.output += Number(usage.output_token_details?.audio_tokens || 0);
          }
          const id = event.response?.id || responseId;
          const assistant = id ? historyRef.current?.turns.get(`HUGO:${id}`) : null;
          if (assistant) { assistant.durationMs = Math.max(0, Math.round(performance.now() - startedAt) - assistant.timestampMs); assistant.interrupted ||= type === "response.cancelled" || event.response?.status === "cancelled"; assistant.status = assistant.interrupted ? "INTERRUPTED" : "COMPLETED"; dirtyTurn(`HUGO:${id}`); }
          void persistHistory("ACTIVE").catch(() => undefined);
          responseId = null;
        }
      };
      peer.onconnectionstatechange = () => {
        trace("peer.connection_state", { state: peer.connectionState });
        if (generationRef.current !== generation) return;
        if (peer.connectionState === "connected") {
          if (startupTimerRef.current !== null) window.clearTimeout(startupTimerRef.current);
          startupTimerRef.current = null;
          startingRef.current = false;
          setState("LISTENING");
        }
        if (["failed", "closed"].includes(peer.connectionState)) {
          void finalizeHistory("FAILED", `PEER_${peer.connectionState.toUpperCase()}`).catch(() => undefined).finally(() => {
            cleanup();
            setState("IDLE");
          });
        }
      };
      peer.oniceconnectionstatechange = () => trace("peer.ice_state", { state: peer.iceConnectionState });
      peerRef.current = peer;
      streamRef.current = stream;
      audioRef.current = audio;
      channelRef.current = channel;

      const offer = await withVoiceStartupAbort(() => peer.createOffer(), startup.signal);
      await withVoiceStartupAbort(() => peer.setLocalDescription(offer), startup.signal);
      const answer = await withVoiceStartupAbort(() => new Promise<{ sdp: string; sessionId: string; model: string; voice: string; runtime?: any }>((resolve, reject) => {
        const gateway = new WebSocket(gatewayUrl!);
        gatewayRef.current = gateway;
        const timeout = window.setTimeout(() => reject(new Error("El gateway de voz no respondio a tiempo.")), 20000);
        gatewayTimerRef.current = timeout;
        gateway.onopen = () => gateway.send(JSON.stringify({ type: "authenticate", idToken, clientFeatures: ["END_CALL"] }));
        gateway.onerror = () => { window.clearTimeout(timeout); reject(new Error("No se pudo conectar con el gateway de voz.")); };
        gateway.onmessage = incoming => {
          let event: any;
          try { event = JSON.parse(String(incoming.data)); } catch { return; }
          if (event.type === "authenticated") gateway.send(JSON.stringify({ type: "offer", sdp: offer.sdp }));
          if (event.type === "answer") { window.clearTimeout(timeout); resolve({ sdp: String(event.sdp), sessionId: String(event.sessionId), model: String(event.model), voice: String(event.voice), runtime: event.runtime }); }
          if (event.type === "gateway.error") { window.clearTimeout(timeout); reject(new Error(`María no pudo establecer la llamada (${String(event.code || "GATEWAY_ERROR")}).`)); }
          if (event.type === "gateway.team_result") {
            if (isTeamAgent(event.agent)) { activeAgentRef.current = event.agent; setActiveAgent(event.agent); }
            setTeamResults(current => [...current.slice(-7), { agent: isTeamAgent(event.agent) ? teamAgents[event.agent] : "Hugo", activity: String(event.activity || "Consulta PAY0"), evidence: Array.isArray(event.evidence) ? event.evidence : [], toolsUsed: Array.isArray(event.toolsUsed) ? event.toolsUsed : [] }]);
          }
          if (String(event.type).startsWith("gateway.") && event.type !== "gateway.error") {
            trace(event.type, event);
            const eventId = String(event.eventId || `${event.type}:${event.responseId || event.toolCallId || "none"}:${Date.now()}`);
            recordEvent({ eventId, type: String(event.type), turnId: event.turnId || null, responseId: event.responseId || null, timestampMs: Math.round(performance.now() - startedAt), detail: JSON.stringify({ latencyMs: event.latencyMs ?? null, confirmationMs: event.confirmationMs ?? null, durationMs: event.durationMs ?? null, tool: event.tool ?? null, code: event.code ?? null }).slice(0, 500) });
          }
          if (event.type === "gateway.end_call_requested" && !endCallRef.current) endCallRef.current = { heardGoodbye: false, timer: window.setTimeout(finishRequestedCall, 15000) };
          if (event.type === "gateway.interruption_confirmed") {
            const interruptedResponseId = String(event.responseId || "");
            const active = interruptedResponseId ? historyRef.current?.turns.get(`HUGO:${interruptedResponseId}`) : null;
            if (active) { active.interrupted = true; active.status = "INTERRUPTED"; dirtyTurn(`HUGO:${interruptedResponseId}`); }
            trace("gateway.interruption_confirmed", event);
          }
        };
      }), startup.signal);
      if (generationRef.current !== generation) return;
      sessionId = answer.sessionId;
      expectedVoice = answer.voice;
      setGatewayRuntime(answer.runtime?.revision && answer.runtime?.commit
        ? { revision: String(answer.runtime.revision), commit: String(answer.runtime.commit) }
        : null);
      if (historyRef.current) { historyRef.current.gatewayCallId = answer.sessionId; historyRef.current.model = answer.model; historyRef.current.voice = answer.voice; historyRef.current.gateway = { service: answer.runtime?.service || null, revision: answer.runtime?.revision || null, commit: answer.runtime?.commit || null, branch: answer.runtime?.branch || null, version: answer.runtime?.version || null }; historyRef.current.realtime = { vad: answer.runtime?.vad || {}, transcription: answer.runtime?.transcription || {} }; }
      await withVoiceStartupAbort(() => peer.setRemoteDescription({ type: "answer", sdp: answer.sdp }), startup.signal);
    } catch (cause: any) {
      if (generationRef.current !== generation) return;
      await finalizeHistory("FAILED", "START_ERROR").catch(() => undefined);
      if (generationRef.current !== generation) return;
      cleanup();
      setState("ERROR");
      setError(cause?.message || "No se pudo iniciar la conversacion por voz.");
    }
  };

  const toggleMute = () => {
    const next = !muted;
    streamRef.current?.getAudioTracks().forEach(track => { track.enabled = !next; });
    setMuted(next);
  };

  return <div className="flex flex-col items-end gap-2">
    {auth.currentUser?.uid === ELIUT_VOICE_UID && <div className="flex w-full flex-wrap items-center gap-2 text-xs" aria-label="Equipo de voz de Hugo"><span className="text-slate-400">Habla para cambiar de agente:</span>{Object.entries(teamAgents).map(([id, name]) => <span key={id} className={`rounded-full border px-2 py-1 ${activeAgent === id ? "border-violet-400 bg-violet-500/20 text-violet-100" : "border-slate-700 text-slate-400"}`}>{name}</span>)}</div>}
    <span data-testid="hugo-voice-runtime" title={`Entorno: CANARY | Frontend: ${frontendCommit} | Gateway: ${gatewayRevision} | Gateway commit: ${gatewayCommit}`} className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-200">CANARY · {gatewayRevision} · frontend {frontendCommit.slice(0, 7)}</span>
    <div className="flex flex-wrap items-center justify-end gap-2">
      {state !== "LISTENING" ? <button type="button" onClick={() => void start()} disabled={state === "CONNECTING" || state === "FINALIZING"} className="flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-950/30 hover:bg-violet-500 disabled:opacity-60">
        {state === "CONNECTING" || state === "FINALIZING" ? <Loader2 className="animate-spin" size={17}/> : <Mic size={17}/>} {state === "CONNECTING" ? "Conectando..." : state === "FINALIZING" ? "Terminando..." : "Hablar con Hugo"}
      </button> : <>
        <span className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200"><Volume2 size={15}/> Conversacion activa</span>
        <button type="button" onClick={toggleMute} aria-label={muted ? "Activar microfono" : "Silenciar microfono"} className="rounded-xl border border-slate-700 p-2.5 text-slate-200 hover:bg-slate-800">{muted ? <MicOff size={17}/> : <Mic size={17}/>}</button>
        <button type="button" onClick={() => void stop()} aria-label="Terminar conversacion" className="rounded-xl bg-rose-600 p-2.5 text-white hover:bg-rose-500"><PhoneOff size={17}/></button>
      </>}
      {state === "CONNECTING" && <button type="button" onClick={() => { cleanup(); setMuted(false); setError(""); setState("IDLE"); }} className="rounded-xl border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">Cancelar conexión</button>}
    </div>
    {error && <p role="alert" className="max-w-sm text-right text-xs text-rose-300">{error}</p>}
    <p className="text-xs text-slate-400">Micrófono solamente · STT gpt-4o-mini-transcribe · conversación gpt-realtime-2.1 · voz marin</p>
    {(liveTurns.length > 0 || teamResults.length > 0) && <div className="w-full max-w-xl rounded-xl border border-slate-700 bg-slate-950 p-3 text-left text-sm text-slate-200" aria-live="polite">{liveTurns.map((turn, index) => <p key={index} className="mb-2"><span className="font-medium text-violet-300">{turn.speaker}: </span>{turn.text}</p>)}{teamResults.length > 0 && <details className="text-xs text-slate-400"><summary className="cursor-pointer">Evidencia de PAY0 ({teamResults.length} consultas)</summary>{teamResults.map((result, index) => <p key={index} className="mt-2">{result.agent}: {result.activity}. {result.evidence.map(item => `${item.kind} ${item.folio}`).join("; ")} · {result.toolsUsed.join(", ")}</p>)}</details>}</div>}
  </div>;
}
