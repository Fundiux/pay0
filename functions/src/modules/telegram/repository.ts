import * as admin from "firebase-admin";
import { logActivity, logActivityBatch, logActivityTx } from "../../utils/logActivity";
import * as crypto from "crypto";
import { readCanonicalBalanceSummary } from "../ledger/service";
import {
  LinkedTelegramUser,
  LinkedClientTelegramUser,
  ClientTelegramLinkToken,
  TelegramBalanceSummary,
  TelegramContext,
  TelegramLinkToken,
  TelegramNotificationPrefs,
  TelegramUpdate,
} from "./types";

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;

function generateToken(): string {
  return crypto
    .randomBytes(24)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function normalizeUsername(value: any): string {
  return String(value || "").trim();
}

function money(value: any): number {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

export async function saveTelegramUpdate(
  update: TelegramUpdate,
  meta: Record<string, any>
): Promise<{ id: string; duplicate: boolean }> {
  const updateId = update.update_id === undefined || update.update_id === null
    ? db.collection("telegramUpdates").doc().id
    : String(update.update_id);

  const ref = db.collection("telegramUpdates").doc(updateId);
  const snap = await ref.get();

  await ref.set(
    {
      updateId,
      source: "telegram",
      rawUpdate: update,
      meta,
      duplicate: snap.exists,
      receivedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return { id: updateId, duplicate: snap.exists };
}

export async function markTelegramUpdateHandled(
  updateId: string,
  patch: Record<string, any>
): Promise<void> {
  if (!updateId) return;

  await db.collection("telegramUpdates").doc(updateId).set(
    {
      ...patch,
      handledAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

export async function getLinkedTelegramUser(
  telegramUserId: string
): Promise<LinkedTelegramUser | null> {
  if (!telegramUserId) return null;

  const snap = await db.collection("telegramUsers").doc(telegramUserId).get();
  if (!snap.exists) return null;

  const data = snap.data() || {};
  if (data.active === false) return null;

  return data as LinkedTelegramUser;
}
export async function getPublicAccessStatus(): Promise<{
  enabled: boolean;
  reason: string;
  updatedAtText: string;
}> {
  const snap = await db.doc("system/publicAccess").get();
  const data = snap.exists ? (snap.data() || {}) : {};

  const enabled = data.enabled !== false;
  const reason = String(data.reason || (enabled ? "Sistema activo" : "Sistema en mantenimiento"));

  let updatedAtText = "";
  const updatedAt: any = data.updatedAt;
  if (updatedAt?.toDate) {
    updatedAtText = updatedAt.toDate().toISOString();
  }

  return { enabled, reason, updatedAtText };
}

export async function getLinkedTelegramUserByUid(
  uid: string
): Promise<LinkedTelegramUser | null> {
  if (!uid) return null;

  const snap = await db
    .collection("telegramUsers")
    .where("uid", "==", uid)
    .where("active", "==", true)
    .limit(1)
    .get();

  if (snap.empty) return null;

  return snap.docs[0].data() as LinkedTelegramUser;
}

export async function createTelegramLinkTokenForUid(
  uid: string
): Promise<{ token: string; startUrl: string; expiresAt: string }> {
  if (!uid) {
    throw new Error("uid requerido.");
  }

  const userSnap = await db.collection("users").doc(uid).get();
  if (!userSnap.exists) {
    throw new Error("Usuario PAY0 no encontrado.");
  }

  const user = userSnap.data() || {};
  const token = generateToken();
  const expiresDate = new Date(Date.now() + 15 * 60 * 1000);
  const expiresAt = Timestamp.fromDate(expiresDate);

  await db.collection("telegramLinkTokens").doc(token).set({
    token,
    uid,
    rootId: String(user.rootId || uid),
    role: String(user.role || ""),
    username: normalizeUsername(user.username || user.displayName || user.name || user.email),
    displayName: normalizeUsername(user.displayName || user.name || user.username),
    status: "PENDING",
    expiresAt,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return {
    token,
    startUrl: `https://t.me/Ebasorbot?start=${token}`,
    expiresAt: expiresDate.toISOString(),
  };
}

export async function getTelegramLinkStatusForUid(uid: string): Promise<{
  linked: boolean;
  telegramUserId: string;
  telegramUsername: string;
  role: string;
  rootId: string;
}> {
  const linked = await getLinkedTelegramUserByUid(uid);

  return {
    linked: Boolean(linked?.uid),
    telegramUserId: String((linked as any)?.telegramUserId || ""),
    telegramUsername: String(linked?.telegramUsername || ""),
    role: String(linked?.role || ""),
    rootId: String(linked?.rootId || ""),
  };
}

export async function unlinkTelegramAccountForUid(uid: string): Promise<{
  unlinked: boolean;
  count: number;
}> {
  if (!uid) {
    throw new Error("uid requerido.");
  }

  const userSnap = await db.collection("users").doc(uid).get();
  const user = userSnap.exists ? (userSnap.data() || {}) : {};

  const snap = await db
    .collection("telegramUsers")
    .where("uid", "==", uid)
    .where("active", "==", true)
    .limit(20)
    .get();

  if (snap.empty) {
    return { unlinked: false, count: 0 };
  }

  const batch = db.batch();

  snap.docs.forEach((doc) => {
    batch.set(
      doc.ref,
      {
        active: false,
        unlinkedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });

  const rootId = String(user.rootId || uid);
  const role = String(user.role || "");
  const actorUsername = String(user.username || user.displayName || user.name || uid).trim();

    logActivityBatch(batch, db, {
    event: "TELEGRAM_CUENTA_DESVINCULADA",
    rootId,
    actorUid: uid,
    actorName: actorUsername,
    actorUsername,
    actorRole: role,
    entityType: "USER",
    entityId: uid,
    referenceId: uid,
    referenceType: "telegramUser",
    description: "Cuenta Telegram desvinculada",
    createdBy: uid,
    extra: {
      source: "telegram",
      uid,
      role,
      username: actorUsername,
      count: snap.size,
      message: "Cuenta Telegram desvinculada",
    },
  });

  await batch.commit();

  return { unlinked: true, count: snap.size };
}

export async function consumeTelegramLinkToken(
  token: string,
  ctx: TelegramContext
): Promise<{ ok: boolean; reason?: string; linkedUser?: LinkedTelegramUser }> {
  const cleanToken = String(token || "").trim();

  if (!cleanToken) {
    return { ok: false, reason: "token_empty" };
  }

  const tokenRef = db.collection("telegramLinkTokens").doc(cleanToken);

  return await db.runTransaction(async (tx) => {
    const tokenSnap = await tx.get(tokenRef);

    if (!tokenSnap.exists) {
      return { ok: false, reason: "token_not_found" };
    }

    const tokenData = tokenSnap.data() as TelegramLinkToken;
    const status = String(tokenData.status || "");

    if (status !== "PENDING") {
      return { ok: false, reason: "token_not_pending" };
    }

    const expiresAt: any = tokenData.expiresAt;
    const expiresMillis =
      expiresAt && typeof expiresAt.toMillis === "function"
        ? expiresAt.toMillis()
        : 0;

    if (!expiresMillis || expiresMillis < Date.now()) {
      tx.set(
        tokenRef,
        {
          status: "EXPIRED",
          expiredAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      return { ok: false, reason: "token_expired" };
    }

    const uid = String(tokenData.uid || "");
    if (!uid) {
      return { ok: false, reason: "token_missing_uid" };
    }

    const telegramRef = db.collection("telegramUsers").doc(ctx.telegramUserId);
    const linkedUser: LinkedTelegramUser = {
      uid,
      rootId: String(tokenData.rootId || uid),
      role: String(tokenData.role || ""),
      active: true,
      username: String(tokenData.username || ""),
      displayName: String(tokenData.displayName || ""),
      telegramUsername: ctx.username,
      telegramUserId: ctx.telegramUserId,
    };

    tx.set(
      telegramRef,
      {
        ...linkedUser,
        telegramUserId: ctx.telegramUserId,
        chatId: ctx.chatId,
        firstName: ctx.firstName,
        lastName: ctx.lastName,
        linkedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    tx.set(
      tokenRef,
      {
        status: "LINKED",
        telegramUserId: ctx.telegramUserId,
        telegramUsername: ctx.username,
        linkedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

        logActivityTx(tx, db, {
      event: "TELEGRAM_CUENTA_VINCULADA",
      rootId: String(linkedUser.rootId || uid),
      actorUid: uid,
      actorName: linkedUser.username || linkedUser.displayName || "Sistema",
      actorUsername: linkedUser.username || linkedUser.displayName || "Sistema",
      actorRole: linkedUser.role,
      entityType: "USER",
      entityId: uid,
      referenceId: uid,
      referenceType: "telegramUser",
      description: "Cuenta Telegram vinculada",
      createdBy: uid,
      extra: {
        source: "telegram",
        uid,
        role: linkedUser.role,
        username: linkedUser.username || linkedUser.displayName || "",
        telegramUserId: ctx.telegramUserId,
        telegramUsername: ctx.username,
        message: "Cuenta Telegram vinculada",
      },
    });

    return { ok: true, linkedUser };
  });
}

export async function getUserBalanceForLinkedTelegramUser(
  linkedUser: LinkedTelegramUser
): Promise<TelegramBalanceSummary> {
  const uid = String(linkedUser.uid || "").trim();
  if (!uid) {
    throw new Error("Usuario Telegram no vinculado.");
  }

  const summary = await readCanonicalBalanceSummary(db, "USER", uid);

  if (!summary.rootId) {
    return {
      found: false,
      holderType: "USER",
      holderId: uid,
      holderName: String(linkedUser.username || linkedUser.displayName || uid),
      availableBalance: 0,
      totalGenerated: 0,
      totalSpent: 0,
      totalAdjusted: 0,
      totalReturned: 0,
    };
  }

  const accountRootId = String(summary.rootId || "");
  const linkedRootId = String(linkedUser.rootId || "");

  if (accountRootId && linkedRootId && accountRootId !== linkedRootId) {
    throw new Error("Scope de saldo invalido.");
  }

  return {
    found: true,
    holderType: "USER",
    holderId: uid,
    holderName: String(summary.holderName || linkedUser.username || linkedUser.displayName || uid),
    availableBalance: summary.availableBalance,
    totalGenerated: summary.totalGenerated,
    totalSpent: summary.totalSpent,
    totalAdjusted: summary.totalAdjusted,
    totalReturned: summary.totalReturned,
  };
}
function defaultTelegramPrefs(uid: string): TelegramNotificationPrefs {
  return {
    uid,
    enabled: true,
    notifySaldo: true,
    notifyPagos: false,
    notifySolicitudes: false,
    notifyDispersiones: false,
  };
}

export async function getTelegramNotificationPrefsForUid(
  uid: string
): Promise<TelegramNotificationPrefs> {
  if (!uid) {
    throw new Error("uid requerido.");
  }

  const ref = db.collection("telegramNotificationPrefs").doc(uid);
  const snap = await ref.get();

  if (!snap.exists) {
    const prefs = defaultTelegramPrefs(uid);

    await ref.set({
      ...prefs,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return prefs;
  }

  const data = snap.data() || {};
  const defaults = defaultTelegramPrefs(uid);

  return {
    uid,
    enabled: typeof data.enabled === "boolean" ? data.enabled : defaults.enabled,
    notifySaldo: typeof data.notifySaldo === "boolean" ? data.notifySaldo : defaults.notifySaldo,
    notifyPagos: typeof data.notifyPagos === "boolean" ? data.notifyPagos : defaults.notifyPagos,
    notifySolicitudes: typeof data.notifySolicitudes === "boolean" ? data.notifySolicitudes : defaults.notifySolicitudes,
    notifyDispersiones: typeof data.notifyDispersiones === "boolean" ? data.notifyDispersiones : defaults.notifyDispersiones,
  };
}

export async function updateTelegramNotificationPrefsForUid(
  uid: string,
  input: Partial<TelegramNotificationPrefs>
): Promise<TelegramNotificationPrefs> {
  if (!uid) {
    throw new Error("uid requerido.");
  }

  const current = await getTelegramNotificationPrefsForUid(uid);

  const next: TelegramNotificationPrefs = {
    uid,
    enabled: typeof input.enabled === "boolean" ? input.enabled : current.enabled,
    notifySaldo: typeof input.notifySaldo === "boolean" ? input.notifySaldo : current.notifySaldo,
    notifyPagos: typeof input.notifyPagos === "boolean" ? input.notifyPagos : current.notifyPagos,
    notifySolicitudes: typeof input.notifySolicitudes === "boolean" ? input.notifySolicitudes : current.notifySolicitudes,
    notifyDispersiones: typeof input.notifyDispersiones === "boolean" ? input.notifyDispersiones : current.notifyDispersiones,
  };

  await db.collection("telegramNotificationPrefs").doc(uid).set(
    {
      ...next,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return next;
}


export type TelegramSolicitudDocumentSummary = {
  id: string;
  solicitudId: string;
  rootId: string;
  type: string;
  status: string;
  storagePath: string;
  fileName: string;
  createdAtMillis: number;
};

function docString(value: any): string {
  return String(value || "").trim();
}

function docCreatedMillis(value: any): number {
  if (value && typeof value.toMillis === "function") return Number(value.toMillis() || 0);
  if (value && typeof value.toDate === "function") return Number(value.toDate().getTime() || 0);
  return 0;
}

export async function getLatestSolicitudDocumentForTelegram(
  rootId: string
): Promise<TelegramSolicitudDocumentSummary | null> {
  const cleanRootId = docString(rootId);

  if (!cleanRootId) {
    throw new Error("rootId requerido.");
  }

  const snap = await db
    .collection("uploads")
    .where("rootId", "==", cleanRootId)
    .limit(200)
    .get();

  const rows: TelegramSolicitudDocumentSummary[] = [];

  snap.forEach((doc) => {
    const data = doc.data() || {};
    const storagePath = docString(data.storagePath);
    const status = docString(data.status || "").toUpperCase();
    const active = data.active === true;

    if (!storagePath) return;
    if (!active) return;
    if (["DELETED", "ELIMINADA", "INACTIVE", "INACTIVO"].includes(status)) return;

    rows.push({
      id: doc.id,
      solicitudId: docString(data.solicitudId || data.entityId || ""),
      rootId: docString(data.rootId || cleanRootId),
      type: docString(data.documentType || data.type || "DOCUMENTO"),
      status,
      storagePath,
      fileName: docString(data.originalName || data.filename || data.fileName || "documento"),
      createdAtMillis: docCreatedMillis(data.finalizedAt || data.createdAt || data.updatedAt),
    });
  });

  rows.sort((a, b) => b.createdAtMillis - a.createdAtMillis);

  return rows[0] || null;
}
export type TelegramPdfUploadSummary = {
  id: string;
  solicitudId: string;
  solicitudFolio: string;
  rootId: string;
  documentType: string;
  storagePath: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  createdAtMillis: number;
};

function pdfText(value: any): string {
  return String(value || "").trim();
}

function pdfNum(value: any): number {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function pdfMillis(value: any): number {
  if (value && typeof value.toMillis === "function") return Number(value.toMillis() || 0);
  if (value && typeof value.toDate === "function") return Number(value.toDate().getTime() || 0);
  return 0;
}

async function getSolicitudFolioForTelegram(solicitudId: string): Promise<string> {
  const cleanSolicitudId = pdfText(solicitudId);
  if (!cleanSolicitudId) return "";

  const snap = await db.collection("solicitudes").doc(cleanSolicitudId).get();

  if (!snap.exists) return cleanSolicitudId;

  const data = snap.data() || {};

  return pdfText(
    data.folio ||
    data.folioSolicitud ||
    data.requestFolio ||
    data.sequenceDisplay ||
    data.solicitudFolio ||
    cleanSolicitudId
  );
}

export async function getLatestPdfUploadForTelegram(
  rootId: string
): Promise<TelegramPdfUploadSummary | null> {
  const cleanRootId = pdfText(rootId);

  if (!cleanRootId) {
    throw new Error("rootId requerido.");
  }

  const snap = await db
    .collection("uploads")
    .where("rootId", "==", cleanRootId)
    .limit(400)
    .get();

  const rows: TelegramPdfUploadSummary[] = [];

  for (const doc of snap.docs) {
    const data = doc.data() || {};
    const active = data.active === true;
    const status = pdfText(data.status).toUpperCase();
    const documentType = pdfText(data.documentType || data.type).toUpperCase();
    const storagePath = pdfText(data.storagePath);
    const fileName = pdfText(data.originalName || data.filename || data.fileName || "documento.pdf");
    const contentType = pdfText(data.contentType || "application/pdf");
    const isPdf =
      documentType === "FACTURA_PDF" ||
      contentType.toLowerCase().includes("pdf") ||
      fileName.toLowerCase().endsWith(".pdf");

    if (!active) continue;
    if (!storagePath) continue;
    if (!isPdf) continue;
    if (["DELETED", "ELIMINADA", "INACTIVE", "INACTIVO"].includes(status)) continue;

    const solicitudId = pdfText(data.solicitudId || data.entityId || "");

    rows.push({
      id: doc.id,
      solicitudId,
      solicitudFolio: await getSolicitudFolioForTelegram(solicitudId),
      rootId: pdfText(data.rootId || cleanRootId),
      documentType: documentType || "PDF",
      storagePath,
      fileName,
      contentType,
      sizeBytes: pdfNum(data.sizeBytes),
      createdAtMillis: pdfMillis(data.finalizedAt || data.createdAt || data.updatedAt),
    });
  }

  rows.sort((a, b) => b.createdAtMillis - a.createdAtMillis);

  return rows[0] || null;
}
export type TelegramFacturaDirectFile = {
  documentId: string;
  storagePath: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
};

export type TelegramFacturaDirectSummary = {
  solicitudId: string;
  solicitudFolio: string;
  rootId: string;
  clientName: string;
  companyName: string;
  totalAmount: number;
  pdf: TelegramFacturaDirectFile | null;
  xml: TelegramFacturaDirectFile | null;
  createdAtMillis: number;
};

function facturaText(value: any): string {
  return String(value || "").trim();
}

function facturaNum(value: any): number {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function facturaMillis(value: any): number {
  if (value && typeof value.toMillis === "function") return Number(value.toMillis() || 0);
  if (value && typeof value.toDate === "function") return Number(value.toDate().getTime() || 0);
  return 0;
}

async function getSolicitudFacturaMetaForTelegram(solicitudId: string): Promise<{
  folio: string;
  clientName: string;
  companyName: string;
  totalAmount: number;
}> {
  const cleanSolicitudId = facturaText(solicitudId);

  if (!cleanSolicitudId) {
    return {
      folio: "",
      clientName: "Cliente",
      companyName: "Empresa",
      totalAmount: 0,
    };
  }

  const snap = await db.collection("solicitudes").doc(cleanSolicitudId).get();

  if (!snap.exists) {
    return {
      folio: cleanSolicitudId,
      clientName: "Cliente",
      companyName: "Empresa",
      totalAmount: 0,
    };
  }

  const data = snap.data() || {};

  return {
    folio: facturaText(
      data.folio ||
      data.folioSolicitud ||
      data.solicitudFolio ||
      data.sequenceDisplay ||
      data.requestFolio ||
      cleanSolicitudId
    ),
    clientName: facturaText(
      data.clienteNombre ||
      data.clientName ||
      data.clientDisplayName ||
      data.clientLabel ||
      "Cliente"
    ),
    companyName: facturaText(
      data.empresaNombre ||
      data.companyName ||
      data.companyDisplayName ||
      data.companyLabel ||
      "Empresa"
    ),
    totalAmount: facturaNum(
      data.total ??
      data.totalAmount ??
      data.monto ??
      data.montoTotal ??
      data.amount ??
      data.importeTotal ??
      0
    ),
  };
}

export async function getLatestFacturaDirectForTelegram(
  rootId: string
): Promise<TelegramFacturaDirectSummary | null> {
  const cleanRootId = facturaText(rootId);

  if (!cleanRootId) {
    throw new Error("rootId requerido.");
  }

  const snap = await db
    .collection("uploads")
    .where("rootId", "==", cleanRootId)
    .limit(500)
    .get();

  const grouped = new Map<string, {
    solicitudId: string;
    rootId: string;
    pdf: TelegramFacturaDirectFile | null;
    xml: TelegramFacturaDirectFile | null;
    createdAtMillis: number;
  }>();

  snap.forEach((doc) => {
    const data = doc.data() || {};
    const active = data.active === true;
    const status = facturaText(data.status).toUpperCase();
    const documentType = facturaText(data.documentType || data.type).toUpperCase();
    const storagePath = facturaText(data.storagePath);
    const solicitudId = facturaText(data.solicitudId || data.entityId || "");
    const fileName = facturaText(data.originalName || data.filename || data.fileName || "documento");
    const contentType = facturaText(data.contentType || "");
    const sizeBytes = facturaNum(data.sizeBytes);
    const createdAtMillis = facturaMillis(data.finalizedAt || data.createdAt || data.updatedAt);

    if (!active) return;
    if (!storagePath) return;
    if (!solicitudId) return;
    if (["DELETED", "ELIMINADA", "INACTIVE", "INACTIVO"].includes(status)) return;
    if (documentType !== "FACTURA_PDF" && documentType !== "FACTURA_XML") return;

    const current = grouped.get(solicitudId) || {
      solicitudId,
      rootId: cleanRootId,
      pdf: null,
      xml: null,
      createdAtMillis: 0,
    };

    const item = {
      documentId: doc.id,
      storagePath,
      fileName,
      contentType:
        contentType ||
        (documentType === "FACTURA_XML" ? "application/xml" : "application/pdf"),
      sizeBytes,
    };

    if (documentType === "FACTURA_PDF") {
      current.pdf = item;
    }

    if (documentType === "FACTURA_XML") {
      current.xml = item;
    }

    current.createdAtMillis = Math.max(current.createdAtMillis, createdAtMillis);
    grouped.set(solicitudId, current);
  });

  const rows: TelegramFacturaDirectSummary[] = [];

  for (const row of grouped.values()) {
    const meta = await getSolicitudFacturaMetaForTelegram(row.solicitudId);

    rows.push({
      solicitudId: row.solicitudId,
      solicitudFolio: meta.folio || row.solicitudId,
      rootId: row.rootId,
      clientName: meta.clientName || "Cliente",
      companyName: meta.companyName || "Empresa",
      totalAmount: meta.totalAmount,
      pdf: row.pdf,
      xml: row.xml,
      createdAtMillis: row.createdAtMillis,
    });
  }

  rows.sort((a, b) => b.createdAtMillis - a.createdAtMillis);

  return rows[0] || null;
}
function clientClean(value: any): string {
  return String(value || "").trim();
}

function clientToken(): string {
  return crypto
    .randomBytes(24)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function getUserForClientTelegram(uid: string): Promise<any> {
  const snap = await db.collection("users").doc(uid).get();
  if (!snap.exists) {
    throw new Error("Usuario PAY0 no encontrado.");
  }
  return snap.data() || {};
}

function canCreateClientTelegramLink(user: any, uid: string, client: any): boolean {
  const role = clientClean(user.role).toLowerCase();
  const userRootId = clientClean(user.rootId || uid);
  const clientRootId = clientClean(client.rootId || userRootId);

  if (role === "superadmin") return true;
  if (role === "admin") return clientRootId === userRootId;
  return false;
}

export async function getLinkedClientTelegramUser(
  telegramUserId: string
): Promise<LinkedClientTelegramUser | null> {
  const cleanTelegramUserId = clientClean(telegramUserId);
  if (!cleanTelegramUserId) return null;

  const snap = await db.collection("clientTelegramUsers").doc(cleanTelegramUserId).get();
  if (!snap.exists) return null;

  const data = snap.data() || {};
  if (data.active === false) return null;

  return data as LinkedClientTelegramUser;
}

export async function getClientTelegramLinkStatusForClient(
  uid: string,
  clientId: string
): Promise<{
  linked: boolean;
  telegramUserId: string;
  telegramUsername: string;
  clientId: string;
  clientName: string;
}> {
  const cleanUid = clientClean(uid);
  const cleanClientId = clientClean(clientId);

  if (!cleanUid || !cleanClientId) {
    throw new Error("uid/clientId requerido.");
  }

  const user = await getUserForClientTelegram(cleanUid);
  const clientSnap = await db.collection("clients").doc(cleanClientId).get();

  if (!clientSnap.exists) {
    throw new Error("Cliente no encontrado.");
  }

  const client = clientSnap.data() || {};

  if (!canCreateClientTelegramLink(user, cleanUid, client)) {
    throw new Error("No autorizado.");
  }

  const snap = await db
    .collection("clientTelegramUsers")
    .where("clientId", "==", cleanClientId)
    .where("active", "==", true)
    .limit(1)
    .get();

  if (snap.empty) {
    return {
      linked: false,
      telegramUserId: "",
      telegramUsername: "",
      clientId: cleanClientId,
      clientName: clientClean(client.name || client.nombre || client.razonSocial || client.clientName || ""),
    };
  }

  const data = snap.docs[0].data() || {};

  return {
    linked: true,
    telegramUserId: clientClean(data.telegramUserId || snap.docs[0].id),
    telegramUsername: clientClean(data.telegramUsername || ""),
    clientId: cleanClientId,
    clientName: clientClean(data.clientName || client.name || client.nombre || client.razonSocial || ""),
  };
}

export async function createClientTelegramLinkTokenForClient(
  uid: string,
  clientId: string
): Promise<{ token: string; startUrl: string; expiresAt: string; clientName: string }> {
  const cleanUid = clientClean(uid);
  const cleanClientId = clientClean(clientId);

  if (!cleanUid || !cleanClientId) {
    throw new Error("uid/clientId requerido.");
  }

  const user = await getUserForClientTelegram(cleanUid);
  const clientSnap = await db.collection("clients").doc(cleanClientId).get();

  if (!clientSnap.exists) {
    throw new Error("Cliente no encontrado.");
  }

  const client = clientSnap.data() || {};

  if (!canCreateClientTelegramLink(user, cleanUid, client)) {
    throw new Error("No autorizado.");
  }

  const rootId = clientClean(client.rootId || user.rootId || cleanUid);
  const clientName = clientClean(client.name || client.nombre || client.razonSocial || client.clientName || cleanClientId);
  const token = clientToken();
  const expiresDate = new Date(Date.now() + 15 * 60 * 1000);

  await db.collection("clientTelegramLinkTokens").doc(token).set({
    token,
    clientId: cleanClientId,
    rootId,
    clientName,
    status: "PENDING",
    expiresAt: Timestamp.fromDate(expiresDate),
    createdByUid: cleanUid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return {
    token,
    startUrl: `https://t.me/Ebasorbot?start=${token}`,
    expiresAt: expiresDate.toISOString(),
    clientName,
  };
}

export async function consumeClientTelegramLinkToken(
  token: string,
  ctx: TelegramContext
): Promise<{ ok: boolean; reason?: string; linkedClient?: LinkedClientTelegramUser }> {
  const cleanToken = clientClean(token);

  if (!cleanToken) {
    return { ok: false, reason: "token_empty" };
  }

  const tokenRef = db.collection("clientTelegramLinkTokens").doc(cleanToken);

  return await db.runTransaction(async (tx) => {
    const tokenSnap = await tx.get(tokenRef);

    if (!tokenSnap.exists) {
      return { ok: false, reason: "token_not_found" };
    }

    const tokenData = tokenSnap.data() as ClientTelegramLinkToken;
    const status = clientClean(tokenData.status);

    if (status !== "PENDING") {
      return { ok: false, reason: "token_not_pending" };
    }

    const expiresAt: any = tokenData.expiresAt;
    const expiresMillis =
      expiresAt && typeof expiresAt.toMillis === "function"
        ? expiresAt.toMillis()
        : 0;

    if (!expiresMillis || expiresMillis < Date.now()) {
      tx.set(
        tokenRef,
        {
          status: "EXPIRED",
          expiredAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      return { ok: false, reason: "token_expired" };
    }

    const clientId = clientClean(tokenData.clientId);
    const rootId = clientClean(tokenData.rootId);
    const clientName = clientClean(tokenData.clientName || clientId);

    if (!clientId || !rootId) {
      return { ok: false, reason: "token_missing_client" };
    }

    const telegramRef = db.collection("clientTelegramUsers").doc(ctx.telegramUserId);

    const linkedClient: LinkedClientTelegramUser = {
      clientId,
      rootId,
      clientName,
      active: true,
      telegramUsername: ctx.username,
      telegramUserId: ctx.telegramUserId,
      chatId: ctx.chatId,
    };

    tx.set(
      telegramRef,
      {
        ...linkedClient,
        firstName: ctx.firstName,
        lastName: ctx.lastName,
        linkedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    tx.set(
      tokenRef,
      {
        status: "LINKED",
        telegramUserId: ctx.telegramUserId,
        telegramUsername: ctx.username,
        linkedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

        logActivityTx(tx, db, {
      event: "CLIENTE_TELEGRAM_VINCULADO",
      rootId,
      actorUid: "telegram-client",
      actorName: ctx.username || clientName || "Cliente Telegram",
      actorUsername: ctx.username || clientName || "Cliente Telegram",
      actorRole: "client",
      entityType: "CLIENT",
      entityId: clientId,
      referenceId: clientId,
      referenceFolio: clientName || clientId,
      referenceType: "clientTelegramUser",
      description: "Cliente vinculado a Telegram",
      createdBy: "telegram-client",
      extra: {
        source: "telegram",
        clientId,
        clienteId: clientId,
        clientName,
        clienteNombre: clientName,
        telegramUserId: ctx.telegramUserId,
        telegramUsername: ctx.username,
        message: "Cliente vinculado a Telegram",
      },
    });

    return { ok: true, linkedClient };
  });
}

export async function unlinkClientTelegramAccountForClient(
  uid: string,
  clientId: string
): Promise<{ unlinked: boolean; count: number }> {
  const cleanUid = clientClean(uid);
  const cleanClientId = clientClean(clientId);

  if (!cleanUid || !cleanClientId) {
    throw new Error("uid/clientId requerido.");
  }

  const user = await getUserForClientTelegram(cleanUid);
  const clientSnap = await db.collection("clients").doc(cleanClientId).get();

  if (!clientSnap.exists) {
    throw new Error("Cliente no encontrado.");
  }

  const client = clientSnap.data() || {};

  if (!canCreateClientTelegramLink(user, cleanUid, client)) {
    throw new Error("No autorizado.");
  }

  const snap = await db
    .collection("clientTelegramUsers")
    .where("clientId", "==", cleanClientId)
    .where("active", "==", true)
    .limit(20)
    .get();

  if (snap.empty) {
    return { unlinked: false, count: 0 };
  }

  const batch = db.batch();

  snap.docs.forEach((doc) => {
    batch.set(
      doc.ref,
      {
        active: false,
        unlinkedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });

    logActivityBatch(batch, db, {
    event: "CLIENTE_TELEGRAM_DESVINCULADO",
    rootId: clientClean(client.rootId || user.rootId || cleanUid),
    actorUid: cleanUid,
    actorName: clientClean((user as any)?.username || (user as any)?.displayName || (user as any)?.name || cleanUid),
    actorUsername: clientClean((user as any)?.username || (user as any)?.displayName || (user as any)?.name || cleanUid),
    actorRole: clientClean((user as any)?.role || (user as any)?.supervisorRole || ""),
    entityType: "CLIENT",
    entityId: cleanClientId,
    referenceId: cleanClientId,
    referenceFolio: clientClean(client.name || client.nombre || client.razonSocial || cleanClientId),
    referenceType: "clientTelegramUser",
    description: "Cliente desvinculado de Telegram",
    createdBy: cleanUid,
    extra: {
      source: "telegram",
      clientId: cleanClientId,
      clienteId: cleanClientId,
      clientName: clientClean(client.name || client.nombre || client.razonSocial || cleanClientId),
      clienteNombre: clientClean(client.name || client.nombre || client.razonSocial || cleanClientId),
      count: snap.size,
      message: "Cliente desvinculado de Telegram",
    },
  });

  await batch.commit();

  return { unlinked: true, count: snap.size };
}
export type TelegramClientFacturaFile = {
  uploadId: string;
  storagePath: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
};

export type TelegramClientFacturaDelivery = {
  solicitudId: string;
  solicitudFolio: string;
  rootId: string;
  clientId: string;
  clientName: string;
  companyName: string;
  totalAmount: number;
  pdf: TelegramClientFacturaFile;
  xml: TelegramClientFacturaFile;
  createdAtMillis: number;
};

export type TelegramClientRecipient = {
  telegramUserId: string;
  chatId: string;
  clientId: string;
  clientName: string;
  telegramUsername: string;
};

function clientFacturaText(value: any): string {
  return String(value || "").trim();
}

function clientFacturaNum(value: any): number {
  const n = Number(value || 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function clientFacturaMillis(value: any): number {
  if (value && typeof value.toMillis === "function") return Number(value.toMillis() || 0);
  if (value && typeof value.toDate === "function") return Number(value.toDate().getTime() || 0);
  return 0;
}

async function getSolicitudMetaForClientFactura(solicitudId: string): Promise<{
  solicitudFolio: string;
  clientId: string;
  clientName: string;
  companyName: string;
  totalAmount: number;
}> {
  const cleanSolicitudId = clientFacturaText(solicitudId);

  if (!cleanSolicitudId) {
    return {
      solicitudFolio: "",
      clientId: "",
      clientName: "Cliente",
      companyName: "Empresa",
      totalAmount: 0,
    };
  }

  const snap = await db.collection("solicitudes").doc(cleanSolicitudId).get();

  if (!snap.exists) {
    return {
      solicitudFolio: cleanSolicitudId,
      clientId: "",
      clientName: "Cliente",
      companyName: "Empresa",
      totalAmount: 0,
    };
  }

  const data = snap.data() || {};

  return {
    solicitudFolio: clientFacturaText(
      data.folio ||
      data.folioSolicitud ||
      data.solicitudFolio ||
      data.sequenceDisplay ||
      data.requestFolio ||
      cleanSolicitudId
    ),
    clientId: clientFacturaText(data.clienteId || data.clientId || ""),
    clientName: clientFacturaText(
      data.clienteNombre ||
      data.clientName ||
      data.clientDisplayName ||
      data.clientLabel ||
      "Cliente"
    ),
    companyName: clientFacturaText(
      data.empresaNombre ||
      data.companyName ||
      data.companyDisplayName ||
      data.companyLabel ||
      "Empresa"
    ),
    totalAmount: clientFacturaNum(
      data.total ??
      data.totalAmount ??
      data.monto ??
      data.montoTotal ??
      data.amount ??
      data.importeTotal ??
      0
    ),
  };
}

export async function getLatestFacturaForClientTelegramDelivery(
  rootId: string
): Promise<TelegramClientFacturaDelivery | null> {
  const cleanRootId = clientFacturaText(rootId);

  if (!cleanRootId) {
    throw new Error("rootId requerido.");
  }

  const snap = await db
    .collection("uploads")
    .where("rootId", "==", cleanRootId)
    .where("active", "==", true)
    .limit(500)
    .get();

  const grouped = new Map<string, {
    solicitudId: string;
    rootId: string;
    pdf: TelegramClientFacturaFile | null;
    xml: TelegramClientFacturaFile | null;
    createdAtMillis: number;
  }>();

  snap.forEach((doc) => {
    const data = doc.data() || {};
    const documentType = clientFacturaText(data.documentType || data.type).toUpperCase();
    const status = clientFacturaText(data.status).toUpperCase();
    const storagePath = clientFacturaText(data.storagePath);
    const solicitudId = clientFacturaText(data.solicitudId || data.entityId || "");
    const fileName = clientFacturaText(data.originalName || data.filename || data.fileName || "documento");
    const contentType = clientFacturaText(data.contentType || "");
    const sizeBytes = clientFacturaNum(data.sizeBytes);
    const createdAtMillis = clientFacturaMillis(data.finalizedAt || data.createdAt || data.updatedAt);

    if (!storagePath) return;
    if (!solicitudId) return;
    if (documentType !== "FACTURA_PDF" && documentType !== "FACTURA_XML") return;
    if (["DELETED", "ELIMINADA", "INACTIVE", "INACTIVO"].includes(status)) return;

    const current = grouped.get(solicitudId) || {
      solicitudId,
      rootId: cleanRootId,
      pdf: null,
      xml: null,
      createdAtMillis: 0,
    };

    const file = {
      uploadId: doc.id,
      storagePath,
      fileName,
      contentType: contentType || (documentType === "FACTURA_XML" ? "application/xml" : "application/pdf"),
      sizeBytes,
    };

    if (documentType === "FACTURA_PDF") {
      current.pdf = file;
    }

    if (documentType === "FACTURA_XML") {
      current.xml = file;
    }

    current.createdAtMillis = Math.max(current.createdAtMillis, createdAtMillis);
    grouped.set(solicitudId, current);
  });

  const rows: TelegramClientFacturaDelivery[] = [];

  for (const item of grouped.values()) {
    if (!item.pdf || !item.xml) continue;

    const meta = await getSolicitudMetaForClientFactura(item.solicitudId);
    if (!meta.clientId) continue;

    rows.push({
      solicitudId: item.solicitudId,
      solicitudFolio: meta.solicitudFolio || item.solicitudId,
      rootId: item.rootId,
      clientId: meta.clientId,
      clientName: meta.clientName || "Cliente",
      companyName: meta.companyName || "Empresa",
      totalAmount: meta.totalAmount,
      pdf: item.pdf,
      xml: item.xml,
      createdAtMillis: item.createdAtMillis,
    });
  }

  rows.sort((a, b) => b.createdAtMillis - a.createdAtMillis);

  return rows[0] || null;
}

export async function getClientTelegramRecipientsForClient(
  clientId: string
): Promise<TelegramClientRecipient[]> {
  const cleanClientId = clientFacturaText(clientId);

  if (!cleanClientId) return [];

  const snap = await db
    .collection("clientTelegramUsers")
    .where("clientId", "==", cleanClientId)
    .where("active", "==", true)
    .get();

  const rows: TelegramClientRecipient[] = [];

  snap.forEach((doc) => {
    const data = doc.data() || {};
    const chatId = clientFacturaText(data.chatId);

    if (!chatId) return;

    rows.push({
      telegramUserId: clientFacturaText(data.telegramUserId || doc.id),
      chatId,
      clientId: cleanClientId,
      clientName: clientFacturaText(data.clientName || ""),
      telegramUsername: clientFacturaText(data.telegramUsername || ""),
    });
  });

  return rows;
}

export async function setPublicAccessStatusFromTelegram(input: {
  linkedUser: LinkedTelegramUser;
  enabled: boolean;
  reason?: string;
}): Promise<{ enabled: boolean; reason: string }> {
  const uid = String(input.linkedUser.uid || "").trim();
  if (!uid) throw new Error("linked user uid requerido.");

  const role = String(input.linkedUser.role || "").trim().toLowerCase();
  if (role !== "superadmin") {
    throw new Error("Solo superadmin puede cambiar mantenimiento.");
  }

  const enabled = input.enabled === true;
  const reason = String(
    input.reason || (enabled ? "Sistema activo" : "Sistema en mantenimiento")
  ).slice(0, 200);

  const now = FieldValue.serverTimestamp();
  const rootId = String(input.linkedUser.rootId || uid);
  const actorName = String(
    input.linkedUser.displayName ||
    input.linkedUser.username ||
    input.linkedUser.telegramUsername ||
    uid
  );

  await db.doc("system/publicAccess").set(
    {
      enabled,
      reason,
      updatedAt: now,
      updatedBy: uid,
      updatedByRole: role,
      updatedBySource: "telegram",
    },
    { merge: true }
  );

  const eventType = enabled ? "WEB_MAINTENANCE_OFF" : "WEB_MAINTENANCE_ON";
  const description = enabled
    ? "Modo mantenimiento desactivado desde Telegram. Acceso web habilitado."
    : "Modo mantenimiento activado desde Telegram. Acceso web restringido.";

    await logActivity({
    event: eventType,
    rootId,
    adminId: uid,
    actorUid: uid,
    actorName,
    actorUsername: actorName,
    actorRole: role,
    entityType: "system",
    entityId: "publicAccess",
    referenceId: "system/publicAccess",
    referenceType: "maintenance",
    description,
    createdBy: uid,
    createdByRole: role,
    extra: {
      module: "system",
      source: "telegram",
      enabled,
      reason,
    },
  });

  return { enabled, reason };
}