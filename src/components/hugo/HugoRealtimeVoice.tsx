"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, MicOff, PhoneOff, Volume2 } from "lucide-react";
import { createHugoRealtimeSession } from "@/services/agent007";

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

declare global {
  interface Window { __HUGO_REALTIME_TRACE__?: TraceEntry[]; }
}

export default function HugoRealtimeVoice() {
  const [state, setState] = useState<VoiceState>("IDLE");
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState("");
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const startingRef = useRef(false);
  const generationRef = useRef(0);

  const cleanup = () => {
    generationRef.current += 1;
    startingRef.current = false;
    const channel = channelRef.current;
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
    peerRef.current = null;
    streamRef.current = null;
    audioRef.current = null;
  };

  const stop = () => {
    cleanup();
    setMuted(false);
    setState("IDLE");
  };

  useEffect(() => () => cleanup(), []);

  const start = async () => {
    if (startingRef.current || peerRef.current) return;
    startingRef.current = true;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setState("CONNECTING");
    setError("");
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Este navegador no permite usar el microfono.");
      const session = await createHugoRealtimeSession();
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
        if (type === "input_audio_buffer.speech_started") {
          turnSequence += 1;
          turnId = event.item_id || `${sessionId}:turn:${turnSequence}`;
          if (audioRef.current) audioRef.current.muted = true;
        }
        if (type === "input_audio_buffer.speech_stopped" && event.item_id) turnId = event.item_id;
        if (type === "response.created") {
          responseId = event.response?.id || null;
          if (audioRef.current) audioRef.current.muted = false;
        }
        trace(type, {
          eventId: event.event_id || null,
          itemId: event.item_id || event.item?.id || null,
          responseStatus: event.response?.status || null,
          errorCode: event.error?.code || null,
        });
        if (type === "response.done" || type === "response.cancelled") responseId = null;
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
      const response = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        body: offer.sdp,
        headers: { Authorization: `Bearer ${session.clientSecret}`, "Content-Type": "application/sdp" },
      });
      const responseBody = await response.text();
      if (!response.ok) {
        let errorCode = `HTTP_${response.status}`;
        try { errorCode = JSON.parse(responseBody)?.error?.code || errorCode; } catch {}
        throw new Error(`OpenAI no pudo establecer la llamada (${errorCode}).`);
      }
      if (generationRef.current !== generation) return;
      await peer.setRemoteDescription({ type: "answer", sdp: responseBody });
    } catch (cause: any) {
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
