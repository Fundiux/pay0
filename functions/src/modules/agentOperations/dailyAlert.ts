import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { sendTelegramMessage } from "../telegram/service";
import { loadSuperadminAlertRecipients } from "./alertRecipients";
import { countOpenUnmatchedPayments } from "../paymentApplications/unmatchedPaymentReview";
import { loadAgentOperations } from "./callables";
import { COMPLEMENT_LATE_DAYS, loadPendingItems, type PendingItems } from "./pendingItems";
import { mexicoDayKey } from "./time";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const TELEGRAM_BOT_TOKEN = defineSecret("TELEGRAM_BOT_TOKEN");

const minutes = (ms: number | null) => (ms === null || ms === undefined ? "sin datos" : `${(ms / 60000).toFixed(1)} min`);
const percent = (value: number | null) => (value === null || value === undefined ? "sin datos" : `${value}%`);

/** Texto del resumen diario para el dueño; función pura para poder probarla sin Firebase. */
const INCIDENT_DETAIL_LIMIT = 5;
const shorten = (value: unknown, max: number) => { const text = String(value ?? "").replace(/\s+/g, " ").trim(); return text.length > max ? `${text.slice(0, max - 1)}…` : text; };

/** Open incidents grouped by cause and entity type, so the summary says what is open and not only how many. */
function incidentDetail(incidents: Array<Record<string, any>>): string[] {
  const groups = new Map<string, number>();
  for (const row of incidents) {
    if (row.status !== "OPEN") continue;
    const cause = shorten(row.cause || "Sin causa registrada", 90), type = shorten(row.entityType, 30);
    const key = type ? `${cause} [${type}]` : cause;
    groups.set(key, (groups.get(key) || 0) + 1);
  }
  const sorted = [...groups].sort((a, b) => b[1] - a[1]);
  const lines = sorted.slice(0, INCIDENT_DETAIL_LIMIT).map(([label, count]) => `  - ${label}${count > 1 ? ` (${count})` : ""}`);
  if (sorted.length > INCIDENT_DETAIL_LIMIT) lines.push(`  - y ${sorted.length - INCIDENT_DETAIL_LIMIT} tipos más`);
  return lines;
}

/** Pending items other than incidents; a figure that could not be read is left out, never shown as zero. */
function pendingLines(pending: PendingItems): string[] {
  const lines: string[] = [];
  const add = (count: number | undefined, text: (count: number) => string) => { if (count) lines.push(text(count)); };
  add(pending.complementsHeld, count => `Complementos de pago detenidos en IQ: ${count}`);
  add(pending.complementsLate, count => `Complementos solicitados con más de ${COMPLEMENT_LATE_DAYS} días sin llegar: ${count}`);
  add(pending.cashUnsigned, count => `Dispersiones en efectivo sin recibo firmado: ${count}`);
  add(pending.cancellationReview, count => `Solicitudes con cancelación en revisión: ${count}`);
  return lines;
}

export function buildDailyAlertMessage(operations: Awaited<ReturnType<typeof loadAgentOperations>>, unmatched?: { a: number; b: number }, pending?: PendingItems): string {
  const { report, killSwitch } = operations;
  const autonomy = report.autonomy;
  const openIncidents = operations.incidents.filter((row: Record<string, any>) => row.status === "OPEN").length;
  const tokens = (report.tokens ?? []).map(row => `${row.provider}: ${row.requests} llamadas`).join(", ") || "sin llamadas a IA";
  const lines = [
    `Resumen diario de agentes (${report.day}, corte 20:00 hora de México)`,
    killSwitch ? "ATENCIÓN: el interruptor de emergencia está ACTIVADO; los agentes están detenidos." : "Interruptor de emergencia: apagado (agentes operando).",
    `Revisadas: ${report.reviewed} · Detectadas: ${report.detected} · Corregidas: ${report.corrected} · Escaladas: ${report.escalated} · Por reintentar: ${report.retryable}`,
    `Incidentes abiertos: ${openIncidents}`,
    ...(openIncidents ? incidentDetail(operations.incidents) : []),
  ];
  if (unmatched) lines.push(unmatched.a + unmatched.b === 0 ? "Pagos sin solicitud: ninguno." : `Pagos sin solicitud: ${unmatched.a} · Pagos que no coinciden con sus facturas pendientes: ${unmatched.b}`);
  if (pending) lines.push(...pendingLines(pending));
  if (autonomy) {
    lines.push(
      `Autonomía: ${percent(autonomy.agentResolutionRate)} resuelto por agentes (${autonomy.resolvedByAgent} agentes, ${autonomy.resolvedByPerson} personas)`,
      `Ejecuciones exitosas: ${autonomy.runsSucceeded} de ${autonomy.runsFinished} · Duración media: ${minutes(autonomy.avgRunMs)} · Intervenciones humanas hoy: ${autonomy.humanInterventionsToday}`
    );
  }
  lines.push(`IAs usadas hoy: ${tokens}`);
  if (report.causes.length) lines.push(`Causas frecuentes: ${report.causes.map((row: { cause: string; count: number }) => `${row.cause} (${row.count})`).join("; ")}`);
  if (operations.reportScope) lines.push(operations.reportScope);
  return lines.join("\n").slice(0, 3900);
}

/**
 * Envía una vez al día, por el bot de Telegram, el estado de los agentes a cada superadmin con Telegram vinculado.
 * Solo lee y notifica: no modifica solicitudes, pagos ni incidentes.
 */
export const sendAgentDailyStatusAlert = onSchedule(
  { schedule: "every day 20:00", timeZone: "America/Mexico_City", secrets: [TELEGRAM_BOT_TOKEN], memory: "512MiB", timeoutSeconds: 300 },
  async () => {
    const day = mexicoDayKey();
    const byRoot = await loadSuperadminAlertRecipients();
    for (const [rootId, recipients] of byRoot) {
      try {
        const message = buildDailyAlertMessage(await loadAgentOperations(rootId), await countOpenUnmatchedPayments(rootId).catch(() => undefined), await loadPendingItems(rootId).catch(() => undefined));
        for (const recipient of recipients) {
          // create() falla si ya se envió hoy a este destinatario: evita duplicados en reintentos del scheduler.
          const marker = db.collection("agentDailyAlerts").doc(`${rootId}__${day}__${recipient.id}`);
          try { await marker.create({ rootId, day, recipientId: recipient.id, status: "SENDING", createdAt: FieldValue.serverTimestamp() }); }
          catch (error) {
            const code = (error as { code?: unknown })?.code;
            if (code !== 6 && code !== "already-exists") console.error("AGENT_DAILY_ALERT_MARKER_FAILED", rootId, recipient.id, String((error as Error)?.message || error).slice(0, 200));
            continue;
          }
          try {
            await sendTelegramMessage(TELEGRAM_BOT_TOKEN.value(), recipient.chatId, message);
            await marker.update({ status: "SENT", sentAt: FieldValue.serverTimestamp() });
          } catch (error) {
            await marker.update({ status: "FAILED", error: String((error as Error)?.message || error).slice(0, 300) }).catch(() => undefined);
            console.error("AGENT_DAILY_ALERT_SEND_FAILED", rootId, recipient.id);
          }
        }
      } catch (error) {
        console.error("AGENT_DAILY_ALERT_REPORT_FAILED", rootId, String((error as Error)?.message || error));
      }
    }
  }
);
