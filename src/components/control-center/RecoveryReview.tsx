"use client";
import { useEffect, useState } from "react";
import { acknowledgeOperationRecoveryReview, listOperationRecoveryReviews, type RecoveryReviewRow } from "@/services/controlCenter";

export default function RecoveryReview() {
  const [rows, setRows] = useState<RecoveryReviewRow[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [truncated, setTruncated] = useState(false);
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  async function load(cursor: string | null | undefined = cursors.at(-1)) {
    setBusy(true); setError("");
    try { const result = await listOperationRecoveryReviews(cursor || undefined); setRows(result.rows); setTruncated(result.truncated); setNextCursor(result.nextCursor); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "No se pudo consultar la revisión."); }
    finally { setBusy(false); }
  }
  useEffect(() => { void load(); }, []);
  async function acknowledge(row: RecoveryReviewRow) {
    setBusy(true); setError("");
    try { await acknowledgeOperationRecoveryReview({ jobId: row.id, note: notes[row.id] || "" }); await load(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "No se pudo registrar el acuse."); }
    finally { setBusy(false); }
  }
  return <details className="my-4 rounded-xl border border-white/10 p-4">
    <summary className="cursor-pointer font-semibold">Revisión administrativa de recuperaciones</summary>
    <p className="my-3 text-sm text-slate-400">Registra que revisaste una incidencia y el siguiente paso. El acuse no reintenta operaciones ni declara una recuperación exitosa.</p>
    <button disabled={busy} onClick={() => { setCursors([undefined]); void load(null); }} className="rounded-lg border border-white/15 px-3 py-2 text-sm disabled:opacity-50">Actualizar incidencias</button>
    {error && <p role="alert" className="mt-3 text-sm text-rose-300">{error}</p>}
    {!busy && !error && !rows.length && <p className="mt-3 text-sm text-slate-400">No hay recuperaciones pendientes de revisión.</p>}
    {truncated && <p className="mt-3 text-sm text-amber-300">Esta página muestra hasta 50 incidencias. Hay más registros en la página siguiente.</p>}
    <div className="mt-3 flex gap-2">
      <button disabled={busy || cursors.length < 2} onClick={() => { const previous = cursors.slice(0, -1); setCursors(previous); void load(previous.at(-1) || null); }} className="rounded-lg border border-white/15 px-3 py-2 text-sm disabled:opacity-50">Anterior</button>
      <button disabled={busy || !nextCursor} onClick={() => { if (nextCursor) { setCursors(current => [...current, nextCursor]); void load(nextCursor); } }} className="rounded-lg border border-white/15 px-3 py-2 text-sm disabled:opacity-50">Siguiente</button>
    </div>
    {rows.map(row => <article key={row.id} className="mt-3 rounded-lg bg-slate-900 p-3 text-sm">
      <p>{row.kind} · Solicitud {row.solicitudId} · {row.attempts} intentos</p>
      <p className="mt-1 text-amber-200">{row.lastErrorCode || "Requiere revisión"}</p>
      {row.acknowledged ? <p className="mt-2 text-slate-300">Revisión registrada: {row.note}</p> : <>
        <label className="mt-2 block">Acuerdo de revisión<textarea maxLength={500} value={notes[row.id] || ""} onChange={event => setNotes(current => ({ ...current, [row.id]: event.target.value }))} className="mt-1 block w-full rounded-lg border border-white/15 bg-slate-950 p-2" /></label>
        <button disabled={busy || !notes[row.id]?.trim()} onClick={() => void acknowledge(row)} className="mt-2 rounded-lg bg-sky-700 px-3 py-2 disabled:opacity-50">Registrar revisión sin reintentar</button>
      </>}
    </article>)}
  </details>;
}
