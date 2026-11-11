/**
 * Reglas de automatización de Hugo: decisiones puras (sin Firebase) para poder probarlas.
 * Una regla nace de lecciones de personas, el dueño la aprueba, corre 7 días en simulación y después ejecuta sola.
 */

export const LESSONS_REQUIRED = 3;
export const SIMULATION_DAYS = 7;
export const DEFAULT_DAILY_CAP = 10;
/** Un resultado se considera deshecho si la misma causa reaparece en la misma entidad dentro de este plazo. */
export const UNDONE_WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export type RuleStatus = "PROPUESTA" | "SIMULACION" | "ACTIVA" | "RECHAZADA" | "REVOCADA";
export type RuleAction = "APPROVE" | "REJECT" | "REVOKE" | "PAUSE" | "RESUME";

export const RULE_STATUS_LABEL: Record<RuleStatus, string> = {
  PROPUESTA: "Propuesta, espera tu aprobación", SIMULACION: "En simulación (solo registra lo que haría)",
  ACTIVA: "Activa", RECHAZADA: "Rechazada", REVOCADA: "Revocada",
};

/** Herramientas del catálogo que una regla puede ejecutar sola: riesgo 1, idempotentes, reversibles y sin aprobación por ejecución. */
export const AUTOMATABLE_TOOL_LABEL: Record<string, string> = {
  "quotation-recovery": "Volver a generar la cotización",
};

const stripAccents = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Misma causa escrita con otros folios, importes o ids produce la misma clave. */
export function canonicalCause(cause: unknown): string {
  return stripAccents(String(cause ?? "")).toLowerCase()
    .replace(/\$\s?[\d,]+(\.\d+)?/g, "#")
    .replace(/\b[a-z]{0,3}-?\d[\w-]*\b/g, "#")
    .replace(/\b[a-f0-9]{16,}\b/g, "#")
    .replace(/[^a-z0-9# ]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
}

/** Respaldo determinista cuando el modelo no está disponible: solo reconoce acciones claras del catálogo. */
export function keywordTool(actionText: unknown): string | null {
  const text = stripAccents(String(actionText ?? "")).toLowerCase();
  if (/(cotizacion)/.test(text) && /(regener|volv|reintent|genere|genera|rehice|rehic)/.test(text)) return "quotation-recovery";
  return null;
}

export function isAutomatableTool(toolId: unknown): toolId is string {
  return typeof toolId === "string" && Object.prototype.hasOwnProperty.call(AUTOMATABLE_TOOL_LABEL, toolId);
}

export type NormalizedLesson = { incidentId: string; causeKey: string; toolId: string };

/** Agrupa lecciones normalizadas; una regla se propone con LESSONS_REQUIRED incidencias distintas con la misma causa y acción. */
export function ruleCandidates(lessons: NormalizedLesson[]): Array<{ causeKey: string; toolId: string; incidentIds: string[] }> {
  const groups = new Map<string, { causeKey: string; toolId: string; incidentIds: Set<string> }>();
  for (const lesson of lessons) {
    if (!lesson.causeKey || !isAutomatableTool(lesson.toolId) || !lesson.incidentId) continue;
    const key = `${lesson.causeKey}|${lesson.toolId}`;
    const group = groups.get(key) || groups.set(key, { causeKey: lesson.causeKey, toolId: lesson.toolId, incidentIds: new Set() }).get(key)!;
    group.incidentIds.add(lesson.incidentId);
  }
  return [...groups.values()].filter(group => group.incidentIds.size >= LESSONS_REQUIRED).map(group => ({ causeKey: group.causeKey, toolId: group.toolId, incidentIds: [...group.incidentIds].sort() }));
}

/** Transiciones permitidas; el dueño es quien aprueba, rechaza, revoca, pausa o reanuda. */
export function nextStatus(status: RuleStatus, action: RuleAction): RuleStatus | null {
  if (action === "APPROVE") return status === "PROPUESTA" ? "SIMULACION" : null;
  if (action === "REJECT") return status === "PROPUESTA" ? "RECHAZADA" : null;
  if (action === "REVOKE") return status === "SIMULACION" || status === "ACTIVA" ? "REVOCADA" : null;
  return null;
}

export const simulationEndsAtMs = (approvedAtMs: number) => approvedAtMs + SIMULATION_DAYS * DAY_MS;

/** Tras la ventana de simulación, y mientras nadie la haya revocado, la regla pasa a ACTIVA. */
export function promoteIfDue(rule: { status: RuleStatus; simulationEndsAtMs: number | null }, nowMs: number): RuleStatus {
  return rule.status === "SIMULACION" && rule.simulationEndsAtMs !== null && nowMs >= rule.simulationEndsAtMs ? "ACTIVA" : rule.status;
}

export type RuleGate = { allowed: boolean; mode: "SIMULACION" | "REAL" | null; reason: string | null };

/** Orden de los frenos: interruptor global, regla pausada, estado, tope diario. */
export function ruleGate(input: { status: RuleStatus; paused: boolean; globalKill: boolean; runsToday: number; dailyCap: number }): RuleGate {
  if (input.globalKill) return { allowed: false, mode: null, reason: "Interruptor global de automatización activado." };
  if (input.paused) return { allowed: false, mode: null, reason: "Regla pausada." };
  if (input.status !== "SIMULACION" && input.status !== "ACTIVA") return { allowed: false, mode: null, reason: "Regla no activa." };
  if (input.runsToday >= input.dailyCap) return { allowed: false, mode: null, reason: "Tope diario alcanzado." };
  return { allowed: true, mode: input.status === "ACTIVA" ? "REAL" : "SIMULACION", reason: null };
}

/** Porcentaje de acciones reales verificadas que luego se deshicieron; null mientras no haya ninguna. */
export function undoneRate(verified: number, undone: number): number | null {
  return verified > 0 ? Math.round((undone / verified) * 100) : null;
}
