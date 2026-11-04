"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  approveP4Scope,
  listP4Manifests,
  previewP4Scope,
  runP4Scope,
  verifyP4Scope,
  type P4Budget,
  type P4ManifestSummary,
  type P4ScopePreview,
  type P4ScopeRequest,
} from "@/services/iqHistoricalImport";

const previewBudget: P4Budget = {
  maxActions: 25, maxWrites: 25, maxDurationMs: 120_000,
  maxErrors: 1, maxConcurrent: 1, maxRetries: 1,
};
const canaryBudget: P4Budget = {
  maxActions: 1, maxWrites: 1, maxDurationMs: 60_000,
  maxErrors: 1, maxConcurrent: 1, maxRetries: 1,
};

function errorMessage(error: unknown) {
  const row = error as { message?: string; code?: string };
  return row?.message || row?.code || "La operación no pudo completarse.";
}

export default function IqHistoricalImportPage() {
  const [manifests, setManifests] = useState<P4ManifestSummary[]>([]);
  const [manifestId, setManifestId] = useState("");
  const [month, setMonth] = useState("2026-09");
  const [block, setBlock] = useState<P4ScopeRequest["block"]>("01_10");
  const [preview, setPreview] = useState<P4ScopePreview | null>(null);
  const [approvedHash, setApprovedHash] = useState("");
  const [verification, setVerification] = useState<{ completed: number; pending: number; failed: number } | null>(null);
  const [canaryCompleted, setCanaryCompleted] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const selectedManifest = useMemo(() => manifests.find(row => row.manifestId === manifestId), [manifests, manifestId]);
  const excluded = useMemo(() => Object.entries((preview?.scope.excluded || []).reduce<Record<string, number>>((counts, row) => {
    counts[row.reason] = (counts[row.reason] || 0) + 1;
    return counts;
  }, {})), [preview]);

  useEffect(() => {
    let active = true;
    listP4Manifests().then(result => {
      if (!active) return;
      setManifests(result.manifests || []);
      setManifestId(result.manifests?.[0]?.manifestId || "");
    }).catch(error => { if (active) setMessage(errorMessage(error)); });
    return () => { active = false; };
  }, []);

  function invalidate() {
    setPreview(null);
    setApprovedHash("");
    setVerification(null);
    setCanaryCompleted(false);
    setConfirmation("");
    setMessage("");
  }

  async function perform(label: string, action: () => Promise<unknown>) {
    setBusy(label);
    setMessage("");
    try { await action(); }
    catch (error) { setMessage(errorMessage(error)); }
    finally { setBusy(""); setConfirmation(""); }
  }

  async function previewCurrent() {
    if (!selectedManifest) return;
    await perform("Vista previa", async () => {
      const result = await previewP4Scope(selectedManifest, { type: "MONTH_BLOCK", month, block }, previewBudget);
      if (!result.ok || !result.readOnly || result.scope.expectedIqWrites !== 0 || result.scope.expectedExternalEffects !== 0) {
        throw new Error("La vista previa no acredita un alcance sin efectos externos.");
      }
      setPreview(result);
      setApprovedHash("");
      setVerification(null);
      setCanaryCompleted(false);
      setMessage("Vista previa actualizada. Revisa miembros, exclusiones y hash antes de aprobar.");
    });
  }

  async function approve() {
    if (!preview || confirmation !== "APROBAR") return;
    await perform("Aprobación", async () => {
      const result = await approveP4Scope(preview);
      if (!result.ok) throw new Error(result.status || "La aprobación no fue confirmada.");
      setApprovedHash(preview.scope.scopeHash);
      setMessage("Alcance aprobado. Ejecuta primero un canario de una sola escritura.");
    });
  }

  async function runCanary() {
    if (!preview || approvedHash !== preview.scope.scopeHash || confirmation !== "EJECUTAR 1") return;
    await perform("Canario", async () => {
      const result = await runP4Scope(preview, "EXECUTE_SCOPE", "CANARY", canaryBudget);
      const batch = result.batch as { completed?: number; errors?: number } | undefined;
      setCanaryCompleted(result.ok && Number(batch?.completed || 0) === 1 && Number(batch?.errors || 0) === 0);
      setMessage(result.ok ? `Canario: ${result.status || "respuesta recibida"}. Verifica el alcance antes de continuar.` : `Canario detenido: ${result.status || "revisión requerida"}.`);
      setVerification(null);
    });
  }

  async function verify() {
    if (!preview) return;
    await perform("Verificación", async () => {
      const result = await verifyP4Scope(preview.scope.scopeId);
      if (!result.summary) throw new Error("La Function no devolvió el resumen de verificación.");
      setVerification(result.summary);
      setMessage(result.scopeComplete ? "Alcance completo." : "Verificación recibida. Revisa pendientes y fallas.");
    });
  }

  async function continueScope() {
    if (!preview || approvedHash !== preview.scope.scopeHash || !canaryCompleted || !verification?.completed || verification.failed || confirmation !== "CONTINUAR") return;
    await perform("Continuación", async () => {
      const result = await runP4Scope(preview, "RESUME_SCOPE", "SCOPED_FULL", previewBudget);
      setVerification(null);
      setMessage(result.ok ? `Continuación: ${result.status || "respuesta recibida"}. Verifica de nuevo.` : `Continuación detenida: ${result.status || "revisión requerida"}.`);
    });
  }

  return <main className="mx-auto max-w-5xl space-y-6 px-4 py-8 text-slate-100">
    <div><Link href="/integraciones/iq" className="text-sm text-sky-300">← Integración IQ</Link>
      <h1 className="mt-3 text-2xl font-semibold">Sincronización inversa IQ · histórico</h1>
      <p className="mt-2 text-sm text-slate-400">Operación administrativa por alcance. La vista previa excluye componentes en revisión y acciones ya completadas. IQ no recibe escrituras desde este proceso.</p>
    </div>
    <section className="rounded-xl border border-slate-700 bg-slate-900 p-5">
      <h2 className="font-semibold">1. Seleccionar y previsualizar</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <label className="text-sm">Manifest
          <select value={manifestId} onChange={event => { setManifestId(event.target.value); invalidate(); }} className="mt-1 w-full rounded border border-slate-600 bg-slate-950 p-2">
            {manifests.map(row => <option key={row.manifestId} value={row.manifestId}>{row.manifestId} · {row.status}</option>)}
          </select>
        </label>
        <label className="text-sm">Mes
          <input type="month" value={month} onChange={event => { setMonth(event.target.value); invalidate(); }} className="mt-1 w-full rounded border border-slate-600 bg-slate-950 p-2" />
        </label>
        <label className="text-sm">Bloque
          <select value={block} onChange={event => { setBlock(event.target.value as P4ScopeRequest["block"]); invalidate(); }} className="mt-1 w-full rounded border border-slate-600 bg-slate-950 p-2">
            <option value="01_10">Días 1 al 10</option><option value="11_20">Días 11 al 20</option><option value="21_END">Día 21 al final</option>
          </select>
        </label>
      </div>
      <button type="button" disabled={!!busy || !selectedManifest} onClick={previewCurrent} className="mt-4 rounded bg-sky-700 px-4 py-2 text-sm disabled:opacity-50">Generar vista previa</button>
    </section>
    {preview && <section className="space-y-4 rounded-xl border border-slate-700 bg-slate-900 p-5">
      <h2 className="font-semibold">2. Revisar y aprobar</h2>
      <div className="grid gap-3 text-sm sm:grid-cols-3">
        <p>Acciones seleccionadas: <strong>{preview.selected}</strong></p>
        <p>Excluidas: <strong>{preview.excluded}</strong></p>
        <p>Escrituras PAY0 previstas: <strong>{preview.scope.expectedPay0Writes}</strong></p>
      </div>
      <p className="break-all text-xs text-slate-400">Hash del alcance: {preview.scope.scopeHash}</p>
      <p className="text-xs text-slate-400">Sin escrituras IQ ni efectos externos. Presupuesto por ejecución: hasta {preview.budget.maxActions} acciones, {preview.budget.maxWrites} escrituras y {preview.budget.maxErrors} error.</p>
      <div className="grid gap-2 text-sm sm:grid-cols-2">
        {Object.entries(preview.counts).map(([key, count]) => <p key={key}>{key}: {count}</p>)}
      </div>
      {excluded.length > 0 && <div className="text-sm"><h3 className="font-medium">Motivos de exclusión</h3>{excluded.map(([reason, count]) => <p key={reason} className="text-amber-300">{reason}: {count}</p>)}</div>}
      <label className="block text-sm">Escribe APROBAR para confirmar este hash
        <input value={confirmation} onChange={event => setConfirmation(event.target.value)} className="mt-1 block w-full rounded border border-slate-600 bg-slate-950 p-2" />
      </label>
      <button type="button" disabled={!!busy || confirmation !== "APROBAR" || !!approvedHash || preview.selected === 0} onClick={approve} className="rounded bg-amber-700 px-4 py-2 text-sm disabled:opacity-50">Aprobar alcance</button>
    </section>}
    {preview && approvedHash === preview.scope.scopeHash && <section className="space-y-4 rounded-xl border border-slate-700 bg-slate-900 p-5">
      <h2 className="font-semibold">3. Canario y verificación</h2>
      <p className="text-sm text-slate-400">El canario procesa como máximo una acción y una escritura. La continuación requiere verificar su resultado primero.</p>
      <label className="block text-sm">Escribe EJECUTAR 1 para iniciar el canario
        <input value={confirmation} onChange={event => setConfirmation(event.target.value)} className="mt-1 block w-full rounded border border-slate-600 bg-slate-950 p-2" />
      </label>
      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={!!busy || confirmation !== "EJECUTAR 1" || !!verification} onClick={runCanary} className="rounded bg-amber-700 px-4 py-2 text-sm disabled:opacity-50">Ejecutar canario</button>
        <button type="button" disabled={!!busy} onClick={verify} className="rounded border border-sky-600 px-4 py-2 text-sm disabled:opacity-50">Verificar alcance</button>
      </div>
      {verification && <p className="text-sm">Completadas: {verification.completed} · Pendientes: {verification.pending} · Fallidas: {verification.failed}</p>}
      {canaryCompleted && verification && verification.completed > 0 && verification.pending > 0 && verification.failed === 0 && <div className="space-y-2 border-t border-slate-700 pt-4">
        <p className="text-sm">Continuación acotada a {preview.budget.maxActions} acciones y {preview.budget.maxWrites} escrituras por ejecución.</p>
        <label className="block text-sm">Escribe CONTINUAR para reanudar
          <input value={confirmation} onChange={event => setConfirmation(event.target.value)} className="mt-1 block w-full rounded border border-slate-600 bg-slate-950 p-2" />
        </label>
        <button type="button" disabled={!!busy || confirmation !== "CONTINUAR"} onClick={continueScope} className="rounded bg-amber-700 px-4 py-2 text-sm disabled:opacity-50">Continuar alcance</button>
      </div>}
    </section>}
    {message && <p role="status" className="rounded border border-slate-700 bg-slate-900 p-3 text-sm">{message}</p>}
  </main>;
}
