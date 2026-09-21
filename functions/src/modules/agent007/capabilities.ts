import { FieldValue, Firestore } from "firebase-admin/firestore";
import { enqueueComplement } from "../paymentApplications/complementAutomation";
import { inspectIqComplementGate } from "../paymentApplications/complementGates";
import { logActivity } from "../../utils/logActivity";

const clean = (value: unknown, max = 180) =>
  String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, max);

export const HUGO_CAPABILITIES = {
  REQUEST_IQ_PAYMENT_COMPLEMENT: {
    mutatesExternalSystem: true,
    authorization: "EXPLICIT_SUPERADMIN_COMMAND",
    idempotency: "paymentComplementRequests.automationJobId",
    auditEvent: "COMPLEMENTO_PAGO_SEGUIMIENTO",
    retryPolicy: "NO_REPLAY_AFTER_SEND_OR_UNKNOWN",
  },
} as const;

export function requestedComplementAction(message: string): boolean {
  return (
    /\b(solicita|solicitar|solic[ií]talo|inicia|iniciar)\b[\s\S]{0,100}\b(complemento|rep)\b/i.test(
      message,
    ) ||
    /\b(complemento|rep)\b[\s\S]{0,100}\b(solicita|solicitar|solic[ií]talo|inicia|iniciar)\b/i.test(
      message,
    )
  );
}

function folioFrom(message: string): string | null {
  return message.toUpperCase().match(/\b[SP]\d[A-Z0-9]{4,19}\b/)?.[0] || null;
}

export async function executeRequestIqComplement(input: {
  db: Firestore;
  rootId: string;
  uid: string;
  message: string;
}) {
  const folio = folioFrom(input.message);
  const snapshot = await input.db
    .collection("paymentComplementRequests")
    .where("rootId", "==", input.rootId)
    .orderBy("createdAt", "desc")
    .limit(100)
    .get();
  const candidates = snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }) as any)
    .filter(
      (row) =>
        row.provider === "IQ" &&
        !["RECEIVED", "VOIDED"].includes(clean(row.status, 40).toUpperCase()),
    )
    .filter(
      (row) =>
        !folio ||
        [row.solicitudFolio, row.pagoFolio].some(
          (value) => clean(value, 80).toUpperCase() === folio,
        ),
    );
  if (!candidates.length)
    return {
      executed: false,
      reply: folio
        ? `No encontré un complemento IQ pendiente para ${folio}. No envié ninguna solicitud.`
        : "No encontré complementos IQ pendientes que pueda solicitar. No envié ninguna solicitud.",
    };
  if (candidates.length > 1)
    return {
      executed: false,
      reply: `Encontré ${candidates.length} complementos IQ pendientes. Indícame el folio de Solicitud o Pago para evitar solicitar el equivocado.`,
    };
  const source = candidates[0];
  const existingJob = source.automationJobId
    ? (
        await input.db
          .doc(`paymentComplementJobs/${source.automationJobId}`)
          .get()
      ).data()
    : null;
  if (
    ["REQUESTED", "ISSUED_PENDING_FILES", "RECEIVED"].includes(
      clean(existingJob?.status, 40).toUpperCase(),
    ) ||
    source.externalRequestSent === true
  ) {
    const when =
      existingJob?.requestedAt?.toDate?.()?.toLocaleString?.("es-MX") ||
      "fecha registrada en el seguimiento";
    return {
      executed: false,
      reply: `El complemento IQ de ${source.solicitudFolio || source.pagoFolio || source.applicationId} ya fue solicitado (${when}). Estado actual: ${existingJob?.status || source.automationStatus || source.status}. No dupliqué el envío.`,
    };
  }
  if (
    ["SENDING", "UNKNOWN", "REVIEW_REQUIRED"].includes(
      clean(existingJob?.status, 40).toUpperCase(),
    )
  ) {
    return {
      executed: false,
      reply: `No repetí la solicitud: el complemento está en ${existingJob?.status}. Ese estado requiere revisión para evitar duplicar un POST cuyo resultado podría ser incierto.`,
    };
  }
  await enqueueComplement(clean(source.applicationId));
  const refreshed = (
    await input.db.doc(`paymentComplementRequests/${source.id}`).get()
  ).data();
  const jobId = clean(refreshed?.automationJobId);
  const job = jobId
    ? (await input.db.doc(`paymentComplementJobs/${jobId}`).get()).data()
    : null;
  if (!jobId || !job)
    return {
      executed: false,
      reply: `No pude poner en cola el complemento de ${source.solicitudFolio || source.pagoFolio || source.applicationId}. La automatización IQ puede estar pausada o la aplicación aún no cumple las precondiciones.`,
    };
  const gate = await inspectIqComplementGate(job, "REQUEST");
  if (!gate.allowed) return {
    executed: false,
    reply: `Encontré el complemento de ${source.solicitudFolio || source.pagoFolio || source.applicationId}, pero no tengo autorización vigente para solicitarlo a IQ (${gate.reason}). La observación continúa; no envié un POST.`,
  };
  if (clean(job.status, 40).toUpperCase() === "BLOCKED")
    return {
      executed: false,
      reply: `El complemento no se envió. Quedó bloqueado antes del POST por ${clean(job.error || "una precondición pendiente", 160)}.`,
    };
  await input.db
    .doc(`paymentComplementRequests/${source.id}`)
    .set(
      {
        requestedThroughHugo: true,
        hugoRequestedBy: input.uid,
        hugoRequestedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  await logActivity({
    event: "COMPLEMENTO_PAGO_SEGUIMIENTO",
    rootId: input.rootId,
    actorUid: input.uid,
    actorRole: "superadmin",
    referenceId: source.id,
    referenceType: "paymentComplementRequest",
    relatedEntityId: source.pagoId,
    relatedEntityType: "pago",
    description: `Hugo ejecutó la capacidad REQUEST_IQ_PAYMENT_COMPLEMENT para ${source.solicitudFolio || source.pagoFolio || source.applicationId}.`,
    extra: {
      capability: "REQUEST_IQ_PAYMENT_COMPLEMENT",
      applicationId: source.applicationId,
      automationJobId: jobId,
      status: job.status,
    },
  });
  return {
    executed: true,
    reply: `Puse en cola la solicitud del complemento IQ de ${source.solicitudFolio || source.pagoFolio || source.applicationId}. Trabajo ${jobId.slice(0, 12)}…, estado ${job.status}. Cuando IQ confirme el POST aparecerá REQUESTED con requestedAt; después PAY0 lo revisará diariamente a las 19:00 y lo guardará en los documentos del pago.`,
  };
}
