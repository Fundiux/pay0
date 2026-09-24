"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, MicOff, PhoneOff, Volume2 } from "lucide-react";
import { auth } from "@/lib/firebaseClient";
import { createHugoRealtimeSession, saveHugoVoiceHistory } from "@/services/agent007";

type VoiceState = "IDLE" | "CONNECTING" | "LISTENING" | "ERROR";
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
type VoiceTurnDraft = { turnId: string; responseId: string | null; speaker: "USER" | "HUGO"; text: string; timestampMs: number; durationMs: number; interrupted: boolean; status: string; transcriptionStatus: string };
type VoiceHistoryDraft = { sessionId: string; model: string; startedAt: number; audioUsage: { input: number; cachedInput: number; output: number }; turns: Map<string, VoiceTurnDraft>; events: Map<string, { eventId: string; type: string; turnId: string | null; responseId: string | null; timestampMs: number; detail?: string }> };

declare global {
  interface Window { __HUGO_REALTIME_TRACE__?: TraceEntry[]; }
}

export default function HugoRealtimeVoice({ onHistorySaved }: { onHistorySaved?: () => void } = {}) {
  const [state, setState] = useState<VoiceState>("IDLE");
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState("");
  const [canaryRequested, setCanaryRequested] = useState(false);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const gatewayRef = useRef<WebSocket | null>(null);
  const startingRef = useRef(false);
  const generationRef = useRef(0);
  const historyRef = useRef<VoiceHistoryDraft | null>(null);

  const persistHistory = async (status: "ACTIVE" | "COMPLETED" | "FAILED") => {
    const history = historyRef.current;
    if (!history?.sessionId) return;
    await saveHugoVoiceHistory({ sessionId: history.sessionId, model: history.model, status,
      durationMs: Math.max(0, Date.now() - history.startedAt), audioUsage: history.audioUsage, turns: [...history.turns.values()], events: [...history.events.values()] });
    onHistorySaved?.();
  };

  const cleanup = () => {
    generationRef.current += 1;
    startingRef.current = false;
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

  const stop = () => {
    void persistHistory("COMPLETED").catch(() => undefined);
    cleanup();
    setMuted(false);
    setState("IDLE");
  };

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("voiceCanary") === "1";
    if (requested) window.sessionStorage.setItem("hugoVoiceCanary", "1");
    setCanaryRequested(requested || window.sessionStorage.getItem("hugoVoiceCanary") === "1");
    return () => cleanup();
  }, []);

  const start = async () => {
    if (startingRef.current || peerRef.current) return;
    startingRef.current = true;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setState("CONNECTING");
    setError("");
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Este navegador no permite usar el microfono.");
      const gatewayUrl = process.env.NEXT_PUBLIC_HUGO_VOICE_GATEWAY_URL;
      const requestedNow = new URLSearchParams(window.location.search).get("voiceCanary") === "1" || window.sessionStorage.getItem("hugoVoiceCanary") === "1";
      if (requestedNow && !gatewayUrl) throw new Error("El canario server-side no esta configurado en esta version.");
      const useGateway = requestedNow;
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error("Tu sesion expiro. Inicia sesion nuevamente.");
      const idToken = useGateway ? await currentUser.getIdToken() : "";
      const legacySession = useGateway ? null : await createHugoRealtimeSession();
      if (generationRef.current !== generation) return;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
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
      let turnSequence = 0;
      const seenEventIds = new Set<string>();
      historyRef.current = { sessionId: "", model: legacySession?.model || "gateway-pending", startedAt: Date.now(), audioUsage: { input: 0, cachedInput: 0, output: 0 }, turns: new Map(), events: new Map() };
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
        if (event.event_id) {
          if (seenEventIds.has(event.event_id)) {
            trace("event.duplicate", { eventType: type, eventId: event.event_id });
            return;
          }
          seenEventIds.add(event.event_id);
        }
        if (type === "session.created" && event.session?.id) sessionId = event.session.id;
        if (type === "session.created" && event.session?.id && historyRef.current) { historyRef.current.sessionId = event.session.id; void persistHistory("ACTIVE").catch(() => undefined); }
        if (type === "input_audio_buffer.speech_started") {
          turnSequence += 1;
          turnId = event.item_id || `${sessionId}:turn:${turnSequence}`;
          if (audioRef.current) audioRef.current.muted = true;
          const active = responseId ? historyRef.current?.turns.get(`HUGO:${responseId}`) : null;
          if (active) { active.interrupted = true; active.status = "INTERRUPTED"; }
          historyRef.current?.turns.set(`USER:${turnId}`, { turnId, responseId: null, speaker: "USER", text: "", timestampMs: Math.round(performance.now() - startedAt), durationMs: 0, interrupted: false, status: "RECORDING", transcriptionStatus: "NOT_ENABLED_NO_SECOND_INFERENCE" });
        }
        if (type === "input_audio_buffer.speech_stopped") {
          if (event.item_id) turnId = event.item_id;
          const userTurn = turnId ? historyRef.current?.turns.get(`USER:${turnId}`) : null;
          if (userTurn) { userTurn.durationMs = Math.max(0, Math.round(performance.now() - startedAt) - userTurn.timestampMs); userTurn.status = "COMPLETED"; }
        }
        if (type === "conversation.item.input_audio_transcription.completed") {
          const id = event.item_id || turnId;
          const userTurn = id ? historyRef.current?.turns.get(`USER:${id}`) : null;
          if (userTurn) { userTurn.text = String(event.transcript || ""); userTurn.transcriptionStatus = "REALTIME_NATIVE"; }
        }
        if (type === "response.created") {
          responseId = event.response?.id || null;
          if (audioRef.current) audioRef.current.muted = false;
          if (responseId) historyRef.current?.turns.set(`HUGO:${responseId}`, { turnId: turnId || responseId, responseId, speaker: "HUGO", text: "", timestampMs: Math.round(performance.now() - startedAt), durationMs: 0, interrupted: false, status: "IN_PROGRESS", transcriptionStatus: "REALTIME_NATIVE" });
        }
        if (type === "response.output_audio_transcript.delta" && responseId) {
          const assistant = historyRef.current?.turns.get(`HUGO:${responseId}`);
          if (assistant) assistant.text += String(event.delta || "");
        }
        if (type === "response.output_audio_transcript.done") {
          const id = event.response_id || responseId;
          const assistant = id ? historyRef.current?.turns.get(`HUGO:${id}`) : null;
          if (assistant && event.transcript) assistant.text = String(event.transcript);
        }
        trace(type, {
          eventId: event.event_id || null,
          itemId: event.item_id || event.item?.id || null,
          responseStatus: event.response?.status || null,
          errorCode: event.error?.code || null,
        });
        const persistedTypes = new Set(["session.created", "input_audio_buffer.speech_started", "input_audio_buffer.speech_stopped", "conversation.item.input_audio_transcription.completed", "response.created", "response.output_audio_transcript.done", "response.done", "response.cancelled", "error"]);
        if (persistedTypes.has(type) && historyRef.current) {
          const eventId = String(event.event_id || `${type}:${Math.round(performance.now() - startedAt)}`);
          historyRef.current.events.set(eventId, { eventId, type, turnId, responseId, timestampMs: Math.round(performance.now() - startedAt), detail: event.error?.code || event.response?.status || undefined });
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
          if (assistant) { assistant.durationMs = Math.max(0, Math.round(performance.now() - startedAt) - assistant.timestampMs); assistant.interrupted ||= type === "response.cancelled" || event.response?.status === "cancelled"; assistant.status = assistant.interrupted ? "INTERRUPTED" : "COMPLETED"; }
          void persistHistory("ACTIVE").catch(() => undefined);
          responseId = null;
        }
      };
      peer.onconnectionstatechange = () => {
        trace("peer.connection_state", { state: peer.connectionState });
        if (generationRef.current !== generation) return;
        if (peer.connectionState === "connected") {
          startingRef.current = false;
          setState("LISTENING");
        }
        if (["failed", "closed"].includes(peer.connectionState)) stop();
      };
      peer.oniceconnectionstatechange = () => trace("peer.ice_state", { state: peer.iceConnectionState });
      peerRef.current = peer;
      streamRef.current = stream;
      audioRef.current = audio;
      channelRef.current = channel;

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      const answer = useGateway ? await new Promise<{ sdp: string; sessionId: string; model: string }>((resolve, reject) => {
        const gateway = new WebSocket(gatewayUrl!);
        gatewayRef.current = gateway;
        const timeout = window.setTimeout(() => reject(new Error("El gateway de voz no respondio a tiempo.")), 20000);
        gateway.onopen = () => gateway.send(JSON.stringify({ type: "authenticate", idToken }));
        gateway.onerror = () => { window.clearTimeout(timeout); reject(new Error("No se pudo conectar con el gateway de voz.")); };
        gateway.onmessage = incoming => {
          let event: any;
          try { event = JSON.parse(String(incoming.data)); } catch { return; }
          if (event.type === "authenticated") gateway.send(JSON.stringify({ type: "offer", sdp: offer.sdp }));
          if (event.type === "answer") { window.clearTimeout(timeout); resolve({ sdp: String(event.sdp), sessionId: String(event.sessionId), model: String(event.model) }); }
          if (event.type === "gateway.error") { window.clearTimeout(timeout); reject(new Error(`Hugo no pudo establecer la llamada (${String(event.code || "GATEWAY_ERROR")}).`)); }
          if (event.type === "gateway.interruption") trace("gateway.interruption", event);
        };
      }) : await (async () => {
        const response = await fetch("https://api.openai.com/v1/realtime/calls", { method: "POST", body: offer.sdp,
          headers: { Authorization: `Bearer ${legacySession!.clientSecret}`, "Content-Type": "application/sdp" } });
        const sdp = await response.text();
        if (!response.ok) throw new Error(`OpenAI no pudo establecer la llamada (HTTP_${response.status}).`);
        return { sdp, sessionId: fallbackSessionId, model: legacySession!.model };
      })();
      if (generationRef.current !== generation) return;
      sessionId = answer.sessionId;
      if (historyRef.current) { historyRef.current.sessionId = answer.sessionId; historyRef.current.model = answer.model; }
      await peer.setRemoteDescription({ type: "answer", sdp: answer.sdp });
    } catch (cause: any) {
      void persistHistory("FAILED").catch(() => undefined);
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
    {canaryRequested && <span data-testid="hugo-voice-runtime" className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-1 text-[10px] text-sky-200">Canary server-side</span>}
    <div className="flex flex-wrap items-center justify-end gap-2">
      {state !== "LISTENING" ? <button type="button" onClick={() => void start()} disabled={state === "CONNECTING"} className="flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-950/30 hover:bg-violet-500 disabled:opacity-60">
        {state === "CONNECTING" ? <Loader2 className="animate-spin" size={17}/> : <Mic size={17}/>} {state === "CONNECTING" ? "Conectando..." : "Hablar con Hugo"}
      </button> : <>
        <span className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200"><Volume2 size={15}/> Conversacion activa</span>
        <button type="button" onClick={toggleMute} aria-label={muted ? "Activar microfono" : "Silenciar microfono"} className="rounded-xl border border-slate-700 p-2.5 text-slate-200 hover:bg-slate-800">{muted ? <MicOff size={17}/> : <Mic size={17}/>}</button>
        <button type="button" onClick={stop} aria-label="Terminar conversacion" className="rounded-xl bg-rose-600 p-2.5 text-white hover:bg-rose-500"><PhoneOff size={17}/></button>
      </>}
    </div>
    {error && <p role="alert" className="max-w-sm text-right text-xs text-rose-300">{error}</p>}
  </div>;
}
