"use client";

import React, { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  getSolicitudSignatureRequest,
  submitSolicitudSignature,
} from "@/services/signatureLinks";

export default function PublicSignaturePage() {
  const params = useParams<{ token: string }>();
  const token = decodeURIComponent(params.token || "");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const hasInkRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [constanciaPending, setConstanciaPending] = useState(false);
  const [info, setInfo] = useState<{ solicitudFolio?: string | null; clienteNombre?: string | null; expiresAtMillis?: number }>({});
  const [signerName, setSignerName] = useState("");
  const [signerRole, setSignerRole] = useState("");
  const [receiptLocation, setReceiptLocation] = useState("");
  const [receiptAddress, setReceiptAddress] = useState("");
  const [observations, setObservations] = useState("");
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const result = await getSolicitudSignatureRequest(token);
        if (!cancelled) setInfo(result);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || "Link invalido o expirado.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (loading || error || done) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 2.6;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    hasInkRef.current = false;
  }, [loading, error, done]);

  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const p = point(event);
    if (!canvas || !ctx || !p || saving) return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    hasInkRef.current = true;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  }

  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current || saving) return;
    const p = point(event);
    const ctx = canvasRef.current?.getContext("2d");
    if (!p || !ctx) return;
    event.preventDefault();
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }

  function end(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    event.preventDefault();
    drawingRef.current = false;
    try {
      canvasRef.current?.releasePointerCapture(event.pointerId);
    } catch {}
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || saving) return;
    const rect = canvas.getBoundingClientRect();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.strokeStyle = "#0f172a";
    hasInkRef.current = false;
  }

  async function submit() {
    if (!canvasRef.current || saving) return;
    if (!signerName.trim()) {
      setError("Escribe tu nombre.");
      return;
    }
    if (!accepted) {
      setError("Debes aceptar la recepcion/conformidad para firmar.");
      return;
    }
    if (!signerRole.trim() || !receiptLocation.trim() || !receiptAddress.trim()) {
      setError("Indica tu cargo, el lugar y la dirección reales de recepción o prestación.");
      return;
    }
    if (!hasInkRef.current) {
      setError("Firma dentro del recuadro.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const result = await submitSolicitudSignature({
        token,
        signerName: signerName.trim(),
        signerRole: signerRole.trim(),
        receiptLocation: receiptLocation.trim(),
        receiptAddress: receiptAddress.trim(),
        observations: observations.trim(),
        acceptedNoClaimPolicy: accepted,
        signatureDataUrl: canvasRef.current.toDataURL("image/png"),
      });
      setConstanciaPending(result.constanciaPending === true);
      setDone(true);
    } catch (err: any) {
      setError(err?.message || "No se pudo guardar la firma.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#07111f] px-4 py-8 text-white">
      <div className="mx-auto max-w-xl rounded-3xl border border-white/10 bg-[#0f1624] p-5 shadow-2xl">
        <div className="text-[11px] font-bold uppercase tracking-[0.25em] text-emerald-300">
          PAY0 · Firma de recepción
        </div>
        <h1 className="mt-3 text-2xl font-semibold">Recepción y conformidad</h1>

        {loading ? (
          <p className="mt-6 text-sm text-slate-300">Validando link...</p>
        ) : done ? (
          <div className="mt-6 rounded-2xl border border-emerald-400/30 bg-emerald-500/10 p-4 text-sm text-emerald-100">
            {constanciaPending ? "Firma recibida y guardada. El responsable del expediente podrá completar la constancia; no necesitas volver a firmar." : "Firma recibida. PAY0 generó la constancia y la vinculó al expediente."}
          </div>
        ) : error && !info.solicitudFolio ? (
          <div className="mt-6 rounded-2xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-100">
            {error}
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-200">
              <div>Solicitud: <span className="font-semibold text-white">{info.solicitudFolio || "---"}</span></div>
              <div>Cliente: <span className="font-semibold text-white">{info.clienteNombre || "---"}</span></div>
            </div>

            <input
              value={signerName}
              onChange={(event) => setSignerName(event.target.value)}
              placeholder="Nombre de quien recibe / acepta"
              className="h-12 w-full rounded-xl border border-white/10 bg-[#070b15] px-3 text-sm outline-none focus:border-sky-400"
              disabled={saving}
            />
            <input
              value={signerRole}
              onChange={(event) => setSignerRole(event.target.value)}
              placeholder="Cargo o relación con quien recibe"
              className="h-12 w-full rounded-xl border border-white/10 bg-[#070b15] px-3 text-sm outline-none focus:border-sky-400"
              disabled={saving}
            />

            <label className="block text-sm text-slate-200">Lugar de recepción / prestación
              <input value={receiptLocation} onChange={event => setReceiptLocation(event.target.value)} maxLength={240}
                placeholder="Obra, almacén, oficina, embarcación…" disabled={saving}
                className="mt-1 h-12 w-full rounded-xl border border-white/10 bg-[#070b15] px-3 text-sm outline-none focus:border-sky-400" />
            </label>
            <label className="block text-sm text-slate-200">Dirección real de recepción / prestación
              <textarea value={receiptAddress} onChange={event => setReceiptAddress(event.target.value)} maxLength={500}
                placeholder="Indica dónde se recibió el producto o se prestó el servicio" disabled={saving}
                className="mt-1 min-h-20 w-full rounded-xl border border-white/10 bg-[#070b15] p-3 text-sm outline-none focus:border-sky-400" />
            </label>
            <p className="text-xs text-slate-400">Esta ubicación es la que declaras para la operación. No se completa con el domicilio fiscal ni con la ubicación de tu dispositivo.</p>
            <label className="block text-sm text-slate-200">Observaciones (opcional)
              <textarea value={observations} onChange={event => setObservations(event.target.value)} maxLength={600} disabled={saving}
                className="mt-1 min-h-20 w-full rounded-xl border border-white/10 bg-[#070b15] p-3 text-sm outline-none focus:border-sky-400" />
            </label>

            <div className="rounded-2xl border border-white/10 bg-white p-2">
              <canvas
                ref={canvasRef}
                className="h-56 w-full touch-none rounded-xl bg-white"
                onPointerDown={start}
                onPointerMove={move}
                onPointerUp={end}
                onPointerCancel={end}
              />
            </div>

            <label className="flex gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-xs leading-5 text-slate-200">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(event) => setAccepted(event.target.checked)}
                className="mt-1"
                disabled={saving}
              />
              <span>
                Confirmo la recepción y conformidad de los bienes o servicios en el lugar y dirección declarados, salvo las observaciones registradas, y acepto la política de no reclamación posterior aplicable.
              </span>
            </label>

            {error ? <div className="text-sm text-red-300">{error}</div> : null}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={clear}
                disabled={saving}
                className="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-slate-100 disabled:opacity-50"
              >
                Limpiar
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={saving}
                className="flex-1 rounded-xl bg-emerald-500 px-4 py-3 text-sm font-bold text-[#03130d] disabled:opacity-50"
              >
                {saving ? "Enviando..." : "Firmar y enviar"}
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
