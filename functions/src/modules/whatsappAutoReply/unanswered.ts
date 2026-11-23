import { classifyMessage, isWithinWorkingHours, type WorkingHours } from "./domain";
import type { InboundRow } from "./planner";

// A client question that nobody answers is told to the team's internal group: the first notice after 3 minutes and a reminder
// every 5 minutes while it stays unanswered. Pure planning here; the runner reads, delivers and records.

export const FIRST_ALERT_MS = 3 * 60 * 1000;
export const REMINDER_MS = 5 * 60 * 1000;
/** Two hours of reminders at most: a question nobody has touched in two hours needs a person, not another ping. */
export const MAX_ALERTS = 24;
const TOLERANCE_MS = 5 * 1000;

export type OpenAlert = { messageId: string; chatId: string; questionAtMs: number; body: string; alertCount: number; lastAlertAtMs: number };

export type AlertAction = { messageId: string; chatId: string; kind: "FIRST" | "REMINDER"; count: number; questionAtMs: number; body: string; minutes: number };

export type AlertPlan = { alerts: AlertAction[]; resolve: string[]; expire: string[] };

export type AlertInput = {
  /** Recent messages of the observed groups, any order; must reach back to the oldest open alert. */
  messages: InboundRow[];
  observedChats: ReadonlySet<string>;
  /** Registered operator numbers: people of the team. Their messages answer a question. */
  operatorHashes: ReadonlySet<string>;
  /** The agents' own numbers: never clients, and never a human answer. */
  ignoreHashes: ReadonlySet<string>;
  /** Normalised texts Hugo itself sent per group: the connected number wrote them, a person did not. */
  hugoTexts: Record<string, ReadonlySet<string>>;
  /** Alerts already created, open or closed, by message id. */
  knownAlertIds: ReadonlySet<string>;
  openAlerts: OpenAlert[];
  nowMs: number;
  workingHours: WorkingHours | null;
  /** How far back a never-alerted question is still worth an alert. */
  lookbackMs: number;
};

export const normalizeText = (value: string) => String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim();

export function planUnansweredAlerts(input: AlertInput): AlertPlan {
  const plan: AlertPlan = { alerts: [], resolve: [], expire: [] };
  const { nowMs } = input;
  const isTeam = (row: InboundRow) => (!!row.authorHash && input.operatorHashes.has(row.authorHash))
    || (row.fromMe && !input.hugoTexts[row.chatId]?.has(normalizeText(row.body)));
  const answeredAfter = (chatId: string, atMs: number) => input.messages.some(row => row.chatId === chatId && row.timestampMs > atMs && isTeam(row));
  const inHours = isWithinWorkingHours(input.workingHours, nowMs);

  for (const alert of input.openAlerts) {
    if (answeredAfter(alert.chatId, alert.questionAtMs)) { plan.resolve.push(alert.messageId); continue; }
    if (alert.alertCount >= MAX_ALERTS) { plan.expire.push(alert.messageId); continue; }
    if (!inHours || nowMs - alert.lastAlertAtMs < REMINDER_MS - TOLERANCE_MS) continue;
    plan.alerts.push({ messageId: alert.messageId, chatId: alert.chatId, kind: "REMINDER", count: alert.alertCount + 1, questionAtMs: alert.questionAtMs, body: alert.body, minutes: Math.floor((nowMs - alert.questionAtMs) / 60000) });
  }

  if (!inHours) return plan;
  for (const row of input.messages) {
    if (!input.observedChats.has(row.chatId) || row.fromMe || input.knownAlertIds.has(row.id)) continue;
    if (row.authorHash && (input.operatorHashes.has(row.authorHash) || input.ignoreHashes.has(row.authorHash))) continue;
    const age = nowMs - row.timestampMs;
    if (age < FIRST_ALERT_MS || age > input.lookbackMs) continue;
    const kind = classifyMessage(row.body);
    if (kind !== "STATUS_INQUIRY" && kind !== "QUESTION") continue;
    if (answeredAfter(row.chatId, row.timestampMs)) continue;
    plan.alerts.push({ messageId: row.id, chatId: row.chatId, kind: "FIRST", count: 1, questionAtMs: row.timestampMs, body: row.body, minutes: Math.floor(age / 60000) });
  }
  return plan;
}

const quote = (text: string) => String(text ?? "").replace(/\s+/g, " ").trim().slice(0, 300);

/** The text for the internal group. Names the group and forwards the client's message; no ids. */
export function alertText(action: AlertAction, groupName: string): string {
  const group = groupName || "sin nombre";
  return action.kind === "FIRST"
    ? `Aviso de Hugo: un cliente hizo una consulta en el grupo «${group}» y lleva más de 3 minutos sin ser respondida.\nMensaje del cliente: «${quote(action.body)}»`
    : `Recordatorio de Hugo: la consulta de un cliente en el grupo «${group}» sigue sin respuesta (lleva ${action.minutes} minutos).\nMensaje del cliente: «${quote(action.body)}»`;
}
