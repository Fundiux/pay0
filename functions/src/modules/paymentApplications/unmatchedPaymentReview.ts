import { FieldValue } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { assertAuthorized } from "../../utils/authGuard";
import { logActivityTx } from "../../utils/logActivity";
import { loadSuperadminAlertRecipients } from "../agentOperations/alertRecipients";
import { getPagoCoverageState } from "../deposits/foundation";
import { normalizePagoStatus } from "../pagos/domain";
import { db, getActivityAdminId, getMyUser, getRootId, requireAuth, requireRole } from "../sharedCallables/helpers";
import { sendTelegramMessage } from "../telegram/service";
import {
  classifyUnmatchedPayment, UNMATCHED_DECISION_OPTIONS, UNMATCHED_SOLICITUD_LIMIT,
  type UnmatchedCase, type UnmatchedDecisionOption,
} from "./unmatchedPaymentDomain";

const TELEGRAM_BOT_TOKEN = defineSecret("TELEGRAM_BOT_TOKEN");
const clean = (value: unknown) => String(value ?? "").trim();
const MEXICO_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" });

function millis(value: any): number {
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.seconds === "number") return value.seconds * 1000;
  if (value instanceof Date) return value.getTime();
  return typeof value === "string" ? Date.parse(value) || 0 : 0;
}
const isoOrNull = (value: any) => { const ms = millis(value); return ms ? new Date(ms).toISOString() : null; };
const clientName = (client: Record<string, any> | undefined) => clean(client?.razonSocial || client?.name || client?.nombre) || "Cliente sin nombre";

/** Fecha que el usuario capturó para el pago; si falta, el día de creación en hora de México. */
function paymentDay(pago: Record<string, any>): string {
  const local = clean(pago.paymentDateTimeLocal);
  if (/^\d{4}-\d{2}-\d{2}/.test(local)) return local.slice(0, 10);
  const ms = millis(pago.createdAt);
  return ms ? MEXICO_DAY.format(new Date(ms)) : "sin fecha";
}

/**
 * Pagos creados antes de que el código esté activo nunca se clasifican ni avisan: el corte es el primer
 * evento tras el despliegue. Ese primer evento evalúa un pago que ya existe, así que el corte se compara
 * con una ventana de gracia (ver ACTIVATION_GRACE_MS). Sin documento de corte no hay clasificación retroactiva.
 */
const ACTIVATION_GRACE_MS = 30 * 60_000; // ventana de 20 min del disparador más el procesamiento del comprobante
async function reviewActivatedAt(): Promise<number> {
  const ref = db.doc("unmatchedPaymentReviewConfig/global");
  let snapshot = await ref.get();
  if (!snapshot.exists) {
    try { await ref.create({ activatedAt: FieldValue.serverTimestamp() }); } catch { /* otro evento lo creó primero */ }
    snapshot = await ref.get();
  }
  return millis(snapshot.data()?.activatedAt);
}

async function closeUnmatchedReview(pagoId: string, reason: string) {
  await db.doc(`pagos/${pagoId}`).update({
    "unmatchedReview.open": false, "unmatchedReview.closedReason": reason,
    "unmatchedReview.closedAt": FieldValue.serverTimestamp(), "unmatchedReview.updatedAt": FieldValue.serverTimestamp(),
  });
}

/**
 * Called by the automatic application when a pago stays in review. It only records the classification;
 * it never creates solicitudes or invoices and never moves money.
 */
export async function syncUnmatchedReview(pagoId: string, reason: string): Promise<void> {
  const ref = db.doc(`pagos/${pagoId}`);
  const pago = (await ref.get()).data();
  if (!pago?.rootId || !pago.clienteId) return;
  const current = pago.unmatchedReview;
  const classified = async () => {
    const solicitudes = await db.collection("solicitudes").where("rootId", "==", pago.rootId).where("clienteId", "==", pago.clienteId).limit(UNMATCHED_SOLICITUD_LIMIT + 1).get();
    return classifyUnmatchedPayment({ pago, reason, solicitudes: solicitudes.docs.slice(0, UNMATCHED_SOLICITUD_LIMIT).map(doc => ({ ...doc.data(), id: doc.id })),
      limitReached: solicitudes.size > UNMATCHED_SOLICITUD_LIMIT });
  };
  if (current?.open !== true && (!millis(pago.createdAt) || millis(pago.createdAt) < await reviewActivatedAt() - ACTIVATION_GRACE_MS)) return;
  const result = await classified();
  if (!result.case) { if (current?.open === true) await closeUnmatchedReview(pagoId, "NO_LONGER_UNMATCHED"); return; }
  await db.runTransaction(async tx => {
    const data = (await tx.get(ref)).data();
    if (!data) return;
    const before = data.unmatchedReview || {};
    if (before.open === true && before.case === result.case && before.pendingCount === result.pendingCount) return;
    tx.update(ref, { unmatchedReview: {
      ...(before.latestDecision ? { latestDecision: before.latestDecision } : {}),
      open: true, case: result.case, reason, pendingCount: result.pendingCount,
      classifiedAt: before.open === true && before.case === result.case ? before.classifiedAt ?? FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    } });
  });
}

export async function countOpenUnmatchedPayments(rootId: string): Promise<{ a: number; b: number }> {
  const count = async (kind: UnmatchedCase) => (await db.collection("pagos").where("rootId", "==", rootId)
    .where("unmatchedReview.open", "==", true).where("unmatchedReview.case", "==", kind).count().get()).data().count;
  const [a, b] = await Promise.all([count("A"), count("B")]);
  return { a, b };
}

export function buildUnmatchedPaymentMessage(kind: UnmatchedCase, row: { cliente: string; monto: number; moneda: string; fecha: string; folio: string }): string {
  const currency = /^[A-Z]{3}$/.test(row.moneda) ? row.moneda : "MXN";
  const amount = new Intl.NumberFormat("es-MX", { style: "currency", currency }).format(row.monto);
  return [
    kind === "A" ? "Pago sin solicitud" : "Pago que no coincide con sus facturas pendientes",
    kind === "A" ? "Estos pagos no cuentan con solicitud aún." : "El cliente tiene facturas pendientes, pero este pago no coincide con ninguna.",
    `Cliente: ${row.cliente}`, `Monto: ${amount}`, `Fecha: ${row.fecha}`, `Folio: ${row.folio}`,
    "Revísalo en Pagos, sección Pagos sin solicitud.",
  ].join("\n");
}

type Deliver = (chatId: string, text: string) => Promise<unknown>;
const deliverWithBot: Deliver = (chatId, text) => sendTelegramMessage(TELEGRAM_BOT_TOKEN.value(), chatId, text);

export async function sendUnmatchedAlert(pagoId: string, pago: Record<string, any>, kind: UnmatchedCase, deliver: Deliver = deliverWithBot) {
  const rootId = clean(pago.rootId);
  const recipients = (await loadSuperadminAlertRecipients()).get(rootId) || [];
  if (!recipients.length) return;
  const message = buildUnmatchedPaymentMessage(kind, { cliente: clientName((await db.doc(`clients/${clean(pago.clienteId)}`).get()).data()),
    monto: Number(pago.montoTotal) || 0, moneda: clean(pago.moneda), fecha: paymentDay(pago), folio: clean(pago.folio) || pagoId });
  for (const recipient of recipients) {
    // create() fails when this pago+case was already sent to this recipient: retries and trigger re-fires never duplicate.
    const marker = db.collection("pagoSinSolicitudAlerts").doc(`${rootId}__${pagoId}__${kind}__${recipient.id}`);
    try { await marker.create({ rootId, pagoId, case: kind, recipientId: recipient.id, status: "SENDING", createdAt: FieldValue.serverTimestamp() }); }
    catch (error) {
      const code = (error as { code?: unknown })?.code;
      if (code !== 6 && code !== "already-exists") console.error("UNMATCHED_PAYMENT_ALERT_MARKER_FAILED", rootId, recipient.id);
      continue;
    }
    try {
      await deliver(recipient.chatId, message);
      await marker.update({ status: "SENT", sentAt: FieldValue.serverTimestamp() });
    } catch (error) {
      await marker.update({ status: "FAILED", error: String((error as Error)?.message || error).slice(0, 300) }).catch(() => undefined);
      console.error("UNMATCHED_PAYMENT_ALERT_SEND_FAILED", rootId, recipient.id);
    }
  }
}

/** Closes a review once the pago is fully applied, and alerts once when a pago enters the list. */
export async function handleUnmatchedPaymentWrite(pagoId: string, before: Record<string, any> | undefined, after: Record<string, any> | undefined,
  send: typeof sendUnmatchedAlert = sendUnmatchedAlert): Promise<"CLOSED" | "ALERTED" | "IGNORED"> {
  const review = after?.unmatchedReview;
  if (!after || review?.open !== true) return "IGNORED";
  if (normalizePagoStatus(after.status) === "APLICADO_TOTAL" || getPagoCoverageState(after).available <= 0) { await closeUnmatchedReview(pagoId, "APPLIED"); return "CLOSED"; }
  if (before?.unmatchedReview?.open === true && before.unmatchedReview.case === review.case) return "IGNORED";
  if (review.case !== "A" && review.case !== "B") return "IGNORED";
  await send(pagoId, after, review.case);
  return "ALERTED";
}

export const notifyUnmatchedPayment = onDocumentWritten(
  { document: "pagos/{pagoId}", region: "us-central1", retry: true, timeoutSeconds: 120, memory: "256MiB", maxInstances: 2, secrets: [TELEGRAM_BOT_TOKEN] },
  async event => {
    const created = Date.parse(event.time);
    if (!Number.isFinite(created) || Date.now() - created > 20 * 60_000) return;
    await handleUnmatchedPaymentWrite(event.params.pagoId, event.data?.before.data(), event.data?.after.data());
  },
);

type ReviewActor = { uid: string; rootId: string; role: "superadmin" | "admin"; adminId: string; displayName: string };

async function resolveReviewActor(request: any): Promise<ReviewActor> {
  const uid = requireAuth(request);
  const me = await getMyUser(uid);
  const role = requireRole(me, ["superadmin", "admin"]) as ReviewActor["role"];
  assertAuthorized(request.auth, me, { allowedRoles: ["superadmin", "admin"], requiredModule: "pagos", requiredAction: ["conciliate"] });
  const rootId = await getRootId(uid);
  return { uid, rootId, role, adminId: getActivityAdminId(me, uid, rootId), displayName: clean(me?.name || me?.displayName || me?.email) || uid };
}

// A superadmin sees the whole root; an admin only the pagos that belong to them.
const canSeePago = (actor: ReviewActor, pago: Record<string, any>) =>
  clean(pago.rootId) === actor.rootId && (actor.role === "superadmin" || clean(pago.adminId) === actor.uid);

export const listPagosSinSolicitud = onCall({ cors: true, timeoutSeconds: 60, memory: "256MiB" }, async request => {
  const actor = await resolveReviewActor(request);
  const snapshot = await db.collection("pagos").where("rootId", "==", actor.rootId).where("unmatchedReview.open", "==", true).limit(201).get();
  const pagos = snapshot.docs.filter(doc => canSeePago(actor, doc.data()));
  const clientIds = [...new Set(pagos.map(doc => clean(doc.get("clienteId"))).filter(Boolean))];
  const names = new Map<string, string>();
  for (let index = 0; index < clientIds.length; index += 100) {
    const rows = await db.getAll(...clientIds.slice(index, index + 100).map(id => db.doc(`clients/${id}`)));
    for (const row of rows) if (row.exists && row.get("rootId") === actor.rootId) names.set(row.id, clientName(row.data()));
  }
  const rows = pagos.slice(0, 200).map(doc => {
    const pago = doc.data(), review = pago.unmatchedReview || {}, decision = review.latestDecision;
    return {
      pagoId: doc.id, folio: clean(pago.folio) || doc.id, clienteId: clean(pago.clienteId), clienteNombre: names.get(clean(pago.clienteId)) || "Cliente sin nombre",
      monto: Number(pago.montoTotal) || 0, moneda: clean(pago.moneda) || "MXN", fecha: paymentDay(pago),
      case: review.case === "B" ? "B" : "A", reason: clean(review.reason), pendingCount: Number(review.pendingCount) || 0, classifiedAt: isoOrNull(review.classifiedAt),
      latestDecision: decision ? { option: clean(decision.option), decidedByName: clean(decision.decidedByName), decidedAt: isoOrNull(decision.decidedAt), note: clean(decision.note) } : null,
    };
  });
  return { ok: true, rows, truncated: snapshot.size > 200 };
});

export const decidePagoSinSolicitud = onCall({ cors: true, timeoutSeconds: 60, memory: "256MiB" }, async request => {
  const actor = await resolveReviewActor(request);
  const data = request.data || {};
  const pagoId = clean(data.pagoId), requestId = clean(data.requestId), note = clean(data.note);
  const option = clean(data.option) as UnmatchedDecisionOption;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(pagoId)) throw new HttpsError("invalid-argument", "pagoId inválido.");
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(requestId)) throw new HttpsError("invalid-argument", "requestId inválido.");
  if (!(UNMATCHED_DECISION_OPTIONS as readonly string[]).includes(option)) throw new HttpsError("invalid-argument", "Opción de decisión inválida.");
  if (note.length > 500) throw new HttpsError("invalid-argument", "La nota admite hasta 500 caracteres.");
  const pagoRef = db.doc(`pagos/${pagoId}`), decisionId = `${actor.rootId}__${pagoId}__${requestId}`, decisionRef = db.doc(`pagoSinSolicitudDecisions/${decisionId}`);
  return db.runTransaction(async tx => {
    const [pagoSnap, decisionSnap] = await Promise.all([tx.get(pagoRef), tx.get(decisionRef)]);
    const pago = pagoSnap.data();
    if (!pago || !canSeePago(actor, pago)) throw new HttpsError("permission-denied", "No autorizado para decidir sobre este pago.");
    const existing = decisionSnap.data();
    if (existing) {
      if (existing.pagoId === pagoId && existing.option === option && existing.note === note && existing.decidedBy === actor.uid) return { ok: true, reused: true, decisionId };
      throw new HttpsError("already-exists", "Esa solicitud de decisión ya se usó con otros datos.");
    }
    if (pago.unmatchedReview?.open !== true) throw new HttpsError("failed-precondition", "El pago ya no está en la lista de pagos sin solicitud.");
    const client = (await tx.get(db.doc(`clients/${clean(pago.clienteId)}`))).data();
    tx.create(decisionRef, {
      rootId: actor.rootId, pagoId, clienteId: clean(pago.clienteId), option, note, case: pago.unmatchedReview.case,
      decidedBy: actor.uid, decidedByName: actor.displayName, createdAt: FieldValue.serverTimestamp(),
      snapshot: { clienteNombre: clientName(client), monto: Number(pago.montoTotal) || 0, moneda: clean(pago.moneda) || "MXN", fecha: paymentDay(pago), folio: clean(pago.folio) || pagoId },
    });
    // The latest decision wins; earlier ones stay as history. A decision never moves money.
    tx.update(pagoRef, { "unmatchedReview.latestDecision": { id: decisionId, option, note, decidedBy: actor.uid, decidedByName: actor.displayName, decidedAt: FieldValue.serverTimestamp() },
      "unmatchedReview.updatedAt": FieldValue.serverTimestamp() });
    logActivityTx(tx, db, { event: "PAGO_SIN_SOLICITUD_DECISION", rootId: actor.rootId, adminId: actor.adminId, actorUid: actor.uid, actorName: actor.displayName, actorRole: actor.role,
      referenceId: pagoId, referenceFolio: clean(pago.folio) || pagoId, referenceType: "pago", entityId: decisionId, entityType: "pagoSinSolicitudDecision",
      amount: Number(pago.montoTotal) || 0, description: `Decisión ${option} para el pago ${clean(pago.folio) || pagoId} (caso ${pago.unmatchedReview.case}).` });
    return { ok: true, reused: false, decisionId };
  });
});
