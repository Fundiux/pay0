import * as admin from "firebase-admin";
import * as crypto from "crypto";
import { logger } from "firebase-functions";
import { onRequest } from "firebase-functions/v2/https";
import { assertAuthorized } from "../../utils/authGuard";
import { requireClientOperationalAccess, normalizeClientAccessPermissions } from "../clientDelegations/access";
import { delegationIsCurrent } from "../clientDelegations/policy";
import { assertDownloadAvailable, downloadTtlMinutes, DownloadTokenError, DOWNLOAD_LEASE_MS,
  DOWNLOAD_STREAM_MS, ownsDownloadEntity, DOWNLOAD_APP_ORIGIN, DOWNLOAD_PAGE_PATH,
  downloadTokenFromRequest, assertDownloadTransport } from "./downloadTokenPolicy";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const { FieldValue, Timestamp } = admin.firestore;
type TelegramActionTokenInput = {
  actionType: "DOWNLOAD_DOCUMENT" | "SEND_DOCUMENT_EMAIL";
  uid: string; rootId: string; entityType: "solicitud" | "dispersion"; entityId: string;
  documentId?: string; storagePath?: string; fileName?: string; expiresInMinutes?: number;
};
const validId = (value: any): value is string => typeof value === "string" && !!value && !/[\/\\]/.test(value);
function cleanStoragePath(value: unknown): string {
  const path = String(value || "").trim();
  return !path || path.includes("..") || /[\\\x00-\x1f]/.test(path) || path.startsWith("/") ? "" : path;
}
function safeDownloadName(value: unknown): string {
  return String(value || "documento").replace(/[\\/:*?"<>|\x00-\x1f\x7f]+/g, "_").slice(0, 180);
}

async function assertCurrentAccess(row: any, tx?: FirebaseFirestore.Transaction) {
  if (![row.uid, row.rootId, row.entityId, row.documentId].every(validId) ||
      !["solicitud", "dispersion"].includes(row.entityType)) throw new DownloadTokenError(403);
  const read = (ref: FirebaseFirestore.DocumentReference) => tx ? tx.get(ref) : ref.get();
  const user = (await read(db.collection("users").doc(row.uid))).data();
  const role = assertAuthorized({ uid: row.uid }, user, {
    allowedRoles: ["superadmin", "admin", "operador"],
    requiredModule: row.entityType === "solicitud" ? "solicitudes" : "wallet",
    requiredAction: row.entityType === "solicitud" ? "view" : "dispersiones",
  });
  if (String(user?.rootId || row.uid) !== row.rootId) throw new DownloadTokenError(403);
  const entity = (await read(db.collection(row.entityType === "solicitud" ? "solicitudes" : "clientDispersions").doc(row.entityId))).data();
  if (!entity || entity.rootId !== row.rootId || entity.isDeleted || entity.deletedAt || entity.status === "ELIMINADA") throw new DownloadTokenError(403);
  if (!ownsDownloadEntity(row.uid, row.rootId, role, entity)) {
    const clientId = entity.clienteId || entity.clientId;
    if (!validId(clientId)) throw new DownloadTokenError(403);
    const client = (await read(db.collection("clients").doc(clientId))).data();
    if (!client || client.rootId !== row.rootId) throw new DownloadTokenError(403);
    const permission = row.entityType === "solicitud" ? "operateSolicitudes" : "operateDispersiones";
    const access = await requireClientOperationalAccess({ uid: row.uid, rootId: row.rootId, role, clientId, client, permission });
    if (access.source === "DELEGATED") {
      // Add the grant to the transaction read set and check current time/permissions again.
      const grant = (await read(db.doc(`userClientAccess/${row.uid}/clients/${clientId}`))).data();
      if (!delegationIsCurrent(grant) || (grant && (
        ("rootId" in grant && grant.rootId !== row.rootId) ||
        ("targetUid" in grant && grant.targetUid !== row.uid) ||
        ("clientId" in grant && grant.clientId !== clientId))) ||
        normalizeClientAccessPermissions(grant?.permissions, true)[permission] !== true) throw new DownloadTokenError(403);
    }
  }
  const upload = (await read(db.collection("uploads").doc(row.documentId))).data();
  const entityId = row.entityType === "solicitud" ? upload?.solicitudId || upload?.entityId : upload?.dispersionId || upload?.entityId;
  if (!upload || upload.active !== true || upload.deletedAt || upload.rootId !== row.rootId || entityId !== row.entityId || upload.storagePath !== row.storagePath ||
      ["DELETED", "ELIMINADA", "INACTIVE", "INACTIVO"].includes(String(upload.status || "").toUpperCase())) throw new DownloadTokenError(403);
  const prefix = `roots/${row.rootId}/${row.entityType === "solicitud" ? "solicitudes" : "dispersiones"}/${row.entityId}/`;
  if (!cleanStoragePath(row.storagePath).startsWith(prefix)) throw new DownloadTokenError(403);
}

export async function createTelegramActionToken(input: TelegramActionTokenInput): Promise<{ token: string; url: string; expiresAt: string }> {
  const row = { ...input, storagePath: cleanStoragePath(input.storagePath), fileName: safeDownloadName(input.fileName) };
  if (input.actionType !== "DOWNLOAD_DOCUMENT") throw new DownloadTokenError(400);
  const ttl = downloadTtlMinutes(input.expiresInMinutes);
  await assertCurrentAccess(row);
  if ((await admin.auth().getUser(input.uid)).disabled) throw new DownloadTokenError(403);
  const [metadata] = await admin.storage().bucket().file(row.storagePath).getMetadata();
  const storageGeneration = String(metadata.generation || "");
  if (!/^\d+$/.test(storageGeneration)) throw new DownloadTokenError(403);
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresDate = new Date(Date.now() + ttl * 60_000);
  await db.collection("telegramActionTokens").doc(token).create({
    actionType: row.actionType, uid: row.uid, rootId: row.rootId, entityType: row.entityType,
    entityId: row.entityId, documentId: row.documentId, storagePath: row.storagePath, fileName: row.fileName,
    storageGeneration, transportVersion: 2, status: "ACTIVE", attempts: 0, expiresAt: Timestamp.fromDate(expiresDate),
    createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  });
  return { token, url: `${DOWNLOAD_APP_ORIGIN}${DOWNLOAD_PAGE_PATH}#token=${encodeURIComponent(token)}`, expiresAt: expiresDate.toISOString() };
}

export const telegramDownloadAction = onRequest({ region: "us-central1", cors: false, timeoutSeconds: 60, memory: "256MiB" }, async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  const origin = req.headers.origin;
  res.setHeader("Vary", "Origin");
  if (origin && origin !== DOWNLOAD_APP_ORIGIN) { res.status(403).send("Descarga no disponible."); return; }
  if (origin === DOWNLOAD_APP_ORIGIN) {
    res.setHeader("Access-Control-Allow-Origin", DOWNLOAD_APP_ORIGIN);
    res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
  }
  if (req.method === "OPTIONS") {
    if (origin !== DOWNLOAD_APP_ORIGIN || req.headers["access-control-request-method"] !== "POST" ||
        String(req.headers["access-control-request-headers"] || "").split(",").some(value => value.trim() && value.trim().toLowerCase() !== "content-type")) {
      res.status(403).send("Descarga no disponible."); return;
    }
    res.setHeader("Access-Control-Allow-Methods", "POST");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.status(204).send(""); return;
  }
  if (req.method !== "GET" && req.method !== "POST") { res.status(405).send("Método no permitido."); return; }
  if (req.method === "POST" && (origin !== DOWNLOAD_APP_ORIGIN ||
      !/^application\/json(?:\s*;|$)/i.test(String(req.headers["content-type"] || "")))) { res.status(403).send("Descarga no disponible."); return; }
  if (req.headers.range) { res.status(416).send("Rango no disponible."); return; }
  let token: string;
  try { token = downloadTokenFromRequest(req.method, req.query, req.body); }
  catch { res.status(400).send("Descarga no disponible."); return; }
  const ref = db.collection("telegramActionTokens").doc(token);
  const leaseId = crypto.randomBytes(16).toString("hex");
  let acquired = false;
  const settle = async (success: boolean) => {
    await db.runTransaction(async tx => {
      const row = (await tx.get(ref)).data();
      if (!row || row.leaseId !== leaseId) return;
      // Revocation always wins over a completed or interrupted response.
      tx.update(ref, { leaseId: FieldValue.delete(), leaseUntil: FieldValue.delete(),
        ...(success && row.status === "ACTIVE" && !row.revokedAt ? { status: "CONSUMED", usedAt: FieldValue.serverTimestamp() } : {}),
        updatedAt: FieldValue.serverTimestamp() });
    });
  };
  try {
    const initial = (await ref.get()).data();
    assertDownloadAvailable(initial, Date.now());
    assertDownloadTransport(initial, req.method, Date.now());
    if (!validId(initial!.uid) || (await admin.auth().getUser(initial!.uid)).disabled) throw new DownloadTokenError(403);
    const row = await db.runTransaction(async tx => {
      const data = (await tx.get(ref)).data();
      assertDownloadAvailable(data, Date.now());
      assertDownloadTransport(data, req.method, Date.now());
      if (data!.uid !== initial!.uid) throw new DownloadTokenError(403);
      await assertCurrentAccess(data, tx);
      tx.update(ref, { leaseId, leaseUntil: Timestamp.fromMillis(Date.now() + DOWNLOAD_LEASE_MS),
        attempts: (data!.attempts || 0) + 1, updatedAt: FieldValue.serverTimestamp() });
      return data!;
    });
    acquired = true;
    const file = admin.storage().bucket().file(row.storagePath, { generation: row.storageGeneration });
    const [metadata] = await file.getMetadata();
    res.setHeader("Content-Type", String(metadata.contentType || "application/octet-stream"));
    const name = safeDownloadName(row.fileName);
    res.setHeader("Content-Disposition", `attachment; filename="documento"; filename*=UTF-8''${encodeURIComponent(name)}`);
    const stream = file.createReadStream();
    await new Promise<void>((resolve) => {
      let completed = false;
      const finish = (success: boolean) => {
        if (completed) return;
        completed = true;
        clearTimeout(timer);
        if (!success) stream.destroy();
        settle(success).catch(() => logger.error("telegramDownloadAction lease settlement failed", { code: "SETTLEMENT_FAILED" })).finally(resolve);
      };
      const timer = setTimeout(() => { stream.destroy(); res.destroy(); finish(false); }, DOWNLOAD_STREAM_MS);
      res.once("finish", () => finish(true));
      res.once("close", () => finish(res.writableFinished));
      stream.once("error", () => {
        logger.error("telegramDownloadAction stream error", { code: "STREAM_FAILED" });
        finish(false);
        if (!res.headersSent) res.status(500).send("Error descargando archivo."); else res.destroy();
      });
      stream.pipe(res);
    });
  } catch (error: any) {
    if (acquired) await settle(false).catch(() => logger.error("telegramDownloadAction lease settlement failed", { code: "SETTLEMENT_FAILED" }));
    const status = error instanceof DownloadTokenError ? error.status : error?.code === "permission-denied" ? 403 : 500;
    // Do not log provider errors, request URLs, storage paths, bearers or stacks.
    if (status === 500) logger.error("telegramDownloadAction error", { code: "DOWNLOAD_FAILED" });
    if (!res.headersSent) res.status(status).send("Descarga no disponible."); else res.destroy();
  }
});
