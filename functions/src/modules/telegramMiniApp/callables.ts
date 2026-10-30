import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import type {
  MatBotScope,
  MatClientHomeResult,
  MatUserHomeResult,
  VerifyTelegramMiniAppSessionInput,
  VerifyTelegramMiniAppSessionResult,
} from "./domain";
import {
  getTelegramDisplayName,
  validateTelegramMiniAppInitData,
} from "./auth";
import {
  buildMatClientHome,
  buildMatUserHome,
  resolveClientLinkByTelegramId,
  resolveInternalUserByTelegramId,
} from "./service";

if (!getApps().length) {
  initializeApp();
}

const db = getFirestore();

const PAY0_TELEGRAM_USERS_BOT_TOKEN = defineSecret("PAY0_TELEGRAM_USERS_BOT_TOKEN");
const PAY0_TELEGRAM_CLIENTS_BOT_TOKEN = defineSecret("PAY0_TELEGRAM_CLIENTS_BOT_TOKEN");

function normalizeScope(scope: unknown): MatBotScope {
  const value = String(scope || "").trim().toUpperCase();

  if (value === "USERS" || value === "CLIENTS") {
    return value;
  }

  throw new HttpsError("invalid-argument", "botScope invalido.");
}

function getTokenForScope(scope: MatBotScope): string {
  if (scope === "USERS") {
    return PAY0_TELEGRAM_USERS_BOT_TOKEN.value();
  }

  return PAY0_TELEGRAM_CLIENTS_BOT_TOKEN.value();
}

function resultError(
  status: VerifyTelegramMiniAppSessionResult["status"],
  message: string,
  scope: MatBotScope | "" = "",
): VerifyTelegramMiniAppSessionResult {
  return {
    ok: false,
    status,
    scope,
    telegramUserId: "",
    displayName: "",
    username: "",
    linked: false,
    message,
  };
}

function mapValidationError(error: unknown, scope: MatBotScope | ""): VerifyTelegramMiniAppSessionResult {
  const code = error instanceof Error ? error.message : "ERROR";

  if (code === "MISSING_TOKEN") {
    return resultError("MISSING_TOKEN", "Token MAT no configurado.", scope);
  }

  if (code === "EXPIRED_AUTH_DATE") {
    return resultError("EXPIRED", "Sesion Telegram expirada.", scope);
  }

  return resultError("INVALID_INIT_DATA", "initData Telegram invalido.", scope);
}

function validateRequestInitData(input: VerifyTelegramMiniAppSessionInput, expectedScope: MatBotScope) {
  const scope = normalizeScope(input.botScope);

  if (scope !== expectedScope) {
    throw new HttpsError("permission-denied", "Scope MAT incorrecto.");
  }

  const initData = String(input.initData || "").trim();

  if (!initData) {
    throw new HttpsError("invalid-argument", "initData requerido.");
  }

  return validateTelegramMiniAppInitData({
    initData,
    botScope: scope,
    botToken: getTokenForScope(scope),
  });
}

export const verifyTelegramMiniAppSession = onCall(
  {
    region: "us-central1",
    secrets: [PAY0_TELEGRAM_USERS_BOT_TOKEN, PAY0_TELEGRAM_CLIENTS_BOT_TOKEN],
  },
  async (request): Promise<VerifyTelegramMiniAppSessionResult> => {
    const input = (request.data || {}) as VerifyTelegramMiniAppSessionInput;
    const scope = normalizeScope(input.botScope);
    const initData = String(input.initData || "").trim();

    if (!initData) {
      return resultError("INVALID_INIT_DATA", "initData requerido.", scope);
    }

    try {
      const verified = validateTelegramMiniAppInitData({
        initData,
        botScope: scope,
        botToken: getTokenForScope(scope),
      });

      if (scope === "USERS") {
        const linkedUser = await resolveInternalUserByTelegramId(db, verified.telegramUserId);
        const activeUser = linkedUser && linkedUser.active !== false;

        return {
          ok: true,
          status: activeUser ? "OK" : "UNLINKED",
          scope,
          telegramUserId: verified.telegramUserId,
          displayName: getTelegramDisplayName(verified.user),
          username: verified.user.username || "",
          linked: Boolean(activeUser),
          pay0UserId: activeUser ? String(linkedUser.id || linkedUser.uid || "") : "",
          message: activeUser ? "Telegram vinculado a usuario PAY0." : "Usuario Telegram no vinculado a PAY0.",
        };
      }

      const linkedClient = await resolveClientLinkByTelegramId(db, verified.telegramUserId);
      const activeClient = linkedClient && linkedClient.active !== false;

      return {
        ok: true,
        status: activeClient ? "OK" : "UNLINKED",
        scope,
        telegramUserId: verified.telegramUserId,
        displayName: getTelegramDisplayName(verified.user),
        username: verified.user.username || "",
        linked: Boolean(activeClient),
        clienteId: activeClient ? String(linkedClient.clientId || linkedClient.clienteId || "") : "",
        message: activeClient ? "Telegram vinculado a cliente PAY0." : "Cliente Telegram no vinculado a PAY0.",
      };
    } catch (error) {
      return mapValidationError(error, scope);
    }
  },
);

export const getMatUserHome = onCall(
  {
    region: "us-central1",
    secrets: [PAY0_TELEGRAM_USERS_BOT_TOKEN, PAY0_TELEGRAM_CLIENTS_BOT_TOKEN],
  },
  async (request): Promise<MatUserHomeResult> => {
    const input = (request.data || {}) as VerifyTelegramMiniAppSessionInput;
    const verified = validateRequestInitData(input, "USERS");

    return buildMatUserHome({
      db,
      telegramUserId: verified.telegramUserId,
      displayName: getTelegramDisplayName(verified.user),
      username: verified.user.username || "",
    });
  },
);

export const getMatClientHome = onCall(
  {
    region: "us-central1",
    secrets: [PAY0_TELEGRAM_USERS_BOT_TOKEN, PAY0_TELEGRAM_CLIENTS_BOT_TOKEN],
  },
  async (request): Promise<MatClientHomeResult> => {
    const input = (request.data || {}) as VerifyTelegramMiniAppSessionInput;
    const verified = validateRequestInitData(input, "CLIENTS");

    return buildMatClientHome({
      db,
      telegramUserId: verified.telegramUserId,
      displayName: getTelegramDisplayName(verified.user),
      username: verified.user.username || "",
    });
  },
);

export const getMatSolicitudDocuments = onCall(
  {
    region: "us-central1",
    secrets: [PAY0_TELEGRAM_USERS_BOT_TOKEN, PAY0_TELEGRAM_CLIENTS_BOT_TOKEN],
  },
  async (request) => {
    const input = (request.data || {}) as VerifyTelegramMiniAppSessionInput & { solicitudId?: string };
    const scope = normalizeScope(input.botScope);
    const verified = validateRequestInitData(input, scope);
    const solicitudId = String(input.solicitudId || "").trim();
    if (!solicitudId) throw new HttpsError("invalid-argument", "solicitudId requerido.");

    const home = scope === "USERS"
      ? await buildMatUserHome({ db, telegramUserId: verified.telegramUserId, displayName: getTelegramDisplayName(verified.user), username: verified.user.username || "" })
      : await buildMatClientHome({ db, telegramUserId: verified.telegramUserId, displayName: getTelegramDisplayName(verified.user), username: verified.user.username || "" });
    if (!home.linked || !home.solicitudes.some((item) => item.id === solicitudId)) {
      throw new HttpsError("permission-denied", "Solicitud fuera del alcance MAT.");
    }
    const solicitudSnap = await db.collection("solicitudes").doc(solicitudId).get();
    const solicitud = solicitudSnap.data() || {};
    const rootId = String(solicitud.rootId || "").trim();
    if (!solicitudSnap.exists || !rootId || solicitud.isDeleted || solicitud.deletedAt ||
      (scope === "USERS" && rootId !== (home as MatUserHomeResult).rootId) ||
      (scope === "CLIENTS" && String(solicitud.clienteId || solicitud.clientId || "") !== (home as MatClientHomeResult).clienteId)) {
      throw new HttpsError("permission-denied", "Solicitud fuera del alcance MAT.");
    }

    const uploads = await db.collection("uploads").where("rootId", "==", rootId).where("solicitudId", "==", solicitudId).limit(100).get();
    const prefix = `roots/${rootId}/solicitudes/${solicitudId}/`;
    const visible = uploads.docs.filter((doc) => {
      const row = doc.data() || {};
      return row.entityType === "solicitudes" && row.active === true &&
        !["INACTIVE", "REPLACED"].includes(String(row.status || "").toUpperCase()) &&
        String(row.storagePath || "").startsWith(prefix);
    }).slice(0, 30);
    const [{ getStorage }, { signGenerationBoundDownload }] = await Promise.all([
      import("firebase-admin/storage"), import("../documents/generationBoundDownload"),
    ]);
    const bucket = getStorage().bucket();
    const documents = await Promise.all(visible.map(async (doc) => {
      const row = doc.data() || {};
      const url = await signGenerationBoundDownload(bucket, String(row.storagePath), row.storageGeneration ?? null);
      return { id: doc.id, name: String(row.originalName || row.filename || row.fileName || row.documentTypeLabel || row.documentType || "Documento"), type: String(row.documentTypeLabel || row.documentType || "Documento"), url };
    }));
    return { documents, expiresInSeconds: 300 };
  },
);
