"use client";

import React, { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  getDispersionCashSignatureRequest,
  submitDispersionCashSignature,
  type DispersionCashSignatureRequest,
} from "@/services/dispersionCashSignature";

function formatMoney(value: number | null | undefined, currency: string) {
  const amount = Number(value || 0);
  return `$${amount.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency || "MXN"}`;
}

export default function PublicCashSignaturePage() {
  const params = useParams<{ token: string }>();
  const token = decodeURIComponent(params.token || "");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const hasInkRef = useRef(false);
  // A tap is not a signature: ink only counts after a stroke of real length.
  const inkDistanceRef = useRef(0);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const MIN_INK_DISTANCE_PX = 40;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ receiverMatches: boolean; folio: string } | null>(null);
  const [info, setInfo] = useState<DispersionCashSignatureRequest | null>(null);
  const [signerName, setSignerName] = useState("");
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const result = await getDispersionCashSignatureRequest(token);
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
    if (loading || error || done || !info) return;

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
    inkDistanceRef.current = 0;
    lastPointRef.current = null;
  }, [loading, error, done, info]);

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
    lastPointRef.current = p;
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
    const last = lastPointRef.current;
    if (last) inkDistanceRef.current += Math.hypot(p.x - last.x, p.y - last.y);
    lastPointRef.current = p;
    if (inkDistanceRef.current >= MIN_INK_DISTANCE_PX) hasInkRef.current = true;
  }

  function end(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    event.preventDefault();
    drawingRef.current = false;
    lastPointRef.current = null;
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
    inkDistanceRef.current = 0;
    lastPointRef.current = null;
  }

  async function submit() {
    if (!canvasRef.current || saving) return;
    if (signerName.trim().length < 3) {
      setError("Escribe el nombre completo de quien recibe el efectivo.");
      return;
    }
    if (!accepted) {
      setError("Confirma que recibiste el efectivo para poder firmar.");
      return;
    }
    if (!hasInkRef.current) {
      setError("Firma dentro del recuadro con un trazo completo, no solo un punto.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const result = await submitDispersionCashSignature({
        token,
        signerName: signerName.trim(),
        acceptedReceipt: accepted,
        signatureDataUrl: canvasRef.current.toDataURL("image/png"),
      });
      setDone({ receiverMatches: result.receiverMatches, folio: result.folio });
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
          PAY0 · Recibo de efectivo
        </div>
        <h1 className="mt-3 text-2xl font-semibold">Firma de recepcion de efectivo</h1>

        {loading ? (
          <p className="mt-6 text-sm text-slate-300">Validando link...</p>
        ) : done ? (
          <div className="mt-6 rounded-2xl border border-emerald-400/30 bg-emerald-500/10 p-4 text-sm text-emerald-100">
            Firma recibida. El recibo de la dispersion {done.folio} quedo guardado en PAY0.
            {done.receiverMatches ? null : (
              <div className="mt-2 text-xs text-amber-200">
                El nombre firmado no coincide con el beneficiario registrado. La firma quedo guardada y la dispersion
                aparece en PAY0 con la marca &quot;FIRMA DISTINTA DEL BENEFICIARIO&quot; para que el equipo la verifique.
              </div>
            )}
          </div>
        ) : error && !info ? (
          <div className="mt-6 rounded-2xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-100">
            {error}
          </div>
        ) : info ? (
          <div className="mt-6 space-y-4">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-200">
              <div>Dispersion: <span className="font-semibold text-white">{info.dispersionFolio || "---"}</span></div>
              <div>Beneficiario: <span className="font-semibold text-white">{info.expectedReceiverName || "---"}</span></div>
              <div className="mt-2 text-base">
                Monto recibido: <span className="font-bold text-emerald-300">{formatMoney(info.amount, info.currency)}</span>
              </div>
              <div className="mt-1 text-[11px] text-slate-400">El monto es fijo. Solo se captura el nombre de quien recibe y su firma.</div>
            </div>

            <label className="block text-sm text-slate-200">Nombre completo de quien recibe el efectivo
              <input
                value={signerName}
                onChange={(event) => setSignerName(event.target.value)}
                maxLength={180}
                placeholder="Nombre y apellidos"
                className="mt-1 h-12 w-full rounded-xl border border-white/10 bg-[#070b15] px-3 text-sm outline-none focus:border-sky-400"
                disabled={saving}
              />
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
              <span>{info.acceptanceText}</span>
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
                {saving ? "Enviando..." : "Firmar recibo"}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
