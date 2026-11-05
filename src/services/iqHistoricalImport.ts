import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebaseClient";

/**
 * Sincronización inversa IQ -> PAY0 (importación histórica P4).
 *
 * El motor trabaja en etapas (plan, alcance, aprobación, canario, reanudación,
 * verificación). Este servicio las encadena para que la pantalla sólo pida un
 * periodo y una confirmación. El manifest, el hash del alcance y los
 * presupuestos son detalles internos; el servidor los valida en cada llamada.
 */

export type P4Block = "01_10" | "11_20" | "21_END";

export type P4Period = { month: string; block: P4Block };

export type P4Budget = {
  maxActions: number;
  maxWrites: number;
  maxDurationMs: number;
  maxErrors: number;
  maxConcurrent: number;
  maxRetries: number;
};

type P4ScopeRequest = { type: "MONTH_BLOCK"; month: string; block: P4Block };

type P4Scope = {
  scopeId: string;
  scopeHash: string;
  selectorVersion: string;
  manifestId: string;
  manifestHash: string;
  request: P4ScopeRequest;
  members: Array<{ actionId: string; entityType: string; operation: string; role: string }>;
  excluded: Array<{ reason: string }>;
  expectedPay0Writes: number;
  expectedIqWrites: number;
  expectedExternalEffects: number;
};

type P4ScopePreview = {
  ok: boolean;
  scope: P4Scope;
  budget: P4Budget;
  selected: number;
  excluded: number;
  counts: Record<string, number>;
  readOnly: boolean;
};

type P4Reply = Record<string, unknown> & { ok: boolean; status?: string; p4Code?: string; message?: string };

type P4Batch = { processed: number; completed: number; skipped: number; writes: number; errors: number; remaining: number };

export type P4VerifySummary = { completed: number; pending: number; failed: number };

/** Resumen listo para mostrar: qué va a crear, qué ya existe y qué no se puede importar. */
export type P4SyncPlan = {
  period: P4Period;
  range: { start: string; end: string };
  planned: { solicitudes: number; pagos: number; aplicaciones: number; clientes: number; conciliaciones: number };
  writes: number;
  excluded: { completed: number; unchanged: number; review: number; terminal: number; dependency: number; other: number };
  preview: P4ScopePreview;
};

export type P4SyncProgress = { phase: "APROBANDO" | "CANARIO" | "VERIFICANDO" | "CONTINUANDO" | "COMPLETO" | "DETENIDO"; completed: number; pending: number; failed: number; detail: string };

export type P4SyncResult = { ok: boolean; summary: P4VerifySummary; stoppedReason: string | null; rounds: number };

const PLAN_GROUPS = ["iq-group-rr", "iq-group-pay0"];
const TIMEZONE = "America/Mexico_City";

/** Mismo presupuesto que el tope del servidor para un bloque; la aprobación lo fija. */
const scopeBudget: P4Budget = { maxActions: 25, maxWrites: 25, maxDurationMs: 120_000, maxErrors: 1, maxConcurrent: 1, maxRetries: 1 };
const canaryBudget: P4Budget = { maxActions: 1, maxWrites: 1, maxDurationMs: 60_000, maxErrors: 1, maxConcurrent: 1, maxRetries: 1 };
/** Tope de reanudaciones por confirmación: un bloque de 10 días rara vez supera 25 acciones. */
const MAX_RESUME_ROUNDS = 12;

async function callP4<T>(data: Record<string, unknown>): Promise<T> {
  const callable = httpsCallable<Record<string, unknown>, T>(functions, "manageP4HistoricalIqImport", { timeout: 550_000 });
  return (await callable(data)).data;
}

function failure(reply: P4Reply, fallback: string): Error {
  return new Error(String(reply.message || reply.p4Code || reply.status || fallback));
}

export function periodRange(period: P4Period): { start: string; end: string } {
  const last = new Date(`${period.month}-01T00:00:00Z`);
  last.setUTCMonth(last.getUTCMonth() + 1);
  last.setUTCDate(0);
  const startDay = period.block === "01_10" ? "01" : period.block === "11_20" ? "11" : "21";
  const endDay = period.block === "01_10" ? "10" : period.block === "11_20" ? "20" : String(last.getUTCDate()).padStart(2, "0");
  return { start: `${period.month}-${startDay}`, end: `${period.month}-${endDay}` };
}

function tally(counts: Record<string, number>, entity: string, operation: string): number {
  return Object.entries(counts)
    .filter(([key]) => key.startsWith("PRIMARY:") && key.includes(`:${entity}:`) && key.endsWith(`:${operation}`))
    .reduce((sum, [, value]) => sum + Number(value || 0), 0);
}

function excludedSummary(rows: Array<{ reason: string }>): P4SyncPlan["excluded"] {
  const out = { completed: 0, unchanged: 0, review: 0, terminal: 0, dependency: 0, other: 0 };
  for (const row of rows) {
    if (row.reason === "COMPLETED") out.completed++;
    else if (row.reason === "NO_CHANGE") out.unchanged++;
    else if (row.reason === "REVIEW" || row.reason === "PROTECTED_REVIEW" || row.reason === "FINANCIAL_COMPONENT_REVIEW") out.review++;
    else if (row.reason === "TERMINAL") out.terminal++;
    else if (row.reason === "EXTERNAL_DEPENDENCY_PENDING") out.dependency++;
    else out.other++;
  }
  return out;
}

/**
 * Toma una foto fresca de IQ para el periodo, la compara con PAY0 y devuelve el
 * plan sin escribir nada en PAY0 ni en IQ.
 */
export async function prepareP4Sync(period: P4Period): Promise<P4SyncPlan> {
  const range = periodRange(period);
  const planned = await callP4<P4Reply & { manifestId?: string; manifestHash?: string }>({
    mode: "PLAN",
    range: { ...range, timezone: TIMEZONE },
    profileGroups: PLAN_GROUPS,
  });
  if (!planned.ok || !planned.manifestId || !planned.manifestHash) {
    throw failure(planned, planned.status === "PLAN_PARTIAL" ? "IQ devolvió demasiados registros para un solo bloque; intenta de nuevo más tarde." : "No se pudo leer IQ para ese periodo.");
  }
  const scope: P4ScopeRequest = { type: "MONTH_BLOCK", month: period.month, block: period.block };
  const preview = await callP4<P4ScopePreview>({ mode: "PREVIEW_SCOPE", manifestId: planned.manifestId, manifestHash: planned.manifestHash, scope, budget: scopeBudget });
  if (!preview.ok || !preview.readOnly || preview.scope.expectedIqWrites !== 0 || preview.scope.expectedExternalEffects !== 0) {
    throw new Error("La vista previa no acredita un alcance sin efectos externos.");
  }
  return {
    period,
    range,
    planned: {
      solicitudes: tally(preview.counts, "SOLICITUD", "CREATE_HISTORICAL"),
      pagos: tally(preview.counts, "PAYMENT", "CREATE_HISTORICAL"),
      aplicaciones: tally(preview.counts, "APPLICATION", "CREATE_HISTORICAL"),
      clientes: tally(preview.counts, "CLIENT", "CREATE_HISTORICAL") + tally(preview.counts, "CLIENT", "DEPENDENCY_IMPORT"),
      conciliaciones: Object.entries(preview.counts).filter(([key]) => key.startsWith("PRIMARY:") && key.endsWith(":RECONCILE")).reduce((sum, [, value]) => sum + Number(value || 0), 0),
    },
    writes: preview.scope.expectedPay0Writes,
    excluded: excludedSummary(preview.scope.excluded),
    preview,
  };
}

function scopeFields(preview: P4ScopePreview) {
  return {
    manifestId: preview.scope.manifestId,
    manifestHash: preview.scope.manifestHash,
    scope: preview.scope.request,
    scopeId: preview.scope.scopeId,
    scopeHash: preview.scope.scopeHash,
    selectorVersion: preview.scope.selectorVersion,
  };
}

async function verifyScope(scopeId: string): Promise<{ summary: P4VerifySummary; complete: boolean }> {
  const result = await callP4<P4Reply & { summary?: P4VerifySummary; scopeComplete?: boolean }>({ mode: "VERIFY_SCOPE", scopeId });
  if (!result.summary) throw new Error("La Function no devolvió el resumen de verificación.");
  return { summary: result.summary, complete: result.scopeComplete === true };
}

/**
 * Ejecuta el plan confirmado: aprueba el alcance, escribe un solo registro como
 * prueba, verifica y continúa por lotes acotados hasta terminar el periodo o
 * hasta el primer error. Cada paso es idempotente en el servidor, así que una
 * confirmación repetida sobre el mismo plan sólo reanuda lo pendiente.
 */
export async function runP4Sync(plan: P4SyncPlan, onProgress: (progress: P4SyncProgress) => void): Promise<P4SyncResult> {
  const { preview } = plan;
  const base = scopeFields(preview);
  const report = (phase: P4SyncProgress["phase"], summary: P4VerifySummary, detail: string) => onProgress({ phase, ...summary, detail });
  let summary: P4VerifySummary = { completed: 0, pending: preview.selected, failed: 0 };

  report("APROBANDO", summary, "Registrando la aprobación del alcance.");
  const approved = await callP4<P4Reply>({
    ...base,
    mode: "APPROVE_SCOPE",
    budget: preview.budget,
    confirmation: `APPROVE_SCOPE:${preview.scope.manifestId}:${preview.scope.scopeId}:${preview.scope.scopeHash}`,
  });
  if (!approved.ok) throw failure(approved, "La aprobación no fue confirmada.");

  report("CANARIO", summary, "Escribiendo un solo registro de prueba.");
  const canary = await callP4<P4Reply & { batch?: P4Batch }>({ ...base, mode: "EXECUTE_SCOPE", executionMode: "CANARY", budget: canaryBudget });
  if (!canary.ok || Number(canary.batch?.errors || 0) > 0) {
    const verified = await verifyScope(preview.scope.scopeId);
    report("DETENIDO", verified.summary, "El registro de prueba falló. No se escribió nada más.");
    return { ok: false, summary: verified.summary, stoppedReason: String(canary.status || "CANARIO_FALLIDO"), rounds: 0 };
  }

  let rounds = 0;
  for (;;) {
    report("VERIFICANDO", summary, "Comprobando lo escrito contra el plan.");
    const verified = await verifyScope(preview.scope.scopeId);
    summary = verified.summary;
    if (summary.failed > 0) {
      report("DETENIDO", summary, "Hay registros fallidos. Revisa antes de volver a confirmar.");
      return { ok: false, summary, stoppedReason: "REGISTROS_FALLIDOS", rounds };
    }
    if (verified.complete || summary.pending === 0) {
      report("COMPLETO", summary, "Periodo sincronizado.");
      return { ok: true, summary, stoppedReason: null, rounds };
    }
    if (rounds >= MAX_RESUME_ROUNDS) {
      report("DETENIDO", summary, "Se alcanzó el tope de lotes por confirmación. Vuelve a confirmar para continuar.");
      return { ok: false, summary, stoppedReason: "TOPE_DE_LOTES", rounds };
    }
    rounds++;
    report("CONTINUANDO", summary, `Lote ${rounds}: escribiendo hasta ${preview.budget.maxWrites} registros.`);
    const resumed = await callP4<P4Reply & { batch?: P4Batch }>({ ...base, mode: "RESUME_SCOPE", executionMode: "SCOPED_FULL", budget: preview.budget });
    if (!resumed.ok) {
      const after = await verifyScope(preview.scope.scopeId);
      report("DETENIDO", after.summary, "Un lote se detuvo por error. No se escribió nada más.");
      return { ok: false, summary: after.summary, stoppedReason: String(resumed.status || "LOTE_DETENIDO"), rounds };
    }
    if (Number(resumed.batch?.processed || 0) === 0 && Number(resumed.batch?.remaining || 0) > 0) {
      const after = await verifyScope(preview.scope.scopeId);
      report("DETENIDO", after.summary, "Quedan registros que dependen de otros aún no importados. Sincroniza primero el periodo anterior.");
      return { ok: false, summary: after.summary, stoppedReason: "DEPENDENCIAS_PENDIENTES", rounds };
    }
  }
}
