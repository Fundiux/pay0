import * as crypto from "crypto";
import { getFirestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { DEFAULT_IQ_ERP_URL } from "./config";
import {
  loginIqHttpDirect,
  type IqHttpAuthSession,
} from "./iqHttpAuth";

type AnyRecord = Record<string, unknown>;

export type IqCanonicalModule =
  | "solicitudes"
  | "pagos"
  | "dispersiones"
  | "paymentApplications";

export type IqCanonicalAccess = {
  profileId: string;
  profileAlias: string;
  associatedName: string;
  username: string;
  password: string;
  erpUrl: string;
};

function clean(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function record(value: unknown): AnyRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as AnyRecord
    : {};
}

function normalizeErpUrl(value: unknown): string {
  const raw = clean(value) || DEFAULT_IQ_ERP_URL;

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

function encryptionKey(rawSecret: string): Buffer {
  const raw = clean(rawSecret);

  if (!raw || raw.length < 16) {
    throw new HttpsError(
      "failed-precondition",
      "IQ_CREDENTIALS_KEY no esta configurada.",
    );
  }

  if (/^[a-f0-9]{64}$/i.test(raw)) {
    return Buffer.from(raw, "hex");
  }

  try {
    const decoded = Buffer.from(raw, "base64");
    if (decoded.length === 32) {
      return decoded;
    }
  } catch {
    // fallback SHA-256
  }

  return crypto.createHash("sha256").update(raw).digest();
}

function decryptPassword(
  profile: AnyRecord,
  rawSecret: string,
): string {
  const ciphertext = clean(profile.passwordCiphertext);
  const iv = clean(profile.passwordIv);
  const tag = clean(profile.passwordTag);

  if (!ciphertext || !iv || !tag) {
    throw new HttpsError(
      "failed-precondition",
      "La cuenta IQ no tiene contrasena configurada.",
    );
  }

  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      encryptionKey(rawSecret),
      Buffer.from(iv, "base64"),
    );

    decipher.setAuthTag(Buffer.from(tag, "base64"));

    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new HttpsError(
      "failed-precondition",
      "No se pudo descifrar la contrasena IQ configurada.",
    );
  }
}

function moduleAllowed(
  allowedModules: AnyRecord,
  moduleKey: IqCanonicalModule,
): boolean {
  if (moduleKey === "paymentApplications") {
    return (
      allowedModules.paymentApplications === true ||
      allowedModules.pagos === true
    );
  }

  if (moduleKey === "dispersiones") {
    return (
      allowedModules.dispersiones === true ||
      allowedModules.dispersions === true ||
      allowedModules.walletDispersiones === true ||
      allowedModules.wallet === true
    );
  }

  return allowedModules[moduleKey] === true;
}

export async function loadIqCanonicalProfileById(input: {
  profileId: string;
  rootId: string;
  encryptionSecret: string;
  includePassword?: boolean;
}): Promise<IqCanonicalAccess> {
  const db = getFirestore();
  const profileId = clean(input.profileId);
  const rootId = clean(input.rootId);

  if (!profileId) {
    throw new HttpsError("invalid-argument", "profileId requerido.");
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

  const profile = record(profileSnap.data());

  if (clean(profile.rootId) !== rootId) {
    throw new HttpsError(
      "permission-denied",
      "La cuenta IQ esta fuera de scope.",
    );
  }

  if (profile.active !== true || profile.hasPassword !== true) {
    throw new HttpsError(
      "failed-precondition",
      "La cuenta IQ esta inactiva o incompleta.",
    );
  }

  const username = clean(profile.username);

  if (!username) {
    throw new HttpsError(
      "failed-precondition",
      "La cuenta IQ no tiene usuario configurado.",
    );
  }

  return {
    profileId,
    profileAlias: clean(profile.alias) || profileId,
    associatedName: "",
    username,
    password:
      input.includePassword === false
        ? ""
        : decryptPassword(profile,input.encryptionSecret),
    erpUrl: normalizeErpUrl(profile.erpUrl),
  };
}

export async function loadIqCanonicalUserAccess(input: {
  uid: string;
  rootId: string;
  role?: string;
  moduleKey: IqCanonicalModule;
  encryptionSecret: string;
  includePassword?: boolean;
  profileIdOverride?: string;
  associatedNameOverride?: string;
}): Promise<IqCanonicalAccess> {
  const db = getFirestore();
  const uid = clean(input.uid);
  const rootId = clean(input.rootId);

  const accessSnap = await db
    .collection("iqUserAccess")
    .doc(uid)
    .get();

  const access = record(accessSnap.data());

  if (
    !accessSnap.exists ||
    access.active !== true ||
    access.iqEnabled !== true
  ) {
    throw new HttpsError(
      "failed-precondition",
      "El usuario no tiene acceso IQ activo.",
    );
  }

  if (clean(access.rootId) && clean(access.rootId) !== rootId) {
    throw new HttpsError(
      "permission-denied",
      "El acceso IQ esta fuera de scope.",
    );
  }

  const allowedModules = record(access.allowedModules);
  const isSuperadmin = clean(input.role).toLowerCase() === "superadmin";

  if (
    !isSuperadmin &&
    !moduleAllowed(allowedModules,input.moduleKey)
  ) {
    throw new HttpsError(
      "permission-denied",
      "El usuario no tiene habilitado el modulo IQ requerido.",
    );
  }

  const profileId =
    clean(input.profileIdOverride) ||
    clean(access.iqCredentialProfileId);

  const profile = await loadIqCanonicalProfileById({
    profileId,
    rootId,
    encryptionSecret: input.encryptionSecret,
    includePassword: input.includePassword,
  });

  return {
    ...profile,
    associatedName:
      clean(input.associatedNameOverride) ||
      clean(access.associatedName) ||
      profile.username,
  };
}

export async function openIqCanonicalSession(input: {
  access: IqCanonicalAccess;
  requiredPermissions?: "DEPOSIT" | "NONE";
  apiOrigin?: string;
  timeoutMs?: number;
}): Promise<IqHttpAuthSession> {
  return loginIqHttpDirect({
    apiOrigin:
      clean(input.apiOrigin) ||
      clean(process.env.PAY0_IQ_API_ORIGIN) ||
      "https://iq-produccion-ccc570f75402.herokuapp.com",
    credentials: {
      username: input.access.username,
      password: input.access.password,
    },
    requiredPermissions: input.requiredPermissions ?? "NONE",
    timeoutMs: input.timeoutMs,
  });
}