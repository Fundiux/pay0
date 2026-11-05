import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebaseClient";

/**
 * Sincronización inversa IQ -> PAY0 (importación histórica P4).
 *
 * El motor trabaja en etapas (plan, alcance, aprobación, canario, reanudación,
 * verificación). Este servicio las encadena para que la pantalla sólo pida un
 * periodo y una confirmación.
 *
 * Contrato del servidor que gobierna la cadena:
 * - El alcance se reconstruye en cada llamada y excluye lo ya verificado, así
 *   que su hash cambia después de cada escritura. Antes de cada ejecución se
 *   vuelve a previsualizar y aprobar el alcance fresco, exigiendo que sus
 *   miembros sean un subconjunto de lo que el operador confirmó.
 * - Un registro cuyo cliente aún no existe en PAY0 queda en revisión hasta que
 *   el cliente exista y se vuelva a planear. Por eso la pantalla vuelve a
 *   preparar el periodo al terminar y pide otra confirmación si aparecen
 *   escrituras nuevas.
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
  excluded: Array<{ actionId: string; reason: string }>;
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
  manifestId: string;
  manifestHash: string;
  scopeId: string;
  planned: { solicitudes: number; pagos: number; aplicaciones: number; clientes: number; conciliaciones: number };
  writes: number;
  excluded: { completed: number; unchanged: number; review: number; terminal: number; dependency: number; other: number };
  preview: P4ScopePreview;
};

export type P4SyncPhase = "APROBANDO" | "CANARIO" | "VERIFICANDO" | "CONTINUANDO" | "COMPLETO" | "DETENIDO";

export type P4SyncProgress = P4VerifySummary & { phase: P4SyncPhase; detail: string; scopeId: string; round: number };

export type P4StopReason =
  | "CANARIO_FALLIDO"
  | "REGISTROS_FALLIDOS"
  | "ALCANCE_CAMBIADO"
  | "REQUIERE_REVISION"
  | "SIN_AVANCE"
  | "TOPE_DE_LOTES";

export type P4SyncResult = {
  ok: boolean;
  summary: P4VerifySummary;
  stoppedReason: P4StopReason | null;
  /** Miembros confirmados que el servidor dejó de considerar ejecutables. */
  pendingReview: number;
  rounds: number;
  manifestId: string;
  lastScopeId: string;
  stoppedAt: string | null;
};

const PLAN_GROUPS = ["iq-group-rr", "iq-group-pay0"];
const TIMEZONE = "America/Mexico_City";

/** Presupuesto aprobado por alcance; cada ejecución debe caber dentro de él. */
const scopeBudget: P4Budget = { maxActions: 25, maxWrites: 25, maxDurationMs: 120_000, maxErrors: 1, maxConcurrent: 1, maxRetries: 1 };
const canaryBudget: P4Budget = { maxActions: 1, maxWrites: 1, maxDurationMs: 60_000, maxErrors: 1, maxConcurrent: 1, maxRetries: 1 };
/** Tope de lotes por confirmación: un bloque de 10 días rara vez supera 25 acciones. */
const MAX_RESUME_ROUNDS = 12;
/** Intentos de una sola escritura cuando el canario no completó ninguna. */
const MAX_CANARY_ATTEMPTS = 3;

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

/** Miembros ejecutables: filas del periodo y los clientes que esas filas necesitan. */
const executableRole = (key: string) => key.startsWith("PRIMARY:") || key.startsWith("CLIENT_DEPENDENCY:");

function tally(counts: Record<string, number>, entity: string, operation: string): number {
  return Object.entries(counts)
    .filter(([key]) => executableRole(key) && key.includes(`:${entity}:`) && key.endsWith(`:${operation}`))
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

function assertReadOnlyPreview(preview: P4ScopePreview): void {
  if (!preview.ok || !preview.readOnly || preview.scope.expectedIqWrites !== 0 || preview.scope.expectedExternalEffects !== 0) {
    throw new Error("La vista previa no acredita un alcance sin efectos externos.");
  }
}

function previewScope(manifestId: string, manifestHash: string, scope: P4ScopeRequest): Promise<P4ScopePreview> {
  return callP4<P4ScopePreview>({ mode: "PREVIEW_SCOPE", manifestId, manifestHash, scope, budget: scopeBudget });
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
    throw failure(planned, planned.status === "PLAN_PARTIAL" ? "P4_PLAN_BUDGET_EXCEEDED" : "No se pudo leer IQ para ese periodo.");
  }
  const preview = await previewScope(planned.manifestId, planned.manifestHash, { type: "MONTH_BLOCK", month: period.month, block: period.block });
  assertReadOnlyPreview(preview);
  return {
    period,
    range,
    manifestId: preview.scope.manifestId,
    manifestHash: preview.scope.manifestHash,
    scopeId: preview.scope.scopeId,
    planned: {
      solicitudes: tally(preview.counts, "SOLICITUD", "CREATE_HISTORICAL"),
      pagos: tally(preview.counts, "PAYMENT", "CREATE_HISTORICAL"),
      aplicaciones: tally(preview.counts, "APPLICATION", "CREATE_HISTORICAL"),
      clientes: tally(preview.counts, "CLIENT", "CREATE_HISTORICAL") + tally(preview.counts, "CLIENT", "DEPENDENCY_IMPORT"),
      conciliaciones: Object.entries(preview.counts).filter(([key]) => executableRole(key) && key.endsWith(":RECONCILE")).reduce((sum, [, value]) => sum + Number(value || 0), 0),
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

type Fresh = {
  preview: P4ScopePreview;
  /** Confirmados que el servidor ya da por escritos. */
  completed: number;
  /** Confirmados que el servidor ahora excluye por un motivo distinto a COMPLETED. */
  review: number;
  /** Miembros nuevos que el operador nunca vio. */
  unseen: number;
};

/**
 * Vuelve a pedir el alcance al servidor y lo compara con lo confirmado. Sólo se
 * ejecuta un alcance cuyos miembros estén dentro de lo que el operador vio.
 */
async function refreshScope(plan: P4SyncPlan, confirmed: Set<string>): Promise<Fresh> {
  const request = plan.preview.scope.request;
  const preview = await previewScope(plan.manifestId, plan.manifestHash, request);
  assertReadOnlyPreview(preview);
  const fresh = preview.scope.request;
  if (fresh.type !== request.type || fresh.month !== request.month || fresh.block !== request.block) {
    throw new Error("El servidor devolvió un periodo distinto al confirmado.");
  }
  let completed = 0, review = 0, unseen = 0;
  for (const member of preview.scope.members) if (!confirmed.has(member.actionId)) unseen++;
  for (const row of preview.scope.excluded) {
    if (!confirmed.has(row.actionId)) continue;
    if (row.reason === "COMPLETED") completed++;
    else review++;
  }
  return { preview, completed, review, unseen };
}

async function approveScope(preview: P4ScopePreview): Promise<void> {
  const approved = await callP4<P4Reply>({
    ...scopeFields(preview),
    mode: "APPROVE_SCOPE",
    budget: scopeBudget,
    confirmation: `APPROVE_SCOPE:${preview.scope.manifestId}:${preview.scope.scopeId}:${preview.scope.scopeHash}`,
  });
  if (!approved.ok) throw failure(approved, "La aprobación no fue confirmada.");
}

function executeScope(preview: P4ScopePreview, mode: "EXECUTE_SCOPE" | "RESUME_SCOPE", executionMode: "CANARY" | "SCOPED_FULL", budget: P4Budget) {
  return callP4<P4Reply & { batch?: P4Batch; runId?: string }>({ ...scopeFields(preview), mode, executionMode, budget });
}

/**
 * Ejecuta el plan confirmado: aprueba el alcance, escribe un solo registro como
 * prueba, verifica y continúa por lotes acotados hasta terminar o hasta el
 * primer error. Antes de cada ejecución vuelve a previsualizar y aprobar el
 * alcance fresco; si el servidor propone miembros que el operador no vio, o
 * deja de considerar ejecutables miembros confirmados, se detiene.
 */
export async function runP4Sync(plan: P4SyncPlan, onProgress: (progress: P4SyncProgress) => void): Promise<P4SyncResult> {
  const confirmed = new Set(plan.preview.scope.members.map(member => member.actionId));
  // Escritos según VERIFY_SCOPE, por alcance ejecutado. Un alcance se repite
  // cuando el servidor aún no da por verificado lo recién escrito (por ejemplo
  // una factura cuyas aplicaciones faltan), y entonces su verificación es
  // acumulada; dos alcances distintos nunca se traslapan.
  const completedByScope = new Map<string, number>();
  let round = 0, failed = 0, lastScopeId = plan.scopeId;
  const completedTotal = () => [...completedByScope.values()].reduce((sum, value) => sum + value, 0);
  const summaryOf = (fresh: Fresh): P4VerifySummary => ({ completed: completedTotal(), pending: fresh.preview.selected, failed });
  const report = (phase: P4SyncPhase, summary: P4VerifySummary, detail: string) => onProgress({ phase, ...summary, detail, scopeId: lastScopeId, round });
  const stop = (reason: P4StopReason, summary: P4VerifySummary, detail: string, pendingReview = 0): P4SyncResult => {
    report("DETENIDO", summary, detail);
    return { ok: false, summary, stoppedReason: reason, pendingReview, rounds: round, manifestId: plan.manifestId, lastScopeId, stoppedAt: detail };
  };
  const done = (summary: P4VerifySummary): P4SyncResult => {
    report("COMPLETO", summary, "Periodo sincronizado.");
    return { ok: true, summary, stoppedReason: null, pendingReview: 0, rounds: round, manifestId: plan.manifestId, lastScopeId, stoppedAt: null };
  };

  /** Prepara un alcance ejecutable o explica por qué no se puede seguir. */
  async function nextScope(phase: P4SyncPhase, detail: string): Promise<{ fresh: Fresh; result?: undefined } | { fresh: Fresh; result: P4SyncResult }> {
    const fresh = await refreshScope(plan, confirmed);
    lastScopeId = fresh.preview.scope.scopeId;
    const summary = summaryOf(fresh);
    if (fresh.unseen > 0) return { fresh, result: stop("ALCANCE_CAMBIADO", summary, `El servidor propone ${fresh.unseen} registro(s) que no viste. Vuelve a preparar el periodo.`) };
    if (fresh.review > 0) return { fresh, result: stop("REQUIERE_REVISION", summary, `${fresh.review} registro(s) confirmado(s) pasaron a revisión en el servidor. No se escribió nada más.`, fresh.review) };
    if (fresh.preview.selected === 0) return { fresh, result: done(summary) };
    report(phase, summary, detail);
    await approveScope(fresh.preview);
    return { fresh };
  }

  // Canario: una sola escritura. Si no completa ninguna sin error, se reintenta
  // acotado a una escritura antes de pasar a lotes.
  let canaryCompleted = false;
  for (let attempt = 1; attempt <= MAX_CANARY_ATTEMPTS && !canaryCompleted; attempt++) {
    const step = await nextScope("CANARIO", attempt === 1 ? "Escribiendo un solo registro de prueba." : `Reintento ${attempt} de una sola escritura.`);
    if (step.result) return step.result;
    const reply = await executeScope(step.fresh.preview, attempt === 1 ? "EXECUTE_SCOPE" : "RESUME_SCOPE", attempt === 1 ? "CANARY" : "SCOPED_FULL", canaryBudget);
    const verified = await verifyScope(step.fresh.preview.scope.scopeId);
    failed = verified.summary.failed;
    completedByScope.set(step.fresh.preview.scope.scopeId, verified.summary.completed);
    const summary = { completed: completedTotal(), pending: verified.summary.pending, failed };
    report("VERIFICANDO", summary, "Comprobando el registro de prueba contra el plan.");
    if (!reply.ok || Number(reply.batch?.errors || 0) > 0 || failed > 0) {
      return stop("CANARIO_FALLIDO", summary, `El registro de prueba falló (${reply.status || "error"}). No se escribió nada más.`);
    }
    canaryCompleted = Number(reply.batch?.completed || 0) === 1;
  }
  if (!canaryCompleted) {
    const fresh = await refreshScope(plan, confirmed);
    return stop("SIN_AVANCE", summaryOf(fresh), `Ninguna escritura avanzó en ${MAX_CANARY_ATTEMPTS} intentos. Revisa los registros pendientes.`, fresh.preview.selected);
  }

  // Lotes acotados hasta terminar, con el alcance fresco en cada ronda.
  for (;;) {
    if (round >= MAX_RESUME_ROUNDS) {
      const fresh = await refreshScope(plan, confirmed);
      if (fresh.preview.selected === 0) return done(summaryOf(fresh));
      return stop("TOPE_DE_LOTES", summaryOf(fresh), "Se alcanzó el tope de lotes por confirmación. Puedes continuar con lo pendiente.");
    }
    round++;
    const step = await nextScope("CONTINUANDO", `Lote ${round}: escribiendo hasta ${scopeBudget.maxWrites} registros.`);
    if (step.result) return step.result;
    const reply = await executeScope(step.fresh.preview, "RESUME_SCOPE", "SCOPED_FULL", scopeBudget);
    const verified = await verifyScope(step.fresh.preview.scope.scopeId);
    failed = verified.summary.failed;
    completedByScope.set(step.fresh.preview.scope.scopeId, verified.summary.completed);
    const summary = { completed: completedTotal(), pending: verified.summary.pending, failed };
    report("VERIFICANDO", summary, "Comprobando el lote contra el plan.");
    if (!reply.ok || reply.status === "PAUSED_ERROR" || failed > 0) {
      return stop("REGISTROS_FALLIDOS", summary, `Un lote se detuvo por error (${reply.status || "error"}). No se escribió nada más.`);
    }
    if (Number(reply.batch?.processed || 0) === 0) {
      const remaining = Number(reply.batch?.remaining || 0) || verified.summary.pending;
      return stop("REQUIERE_REVISION", { ...summary, pending: remaining }, `${remaining} registro(s) no son ejecutables todavía. Prepara de nuevo el periodo cuando sus dependencias existan.`, remaining);
    }
  }
}
