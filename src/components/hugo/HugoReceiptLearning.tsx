"use client";

import { useEffect, useRef, useState } from "react";
import { useUserProfile } from "@/lib/useUserProfile";
import ReceiptEvidenceSummary from "@/components/pagos/ReceiptEvidenceSummary";
import { correctPagoReceiptSemanticField, parsePagoReceiptPdfFile, type ParsedPagoReceipt, type ReceiptCorrectionField } from "@/services/pagoReceipt";

export default function HugoReceiptLearning() {
  const { profile, profileUid } = useUserProfile();
  const identity = JSON.stringify([profileUid, profile?.rootId, profile?.role, profile?.active, profile?.disabled]);
  const allowed = !!profileUid && !!profile?.rootId && profile?.active !== false && profile?.disabled !== true &&
    ["superadmin", "admin", "operador"].includes(String(profile?.role));
  return <ReceiptLearningContent key={identity} allowed={allowed} />;
}

function ReceiptLearningContent({ allowed }: { allowed: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const [receipt, setReceipt] = useState<ParsedPagoReceipt | null>(null);
  const [busy, setBusy] = useState(false), [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState(""), [error, setError] = useState("");
  const alive = useRef(true), generation = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const current = (version: number) => alive.current && version === generation.current;

  function selectFile(next: File | null) {
    generation.current++;
    setFile(next); setReceipt(null); setNotice(""); setError(""); setBusy(false); setEditing(false);
  }

  async function analyze() {
    if (!allowed || !file || busy || editing) return;
    setNotice(""); setError("");
    if (!file.size || file.size > 1024 * 1024) { setError("Selecciona un comprobante de hasta 1 MB."); return; }
    const version = ++generation.current;
    setBusy(true); setReceipt(null);
    try {
      const result = await parsePagoReceiptPdfFile(file);
      if (!current(version)) return;
      if (!result.semanticReceipt?.fields || typeof result.semanticReceipt.fields !== "object")
        throw new Error("La lectura no devolvió evidencia revisable. Intenta de nuevo.");
      setReceipt(result);
      const restored = Object.values(result.semanticReceipt.fields).some(field => field?.provenance === "HUMAN_CORRECTION");
      setNotice(restored ? "Comprobante analizado. Se recuperaron tus correcciones guardadas para este documento." : "Comprobante analizado. Revisa lo que María entendió y corrige los campos que lo necesiten.");
    } catch (cause) {
      if (current(version)) setError(cause instanceof Error ? cause.message : "No se pudo analizar el comprobante.");
    } finally { if (current(version)) setBusy(false); }
  }

  async function correct(field: ReceiptCorrectionField, value: string, correctedField = field) {
    if (!allowed || busy || !receipt?.analysisId || !Number.isSafeInteger(receipt.correctionVersion))
      throw new Error("Vuelve a analizar el comprobante antes de corregir.");
    const version = generation.current, previous = receipt;
    setBusy(true); setNotice(""); setError("");
    try {
      const result = await correctPagoReceiptSemanticField({ analysisId: previous.analysisId!, field, correctedField,
        correctedValue: value, expectedCorrectionVersion: previous.correctionVersion });
      if (!current(version)) throw new Error("La sesión o el documento cambiaron. Vuelve a analizarlo.");
      if (result.ok !== true || !result.semanticReceipt?.fields || !Number.isSafeInteger(result.correctionVersion))
        throw new Error("No se pudo confirmar que la corrección quedara guardada. Vuelve a analizar el documento.");
      setReceipt({ ...previous, ...result.receipt, analysisId: previous.analysisId, contentSha256: previous.contentSha256,
        semanticReceipt: result.semanticReceipt, correctionVersion: result.correctionVersion,
        learningContext: result.learningContext, identification: result.identification });
      setNotice("Corrección guardada y lectura actualizada. Se conservará al volver a analizar este documento con tu usuario.");
    } catch (cause) {
      if (current(version)) setError(cause instanceof Error ? cause.message : "No se pudo guardar la corrección.");
      throw cause;
    } finally { if (current(version)) setBusy(false); }
  }

  const canCorrect = !!receipt?.analysisId && Number.isSafeInteger(receipt?.correctionVersion);
  return <section aria-label="Aprender de un comprobante" className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
    <div><h2 className="font-semibold text-white">Revisar un comprobante con María</h2>
      <p className="mt-1 text-sm text-slate-400">Selecciona un PDF o imagen, revisa la lectura y guarda tus correcciones. El análisis conserva evidencia y no registra un pago.</p></div>
    {!allowed ? <p className="text-sm text-amber-200">Inicia una sesión autorizada para analizar y corregir comprobantes.</p> : <>
      <label className="block text-sm text-slate-300">Comprobante (PDF, JPG, PNG o WEBP; hasta 1 MB)
        <input aria-label="Seleccionar comprobante para María" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" disabled={busy || editing}
          onChange={event => { const next = event.target.files?.[0] || null; event.target.value = ""; selectFile(next); }}
          className="mt-2 block w-full text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-800 file:px-3 file:py-2 file:text-slate-100 disabled:opacity-50" />
      </label>
      {file && <p className="break-all text-xs text-slate-400">{file.name}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!file || busy || editing} onClick={() => void analyze()} className="rounded-lg bg-violet-600 px-3 py-2 text-sm text-white disabled:opacity-40">{busy ? "Procesando…" : receipt ? "Volver a analizar" : "Analizar comprobante"}</button>
        {file && <button type="button" onClick={() => selectFile(null)} className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300">Quitar documento</button>}
      </div>
      {notice && <p role="status" className="text-sm text-emerald-200">{notice}</p>}
      {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
      {receipt?.semanticReceipt && <>
        <ReceiptEvidenceSummary key={receipt.analysisId || "readonly"} receipt={receipt.semanticReceipt} disabled={busy}
          onCorrect={canCorrect ? correct : undefined} onEditingChange={setEditing} />
        {!canCorrect && <p className="text-sm text-amber-200">La lectura está disponible, pero este resultado no permite guardar correcciones. Vuelve a analizarlo.</p>}
        {!!receipt.warnings?.length && <ul className="list-inside list-disc text-xs text-amber-200">{receipt.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
        {!!receipt.learningContext?.length && <div aria-label="Orientaciones documentales" className="rounded-lg border border-slate-700 p-3 text-xs text-slate-300">
          <p className="font-medium">Patrones documentales para revisar</p>
          <p className="mt-1 text-slate-400">Son orientaciones sujetas a la evidencia del comprobante; no cambian pagos ni crean reglas globales.</p>
          <ul className="mt-2 space-y-2">{receipt.learningContext.map(item => <li key={item.id}>{item.content} <span className="text-slate-400">({item.status === "CONFIRMED" ? "Confirmado" : "Candidato"}{item.advisory ? " · orientación disponible" : " · requiere revisión"})</span></li>)}</ul>
        </div>}
      </>}
    </>}
  </section>;
}
