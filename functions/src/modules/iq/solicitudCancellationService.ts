import * as crypto from "crypto";
import * as admin from "firebase-admin";
import { HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";

import { DEFAULT_IQ_ERP_URL } from "./config";
import { evaluateIqDispatchGate } from "../dispatches/iqGate";
import {
  runIqRequestInvoiceCancellationHttp,
  type IqSolicitudCancellationHttpResult,
} from "./solicitudHttpCancellation";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

export const IQ_CANCELLATION_CREDENTIALS_KEY =
  defineSecret("IQ_CREDENTIALS_KEY");

function cleanText(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function normalizeErpUrl(value: string): string {
  const raw = value.trim() || DEFAULT_IQ_ERP_URL;

  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.host}`;
  } catch {
    throw new HttpsError(
      "failed-precondition",
      "La cuenta IQ tiene una URL ERP invalida.",
    );
  }
}

function getEncryptionKey(): Buffer {
  const raw = IQ_CANCELLATION_CREDENTIALS_KEY.value();

  if (!raw || raw.trim().length < 16) {
    throw new HttpsError(
      "failed-precondition",
      "IQ_CREDENTIALS_KEY no esta configurada.",
    );
  }

  const trimmed = raw.trim();

  if (/^[a-f0-9]{64}$/i.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }

  try {
    const fromBase64 = Buffer.from(trimmed, "base64");

    if (fromBase64.length === 32) {
      return fromBase64;
    }
  } catch {
    // fallback to sha256
  }

  return crypto.createHash("sha256").update(trimmed).digest();
}

function decryptSecret(data: Record<string, unknown>): string {
  const ciphertext = cleanText(data.passwordCiphertext);
  const iv = cleanText(data.passwordIv);
  const tag = cleanText(data.passwordTag);

  if (!ciphertext || !iv || !tag) {
    throw new HttpsError(
      "failed-precondition",
      "La cuenta IQ no tiene contrasena configurada.",
    );
  }

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(iv, "base64"),
  );

  decipher.setAuthTag(Buffer.from(tag, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export type SolicitudIqCancellationRoutingResult =
  | {
      appliesToIq: false;
      reason: string;
    }
  | {
      appliesToIq: true;
      iqFolio: string;
      operationalOwnerId: string;
      profileId: string;
      http: IqSolicitudCancellationHttpResult;
    };

export async function requestSolicitudIqCancellationCore(input: {
  solicitud: Record<string, unknown>;
  rootId: string;
}): Promise<SolicitudIqCancellationRoutingResult> {
  const solicitud = asRecord(input.solicitud);

  const despachoId = cleanText(
    solicitud.despachoId ??
      solicitud.dispatchId ??
      asRecord(solicitud.iqSync).despachoId,
  );

  const companyId = cleanText(
    solicitud.companyId ??
      solicitud.empresaId,
  );

  if (!despachoId) {
    throw new HttpsError(
      "failed-precondition",
      "La solicitud no conserva despacho para resolver su cancelacion.",
    );
  }

  if (!companyId) {
    throw new HttpsError(
      "failed-precondition",
      "La solicitud no conserva empresa para resolver su cancelacion.",
    );
  }

  const gate = await evaluateIqDispatchGate({
    db,
    despachoId,
    companyId,
    rootId: input.rootId,
  });

  if (!gate.ok) {
    if (gate.code === "IQ_PROVIDER_NOT_ALLOWED") {
      return {
        appliesToIq: false,
        reason: gate.code,
      };
    }

    throw new HttpsError(
      "failed-precondition",
      gate.message,
    );
  }

  const iqFolio = cleanText(
    solicitud.iqFolio ??
      solicitud.iqId,
  );

  if (!iqFolio) {
    throw new HttpsError(
      "failed-precondition",
      "La solicitud IQ no tiene folio IQ vigente para cancelar.",
    );
  }

  const operationalOwnerId = cleanText(
    solicitud.operationalOwnerId ??
      solicitud.iqOwnerId ??
      solicitud.ownerId,
  );

  if (!operationalOwnerId) {
    throw new HttpsError(
      "failed-precondition",
      "La solicitud no conserva propietario operativo.",
    );
  }

  const accessSnap = await db
    .collection("iqUserAccess")
    .doc(operationalOwnerId)
    .get();

  const access = asRecord(accessSnap.data());

  if (
    !accessSnap.exists ||
    access.active !== true ||
    access.iqEnabled !== true
  ) {
    throw new HttpsError(
      "failed-precondition",
      "El propietario operativo no tiene acceso IQ activo.",
    );
  }

  const profileId = cleanText(access.iqCredentialProfileId);

  if (!profileId) {
    throw new HttpsError(
      "failed-precondition",
      "La solicitud no conserva una cuenta IQ valida para cancelar.",
    );
  }

  const profileSnap = await db
    .collection("iqCredentialProfiles")
    .doc(profileId)
    .get();

  if (!profileSnap.exists) {
    throw new HttpsError(
      "failed-precondition",
      "La cuenta IQ asignada no existe.",
    );
  }

  const profile = asRecord(profileSnap.data());

  if (
    cleanText(profile.rootId) !== input.rootId ||
    profile.active !== true ||
    profile.hasPassword !== true
  ) {
    throw new HttpsError(
      "failed-precondition",
      "La cuenta IQ asignada esta inactiva o fuera de scope.",
    );
  }

  const username = cleanText(profile.username);
  const erpUrl = normalizeErpUrl(cleanText(profile.erpUrl));

  if (!username) {
    throw new HttpsError(
      "failed-precondition",
      "La cuenta IQ asignada no tiene usuario configurado.",
    );
  }

  let password = "";

  try {
    password = decryptSecret(profile);

    const http = await runIqRequestInvoiceCancellationHttp({
      username,
      password,
      iqFolio,
    });

    return {
      appliesToIq: true,
      iqFolio,
      operationalOwnerId,
      profileId,
      http,
    };
  } finally {
    password = "";
  }
}
