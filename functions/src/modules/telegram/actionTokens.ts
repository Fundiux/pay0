import * as admin from "firebase-admin";
import * as crypto from "crypto";
import { logger } from "firebase-functions";
import { onRequest } from "firebase-functions/v2/https";

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;

type TelegramActionType = "DOWNLOAD_DOCUMENT" | "SEND_DOCUMENT_EMAIL";

type TelegramActionTokenInput = {
  actionType: TelegramActionType;
  uid: string;
  rootId: string;
  entityType: "solicitud" | "dispersion";
  entityId: string;
  documentId?: string;
  storagePath?: string;
  fileName?: string;
  expiresInMinutes?: number;
};

function generateToken(): string {
  return crypto
    .randomBytes(32)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function cleanStoragePath(value: any): string {
  const path = String(value || "").trim();

  if (!path) return "";
  if (path.includes("..")) return "";
  if (path.startsWith("/") || path.startsWith("\\")) return "";

  return path;
}

function safeDownloadName(value: any): string {
  const name = String(value || "documento").trim();
  return name
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, 180) || "documento";
}

export async function createTelegramActionToken(
  input: TelegramActionTokenInput
): Promise<{ token: string; url: string; expiresAt: string }> {
  const actionType = input.actionType;
  const uid = String(input.uid || "").trim();
  const rootId = String(input.rootId || "").trim();
  const entityType = input.entityType;
  const entityId = String(input.entityId || "").trim();
  const documentId = String(input.documentId || "").trim();
  const storagePath = cleanStoragePath(input.storagePath);
  const fileName = safeDownloadName(input.fileName || "documento");

  if (!uid || !rootId || !entityType || !entityId) {
    throw new Error("Datos insuficientes para accion Telegram.");
  }

  if (actionType === "DOWNLOAD_DOCUMENT" && !storagePath) {
    throw new Error("storagePath requerido para descarga.");
  }

  const token = generateToken();
  const expiresDate = new Date(Date.now() + Math.max(1, input.expiresInMinutes || 15) * 60 * 1000);

  await db.collection("telegramActionTokens").doc(token).set({
    token,
    actionType,
    status: "ACTIVE",
    uid,
    rootId,
    entityType,
    entityId,
    documentId: documentId || null,
    storagePath: storagePath || null,
    fileName,
    expiresAt: Timestamp.fromDate(expiresDate),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return {
    token,
    url: `https://us-central1-pay-0-system.cloudfunctions.net/telegramDownloadAction?token=${encodeURIComponent(token)}`,
    expiresAt: expiresDate.toISOString(),
  };
}

export const telegramDownloadAction = onRequest(
  {
    region: "us-central1",
    cors: false,
    timeoutSeconds: 60,
    memory: "256MiB",
  },
  async (req, res) => {
    if (req.method !== "GET") {
      res.status(405).send("method not allowed");
      return;
    }

    try {
      const token = String(req.query.token || "").trim();

      if (!token) {
        res.status(400).send("token requerido");
        return;
      }

      const ref = db.collection("telegramActionTokens").doc(token);
      const snap = await ref.get();

      if (!snap.exists) {
        res.status(404).send("token no encontrado");
        return;
      }

      const data = snap.data() || {};
      const status = String(data.status || "");
      const actionType = String(data.actionType || "");
      const storagePath = cleanStoragePath(data.storagePath);
      const fileName = safeDownloadName(data.fileName || "documento");
      const expiresAt: any = data.expiresAt;
      const expiresMillis =
        expiresAt && typeof expiresAt.toMillis === "function"
          ? expiresAt.toMillis()
          : 0;

      if (status !== "ACTIVE" || actionType !== "DOWNLOAD_DOCUMENT") {
        res.status(403).send("token no activo");
        return;
      }

      if (!expiresMillis || expiresMillis < Date.now()) {
        await ref.set(
          {
            status: "EXPIRED",
            expiredAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        res.status(410).send("token expirado");
        return;
      }

      if (!storagePath) {
        res.status(400).send("storagePath invalido");
        return;
      }

      const bucket = admin.storage().bucket();
      const file = bucket.file(storagePath);

      const [exists] = await file.exists();
      if (!exists) {
        res.status(404).send("archivo no encontrado");
        return;
      }

      const [metadata] = await file.getMetadata();
      const contentType = String(metadata.contentType || "application/octet-stream");

      await ref.set(
        {
          usedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "no-store, max-age=0");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${fileName.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
      );

      const stream = file.createReadStream();

      stream.on("error", (error: any) => {
        logger.error("telegramDownloadAction stream error", {
          message: String(error?.message || error || "unknown"),
          storagePath,
          token,
        });

        if (!res.headersSent) {
          res.status(500).send("error descargando archivo");
        } else {
          res.end();
        }
      });

      stream.pipe(res);
    } catch (error: any) {
      logger.error("telegramDownloadAction error", {
        message: String(error?.message || error || "unknown"),
        stack: String(error?.stack || ""),
      });

      if (!res.headersSent) {
        res.status(500).send("error generando descarga");
      }
    }
  }
);