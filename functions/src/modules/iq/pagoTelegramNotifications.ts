import * as admin from "firebase-admin";
import { sendTelegramMessage } from "../telegram/service";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

type AuthLike = {
  uid: string;
  role: string;
  rootId: string;
  user?: Record<string, unknown>;
};

export type IqPagoTelegramEventH4D64A6 =
  | "IQ_PAGO_CREADO"
  | "IQ_PAGO_CONCILIADO"
  | "IQ_PAGO_RECHAZADO"
  | "IQ_PAGO_CANCELADO"
  | "IQ_PAGO_NUEVO_COMPROBANTE"
  | "IQ_PAGO_MONTO_CORREGIDO";

function cleanText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function money(value: unknown): number {
  const parsed = Number(String(value ?? 0).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100) / 100;
}

function formatMoney(value: unknown): string {
  const amount = money(value);
  return amount.toLocaleString("es-MX", {
    style: "currency",
    currency: "MXN",
  });
}

function pagoFolio(pagoId: string, pago: Record<string, unknown>): string {
  return cleanText(
    pago.folio ??
    pago.referenceFolio ??
    pago.pagoFolio ??
    pago.folioPago ??
    pago.displayFolio ??
    pagoId
  ) || pagoId;
}

function pagoAmount(pago: Record<string, unknown>): number {
  return money(
    pago.montoTotal ??
    pago.total ??
    pago.amount ??
    pago.monto ??
    0
  );
}

function eventTitleH4D64A6(event: IqPagoTelegramEventH4D64A6): string {
  const titles: Record<IqPagoTelegramEventH4D64A6, string> = {
    IQ_PAGO_CREADO: "PAY0 / IQ pago creado",
    IQ_PAGO_CONCILIADO: "PAY0 / IQ pago conciliado",
    IQ_PAGO_RECHAZADO: "PAY0 / IQ pago rechazado",
    IQ_PAGO_CANCELADO: "PAY0 / IQ pago cancelado",
    IQ_PAGO_NUEVO_COMPROBANTE: "PAY0 / nuevo comprobante de pago",
    IQ_PAGO_MONTO_CORREGIDO: "PAY0 / monto de pago corregido",
  };

  return titles[event];
}

function eventDefaultMessageH4D64A6(event: IqPagoTelegramEventH4D64A6): string {
  const messages: Record<IqPagoTelegramEventH4D64A6, string> = {
    IQ_PAGO_CREADO: "El deposito/pago fue creado en IQ.",
    IQ_PAGO_CONCILIADO: "El deposito/pago ya quedo conciliado en IQ y PAY0.",
    IQ_PAGO_RECHAZADO: "El deposito fue rechazado. El seguimiento automatico quedo cerrado hasta recibir un nuevo comprobante.",
    IQ_PAGO_CANCELADO: "El deposito fue cancelado. El seguimiento automatico quedo cerrado hasta recibir un nuevo comprobante.",
    IQ_PAGO_NUEVO_COMPROBANTE: "Se recibio un nuevo comprobante. El folio terminal anterior queda como historico y se habilita un nuevo intento.",
    IQ_PAGO_MONTO_CORREGIDO: "El monto fue corregido de forma controlada antes de cargar el nuevo comprobante.",
  };

  return messages[event];
}

function notificationKeyH4D64A6(value: unknown): string {
  return cleanText(value || "sin_clave")
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .slice(0, 120) || "sin_clave";
}


export function buildIqPagoTelegramPreviewH4D64A7(input: {
  auth: AuthLike;
  event: IqPagoTelegramEventH4D64A6;
  pagoId: string;
  pago: Record<string, unknown>;
  iqId: string | null;
  source: string;
  message?: string;
  dedupeKey?: string;
}) {
  const rootId = cleanText(input.auth.rootId);
  const pagoId = cleanText(input.pagoId);
  const iqId = cleanText(input.iqId) || "sin_folio";
  const dedupeKey = notificationKeyH4D64A6(input.dedupeKey || iqId);
  const notificationId = `H4D64A6_${input.event}_${pagoId}_${dedupeKey}`;
  const folio = pagoFolio(pagoId, input.pago);
  const cliente = cleanText(input.pago.clienteNombre ?? input.pago.clientName);
  const empresa = cleanText(input.pago.empresaNombre ?? input.pago.companyName);
  const actorName = cleanText(
    input.auth.user?.username ??
    input.auth.user?.name ??
    input.auth.uid
  );
  const title = eventTitleH4D64A6(input.event);
  const text = [
    title,
    "",
    `Pago PAY0: ${folio}`,
    `FOLIO IQ: ${cleanText(input.iqId) || "no identificado"}`,
    `Monto: ${formatMoney(pagoAmount(input.pago))}`,
    cliente ? `Cliente: ${cliente}` : "",
    empresa ? `Empresa: ${empresa}` : "",
    actorName ? `Usuario: ${actorName}` : "",
    input.source ? `Origen: ${input.source}` : "",
    "",
    input.message || eventDefaultMessageH4D64A6(input.event),
  ].filter(Boolean).join("\n").slice(0, 3900);

  return { rootId, pagoId, iqId, dedupeKey, notificationId, folio, title, text };
}
// H4_D64_A7_TELEGRAM_PREVIEW

export async function notifyIqPagoTelegramH4D59B(input: {
  botToken: string;
  auth: AuthLike;
  event: IqPagoTelegramEventH4D64A6;
  pagoId: string;
  pago: Record<string, unknown>;
  iqId: string | null;
  source: string;
  message?: string;
  dedupeKey?: string;
}): Promise<void> {
  const preview = buildIqPagoTelegramPreviewH4D64A7(input);
  const { rootId, pagoId, dedupeKey, notificationId, folio, title, text } = preview;

  if (!rootId || !pagoId) return;

  const notificationRef = db.collection("iqIntegrationNotifications").doc(notificationId);
  const existing = await notificationRef.get().catch(() => null);

  if (existing?.exists && cleanText(existing.data()?.telegramStatus) === "SENT") {
    return;
  }

  await notificationRef.set(
    {
      rootId,
      audienceRole: "superadmin",
      event: input.event,
      module: "iq",
      status: "READY",
      pagoId,
      pagoFolio: folio,
      iqId: cleanText(input.iqId) || null,
      dedupeKey,
      source: input.source,
      title,
      message: text,
      channels: ["in_app", "telegram"],
      inAppStatus: "READY",
      telegramStatus: "PENDING",
      read: false,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  try {
    const targetUids = Array.from(new Set([
      rootId,
      cleanText(input.auth.uid),
    ].filter(Boolean)));

    const chatIds = new Set<string>();

    for (const uid of targetUids) {
      const linkedSnap = await db
        .collection("telegramUsers")
        .where("uid", "==", uid)
        .where("active", "==", true)
        .limit(10)
        .get();

      linkedSnap.docs.forEach((doc) => {
        const chatId = cleanText(doc.data()?.chatId);
        if (chatId) chatIds.add(chatId);
      });
    }

    let sentCount = 0;

    for (const chatId of Array.from(chatIds)) {
      await sendTelegramMessage(input.botToken, chatId, text);
      sentCount += 1;
    }

    await notificationRef.set(
      {
        telegramStatus: sentCount > 0 ? "SENT" : "SKIPPED_NO_CHAT",
        telegramSentCount: sentCount,
        telegramSentAt: sentCount > 0 ? FieldValue.serverTimestamp() : null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  } catch (error: any) {
    await notificationRef.set(
      {
        telegramStatus: "ERROR",
        telegramError: cleanText(error?.message || error),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    ).catch(() => undefined);
  }
}
