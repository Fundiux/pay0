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
  P4_PLAN_PROFILE_AUTH_BLOCKED: "IQ rechazó la sesión de lectura. Revisa las credenciales del perfil IQ e intenta de nuevo.",
  P4_SCOPE_LOCKED: "Otra sincronización sigue en curso sobre este periodo. Espera unos minutos y vuelve a intentar.",
  P4_SCOPE_NOT_APPROVED: "El alcance cambió desde que se preparó. Vuelve a preparar el periodo.",
  P4_SCOPE_APPROVAL_MISMATCH: "Se escribieron registros desde la última preparación y el alcance ya no coincide. Lo escrito se conserva; vuelve a preparar el periodo.",
  P4_MANIFEST_HASH_MISMATCH: "IQ cambió desde que se preparó el plan. Vuelve a preparar el periodo.",
  P4_SCOPE_MANIFEST_MISMATCH: "El plan en el servidor ya no es el que se preparó. Vuelve a preparar el periodo.",
  P4_SCOPE_NOT_FOUND: "El alcance ya no existe en el servidor. Vuelve a preparar el periodo.",
  P4_SCOPE_APPROVAL_CONFIRMATION_REQUIRED: "El servidor no reconoció la confirmación del alcance. Vuelve a preparar el periodo.",
  P4_SCOPE_BUDGET_EXCEEDS_APPROVAL: "El lote pidió más de lo aprobado. Vuelve a preparar el periodo.",
  P4_SCOPE_FENCE_CONFLICT: "Otra ejecución tomó el control de este alcance. Espera y vuelve a preparar el periodo.",
  P4_SCOPE_RANGE_INVALID: "El periodo no es válido para el servidor.",
  P4_SCOPE_TYPE_INVALID: "El tipo de alcance no es válido. Avisa a soporte.",
  P4_SCOPE_EXECUTION_MODE_INVALID: "El modo de ejecución no es válido. Avisa a soporte.",
  P4_SCOPE_CALLER_SELECTION_FORBIDDEN: "La pantalla intentó elegir registros por su cuenta y el servidor lo rechazó. Avisa a soporte.",
  P4_SCOPE_HISTORICAL_EVIDENCE_INCOMPLETE: "Este alcance requiere evidencia certificada que no existe. Usa un bloque de mes.",
  P4_SCOPE_HISTORICAL_EVIDENCE_INVALID: "La evidencia certificada de este alcance no coincide. Usa un bloque de mes.",
  P4_SCOPE_HISTORICAL_EVIDENCE_VERSION_MISMATCH: "La evidencia certificada es de una versión anterior del selector y requiere recertificación. Usa un bloque de mes.",
  P4_INTERNAL: "Error interno del motor. Nada quedó a medias; revisa los registros de la Function.",
  "deadline-exceeded": "La lectura de IQ tardó demasiado. Vuelve a intentar; lo ya escrito se conserva.",
};

const STOP_COPY: Record<NonNullable<P4SyncResult["stoppedReason"]>, string> = {
  CANARIO_FALLIDO: "El primer registro no pudo escribirse. Revisa el error en los registros de la Function antes de intentar de nuevo.",
  REGISTROS_FALLIDOS: "Un lote tuvo errores. Lo escrito se conserva; revisa los registros fallidos antes de volver a preparar el periodo.",
  ALCANCE_CAMBIADO: "IQ o PAY0 cambiaron durante la sincronización y el servidor propone registros que no viste. Prepara de nuevo el periodo para revisarlos.",
  REQUIERE_REVISION: "Algunos registros confirmados dejaron de ser ejecutables. Suele ocurrir cuando dependen de otros aún no importados; prepara de nuevo el periodo.",
  SIN_AVANCE: "Ninguna escritura avanzó. Prepara de nuevo el periodo; si persiste, revisa los registros de la Function.",
  TOPE_DE_LOTES: "Lo escrito se conserva. Pulsa «Continuar con lo pendiente» para seguir con el mismo plan.",
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

/** Capas de dependencia por sesión: clientes, luego sus facturas y pagos, luego aplicaciones. */
const MAX_FOLLOW_UPS = 4;

export default function IqHistoricalImportPage() {
  const [month, setMonth] = useState("2026-09");
  const [block, setBlock] = useState<P4Block>("01_10");
  const [plan, setPlan] = useState<P4SyncPlan | null>(null);
  const [followUp, setFollowUp] = useState(0);
  const [progress, setProgress] = useState<P4SyncProgress | null>(null);
  const [result, setResult] = useState<P4SyncResult | null>(null);
  const [busy, setBusy] = useState<"" | "preparar" | "sincronizar">("");
  const [error, setError] = useState("");

  function reset() {
    setPlan(null);
    setFollowUp(0);
    setProgress(null);
    setResult(null);
    setError("");
  }

  async function prepare(nextFollowUp = 0) {
    setBusy("preparar");
    setError("");
    if (nextFollowUp === 0) reset();
    try {
      const next = await prepareP4Sync({ month, block });
      setPlan(next);
      setFollowUp(nextFollowUp);
      if (nextFollowUp > 0) {
        // A follow-up layer with writes is a new plan to confirm: the previous
        // run's result must not hide the button. Without writes, the period is done.
        if (next.writes > 0) { setResult(null); setProgress(null); }
        else setProgress(current => current ? { ...current, phase: "COMPLETO", detail: "Periodo sincronizado. No quedan registros por escribir." } : current);
      }
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
      const outcome = await runP4Sync(plan, setProgress);
      setResult(outcome);
      // Lo recién escrito puede destrabar registros que dependían de ello
      // (por ejemplo facturas de un cliente nuevo). Se vuelve a leer IQ y, si
      // hay escrituras nuevas, se pide otra confirmación; nunca se auto-aprueba.
      if (outcome.ok && followUp < MAX_FOLLOW_UPS) {
        setBusy("");
        await prepare(followUp + 1);
        return;
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy("");
    }
  }

  const alreadySynced = plan !== null && plan.writes === 0 && (plan.excluded.completed > 0 || plan.excluded.unchanged > 0);
  const nothingPending = plan !== null && plan.writes === 0 && !alreadySynced;
  const canRetry = result?.stoppedReason === "TOPE_DE_LOTES";
  const showConfirm = plan !== null && plan.writes > 0 && (!result || canRetry);

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
      <button type="button" disabled={!!busy || !/^2026-\d{2}$/.test(month)} onClick={() => prepare(0)} className="mt-4 rounded bg-sky-700 px-4 py-2 text-sm disabled:opacity-50">
        {busy === "preparar" ? "Leyendo IQ…" : "Sincronizar"}
      </button>
      {busy === "preparar" && <p className="mt-2 text-xs text-slate-400">Esto lee IQ completo para el periodo y puede tardar varios minutos. Aún no se escribe nada.</p>}
    </section>

    {plan && <section className="space-y-4 rounded-xl border border-slate-700 bg-slate-900 p-5">
      <h2 className="font-semibold">{followUp > 0 ? "Registros que dependían de lo recién escrito" : "Lo que va a hacer"} para {monthLabel(plan.period.month)}, del {dayLabel(plan.range.start)} al {dayLabel(plan.range.end)}</h2>
      {alreadySynced && <p className="text-sm text-emerald-300">Este periodo ya está sincronizado. No hay nada que escribir.</p>}
      {nothingPending && <p className="text-sm text-slate-300">No hay registros de IQ pendientes de importar en este periodo.</p>}
      {plan.writes > 0 && <ul className="grid gap-2 text-sm sm:grid-cols-2">
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
          <li>Requieren revisión manual (cliente aún no existe en PAY0, montos o fechas inconsistentes): {plan.excluded.review}</li>
          {plan.excluded.other > 0 && <li>Otros: {plan.excluded.other}</li>}
        </ul>
        {plan.excluded.dependency > 0 && <p className="mt-2 text-amber-300">Para traer los que dependen de otro periodo, sincroniza primero el bloque anterior y vuelve a este.</p>}
        {plan.excluded.review > 0 && plan.planned.clientes > 0 && <p className="mt-2 text-amber-300">Los registros de clientes nuevos se destraban al confirmar: primero se crean los clientes y después se te mostrarán sus solicitudes, pagos y aplicaciones para confirmarlos.</p>}
        <p className="mt-2 break-all font-mono text-xs text-slate-500">Plan {plan.manifestId} · alcance {plan.scopeId}</p>
      </details>
      {showConfirm && <button type="button" disabled={!!busy} onClick={confirm} className="rounded bg-amber-700 px-4 py-2 text-sm disabled:opacity-50">
        {busy === "sincronizar" ? "Sincronizando…" : canRetry ? "Continuar con lo pendiente" : `Confirmar y escribir ${plan.writes} registros`}
      </button>}
    </section>}

    {progress && <section className="space-y-2 rounded-xl border border-slate-700 bg-slate-900 p-5 text-sm">
      <h2 className="font-semibold">{PHASE_COPY[progress.phase]}</h2>
      <p className="text-slate-300">{progress.detail}</p>
      <p>Escritos: <strong>{progress.completed}</strong> · Pendientes: <strong>{progress.pending}</strong> · Fallidos: <strong className={progress.failed ? "text-rose-300" : ""}>{progress.failed}</strong></p>
      {result && !result.ok && result.stoppedReason && <p className="text-amber-300">{STOP_COPY[result.stoppedReason]}</p>}
      {result?.ok && progress.phase === "COMPLETO" && <p className="text-emerald-300">Los registros escritos aparecen en Solicitudes y Pagos con su fecha original y su dueño en IQ.</p>}
      <p className="break-all font-mono text-xs text-slate-500">Plan {result?.manifestId || plan?.manifestId} · alcance {progress.scopeId} · lote {progress.round}{result?.stoppedAt ? ` · paro: ${result.stoppedAt}` : ""}</p>
    </section>}

    {error && <p role="alert" className="rounded border border-rose-800 bg-rose-950/40 p-3 text-sm text-rose-200">{error}</p>}
  </main>;
}
