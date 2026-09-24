"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, MicOff, PhoneOff, Volume2 } from "lucide-react";
import { createHugoRealtimeSession } from "@/services/agent007";

type VoiceState = "IDLE" | "CONNECTING" | "LISTENING" | "ERROR";

export default function HugoRealtimeVoice() {
  const [state, setState] = useState<VoiceState>("IDLE");
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState("");
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const stop = () => {
    peerRef.current?.close();
    streamRef.current?.getTracks().forEach(track => track.stop());
    if (audioRef.current) audioRef.current.srcObject = null;
    peerRef.current = null;
    streamRef.current = null;
    setMuted(false);
    setState("IDLE");
  };

  useEffect(() => () => {
    peerRef.current?.close();
    streamRef.current?.getTracks().forEach(track => track.stop());
  }, []);

  const start = async () => {
    if (state === "CONNECTING" || state === "LISTENING") return;
    setState("CONNECTING");
    setError("");
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Este navegador no permite usar el microfono.");
      const session = await createHugoRealtimeSession();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const peer = new RTCPeerConnection();
      const audio = new Audio();
      audio.autoplay = true;
      peer.ontrack = event => { audio.srcObject = event.streams[0]; };
      stream.getTracks().forEach(track => peer.addTrack(track, stream));
      peer.createDataChannel("oai-events");
      peer.onconnectionstatechange = () => {
        if (peer.connectionState === "connected") setState("LISTENING");
        if (["failed", "closed", "disconnected"].includes(peer.connectionState)) stop();
      };
      peerRef.current = peer;
      streamRef.current = stream;
      audioRef.current = audio;

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      const response = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        body: offer.sdp,
        headers: { Authorization: `Bearer ${session.clientSecret}`, "Content-Type": "application/sdp" },
      });
      if (!response.ok) throw new Error("OpenAI no pudo establecer la llamada.");
      await peer.setRemoteDescription({ type: "answer", sdp: await response.text() });
    } catch (cause: any) {
      stop();
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
