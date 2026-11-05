"use client";

import Link from "next/link";
import { useState } from "react";
import {
  prepareP4Sync,
  runP4Sync,
  type P4Block,
  type P4SyncPlan,
  type P4SyncProgress,
  type P4SyncResult,
} from "@/services/iqHistoricalImport";

const ERROR_COPY: Record<string, string> = {
  P4_PLAN_BUDGET_EXCEEDED: "IQ devolvió demasiados registros para un solo bloque. Intenta más tarde o con otro bloque.",
  P4_PLAN_INVALID_RANGE: "El periodo no es válido.",
  P4_SCOPE_LOCKED: "Otra sincronización sigue en curso sobre este periodo. Espera unos minutos y vuelve a intentar.",
  P4_SCOPE_NOT_APPROVED: "El alcance cambió desde que se preparó. Vuelve a preparar el periodo.",
  P4_SCOPE_APPROVAL_MISMATCH: "Ya existe una aprobación distinta para este periodo. Vuelve a preparar el periodo.",
  P4_MANIFEST_HASH_MISMATCH: "IQ cambió desde que se preparó el plan. Vuelve a preparar el periodo.",
  P4_INTERNAL: "Error interno del motor. Nada quedó a medias; revisa los registros de la Function.",
  "deadline-exceeded": "La lectura de IQ tardó demasiado. Vuelve a intentar; lo ya escrito se conserva.",
};

function errorMessage(error: unknown): string {
  const row = error as { message?: string; code?: string };
  const raw = String(row?.message || row?.code || "");
  const code = raw.replace(/^functions\//, "");
  return ERROR_COPY[code] || ERROR_COPY[raw] || raw || "La operación no pudo completarse.";
}

const monthLabel = (month: string) => new Date(`${month}-15T12:00:00Z`).toLocaleDateString("es-MX", { month: "long", year: "numeric", timeZone: "UTC" });
const dayLabel = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("es-MX", { day: "numeric", month: "long", timeZone: "UTC" });

const PHASE_COPY: Record<P4SyncProgress["phase"], string> = {
  APROBANDO: "Aprobando",
  CANARIO: "Probando con un registro",
  VERIFICANDO: "Verificando",
  CONTINUANDO: "Escribiendo",
  COMPLETO: "Completo",
  DETENIDO: "Detenido",
};

export default function IqHistoricalImportPage() {
  const [month, setMonth] = useState("2026-09");
  const [block, setBlock] = useState<P4Block>("01_10");
  const [plan, setPlan] = useState<P4SyncPlan | null>(null);
  const [progress, setProgress] = useState<P4SyncProgress | null>(null);
  const [result, setResult] = useState<P4SyncResult | null>(null);
  const [busy, setBusy] = useState<"" | "preparar" | "sincronizar">("");
  const [error, setError] = useState("");

  function reset() {
    setPlan(null);
    setProgress(null);
    setResult(null);
    setError("");
  }

  async function prepare() {
    setBusy("preparar");
    reset();
    try {
      setPlan(await prepareP4Sync({ month, block }));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy("");
    }
  }

  async function confirm() {
    if (!plan) return;
    setBusy("sincronizar");
    setError("");
    setResult(null);
    try {
      setResult(await runP4Sync(plan, setProgress));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy("");
    }
  }

  const nothingToWrite = plan !== null && plan.writes === 0;
  const finished = result?.ok === true;

  return <main className="mx-auto max-w-3xl space-y-6 px-4 py-8 text-slate-100">
    <div>
      <Link href="/integraciones/iq" className="text-sm text-sky-300">← Integración IQ</Link>
      <h1 className="mt-3 text-2xl font-semibold">Sincronización inversa IQ</h1>
      <p className="mt-2 text-sm text-slate-400">Trae a PAY0 las solicitudes, pagos y aplicaciones que se trabajaron en IQ durante un periodo. IQ no recibe escrituras. Los registros que ya existen en PAY0 no se tocan.</p>
    </div>

    <section className="rounded-xl border border-slate-700 bg-slate-900 p-5">
      <h2 className="font-semibold">Periodo</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-sm">Mes
          <input type="month" value={month} min="2026-01" max="2026-12" disabled={!!busy} onChange={event => { setMonth(event.target.value); reset(); }} className="mt-1 w-full rounded border border-slate-600 bg-slate-950 p-2" />
        </label>
        <label className="text-sm">Días
          <select value={block} disabled={!!busy} onChange={event => { setBlock(event.target.value as P4Block); reset(); }} className="mt-1 w-full rounded border border-slate-600 bg-slate-950 p-2">
            <option value="01_10">1 al 10</option>
            <option value="11_20">11 al 20</option>
            <option value="21_END">21 al final del mes</option>
          </select>
        </label>
      </div>
      <button type="button" disabled={!!busy || !/^2026-\d{2}$/.test(month)} onClick={prepare} className="mt-4 rounded bg-sky-700 px-4 py-2 text-sm disabled:opacity-50">
        {busy === "preparar" ? "Leyendo IQ…" : "Sincronizar"}
      </button>
      {busy === "preparar" && <p className="mt-2 text-xs text-slate-400">Esto lee IQ completo para el periodo y puede tardar varios minutos. Aún no se escribe nada.</p>}
    </section>

    {plan && <section className="space-y-4 rounded-xl border border-slate-700 bg-slate-900 p-5">
      <h2 className="font-semibold">Lo que va a hacer para {monthLabel(plan.period.month)}, del {dayLabel(plan.range.start)} al {dayLabel(plan.range.end)}</h2>
      {nothingToWrite
        ? <p className="text-sm text-emerald-300">Este periodo ya está sincronizado. No hay nada que escribir.</p>
        : <ul className="grid gap-2 text-sm sm:grid-cols-2">
          <li>Solicitudes nuevas: <strong>{plan.planned.solicitudes}</strong></li>
          <li>Pagos nuevos: <strong>{plan.planned.pagos}</strong></li>
          <li>Aplicaciones de pago nuevas: <strong>{plan.planned.aplicaciones}</strong></li>
          <li>Clientes nuevos: <strong>{plan.planned.clientes}</strong></li>
          {plan.planned.conciliaciones > 0 && <li>Registros existentes que se completan: <strong>{plan.planned.conciliaciones}</strong></li>}
          <li>Total de escrituras en PAY0: <strong>{plan.writes}</strong></li>
        </ul>}
      <details className="text-sm text-slate-300">
        <summary className="cursor-pointer text-slate-400">Qué se deja fuera y por qué</summary>
        <ul className="mt-2 space-y-1">
          <li>Ya importados antes: {plan.excluded.completed}</li>
          <li>Ya existen en PAY0 sin cambios: {plan.excluded.unchanged}</li>
          <li>Cancelados o rechazados en IQ: {plan.excluded.terminal}</li>
          <li>Dependen de registros de otro periodo aún no importados: {plan.excluded.dependency}</li>
          <li>Requieren revisión manual (cliente ambiguo, montos o fechas inconsistentes): {plan.excluded.review}</li>
          {plan.excluded.other > 0 && <li>Otros: {plan.excluded.other}</li>}
        </ul>
        {plan.excluded.dependency > 0 && <p className="mt-2 text-amber-300">Para traer los que dependen de otro periodo, sincroniza primero el bloque anterior y vuelve a este.</p>}
      </details>
      {!nothingToWrite && !finished && <button type="button" disabled={!!busy} onClick={confirm} className="rounded bg-amber-700 px-4 py-2 text-sm disabled:opacity-50">
        {busy === "sincronizar" ? "Sincronizando…" : result ? "Reintentar lo pendiente" : `Confirmar y escribir ${plan.writes} registros`}
      </button>}
    </section>}

    {progress && <section className="space-y-2 rounded-xl border border-slate-700 bg-slate-900 p-5 text-sm">
      <h2 className="font-semibold">{PHASE_COPY[progress.phase]}</h2>
      <p className="text-slate-300">{progress.detail}</p>
      <p>Escritos: <strong>{progress.completed}</strong> · Pendientes: <strong>{progress.pending}</strong> · Fallidos: <strong className={progress.failed ? "text-rose-300" : ""}>{progress.failed}</strong></p>
      {result && !result.ok && <p className="text-amber-300">Motivo: {result.stoppedReason}. Lo ya escrito se conserva; puedes reintentar y sólo continuará lo pendiente.</p>}
      {finished && <p className="text-emerald-300">Periodo sincronizado. Los registros aparecen en Solicitudes y Pagos con su fecha original y su dueño en IQ.</p>}
    </section>}

    {error && <p role="alert" className="rounded border border-rose-800 bg-rose-950/40 p-3 text-sm text-rose-200">{error}</p>}
  </main>;
}
