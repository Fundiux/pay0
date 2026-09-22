import {
  loadIqCanonicalProfileById,
  openIqCanonicalSession,
} from "./iqCanonicalAccess";
import { DEFAULT_IQ_ERP_URL } from "./config";
import * as crypto from "crypto";
import { getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { assertIqAuthorized } from "./authorization";
import { defineSecret } from "firebase-functions/params";
import {
  runIqLoginProbeHttpA56 as runIqLoginProbe,
} from "./iqLoginProbeHttpA56";

if (!getApps().length) {
  initializeApp();
}

const IQ_CREDENTIALS_KEY = defineSecret("IQ_CREDENTIALS_KEY");


const callableWithIqSecret = {
  secrets: [IQ_CREDENTIALS_KEY],
  invoker: "public" as const,
};

const callableWithIqBrowser = {
  ...callableWithIqSecret,
  timeoutSeconds: 120,
  memory: "2GiB" as const,
  concurrency: 1,
};

const IQ_MODULES = [
  "solicitudes",
  "pagos",
  "conciliacion",
  "reportes",
  "clientes",
  "materialidad",
] as const;

type IqModule = (typeof IQ_MODULES)[number];

type AuthInfo = {
  uid: string;
  role: string;
  rootId: string;
};

function getDb() {
  return getFirestore();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function readString(data: Record<string, unknown>, key: string): string {
  const value = data[key];

  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function normalizeErpUrl(value: string): string {
  const raw = value.trim() || DEFAULT_IQ_ERP_URL;

  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.host}`;
  } catch {
    throw new HttpsError("invalid-argument", "URL ERP IQ invalida.");
  }
}

function readBoolean(data: Record<string, unknown>, key: string, fallback = false): boolean {
  const value = data[key];

  if (typeof value !== "boolean") {
    return fallback;
  }

  return value;
}

function toMillis(value: unknown): number | null {
  if (!value) {
    return null;
  }

  const candidate = value as { toMillis?: () => number };

  if (typeof candidate.toMillis === "function") {
    return candidate.toMillis();
  }

  return null;
}

function decryptSecret(data: Record<string, unknown>): string {
  const ciphertext = String(data.passwordCiphertext ?? "");
  const iv = String(data.passwordIv ?? "");
  const tag = String(data.passwordTag ?? "");

  if (!ciphertext || !iv || !tag) {
    throw new HttpsError("failed-precondition", "La cuenta IQ no tiene contrasena configurada.");
  }

  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

function maskUsername(username: string): string {
  const value = username.trim();

  if (value.length <= 3) {
    return "***";
  }

  if (value.includes("@")) {
    const [local, domain] = value.split("@");

    if (!domain) {
      return `${local.slice(0, 2)}***`;
    }

    return `${local.slice(0, 2)}***@${domain}`;
  }

  return `${value.slice(0, 2)}***${value.slice(-1)}`;
}

async function assertAuth(request: { auth?: { uid?: string; token?: Record<string, unknown> } | null }): Promise<AuthInfo> {
  await assertIqAuthorized(request, { allowedRoles: ["superadmin", "admin", "operador"] });
  const uid = request.auth?.uid;

  if (!uid) {
    throw new HttpsError("unauthenticated", "Sesion requerida.");
  }

  const token = request.auth?.token ?? {};
  let role = String(token.role ?? token.userRole ?? "");
  let rootId = String(token.rootId ?? token.root_id ?? "");

  if (!role || !rootId) {
    const userSnap = await getDb().collection("users").doc(uid).get();
    const userData = userSnap.data() ?? {};

    role = role || String(userData.role ?? "");
    rootId = rootId || String(userData.rootId ?? uid);
  }

  return { uid, role, rootId: rootId || uid };
}

async function assertSuperAdmin(request: { auth?: { uid?: string; token?: Record<string, unknown> } | null }): Promise<AuthInfo> {
  const auth = await assertAuth(request);

  if (auth.role !== "superadmin") {
    throw new HttpsError("permission-denied", "Solo superadmin puede administrar IQ.");
  }

  return auth;
}

function assertIqModule(moduleKey: string): asserts moduleKey is IqModule {
  if (!IQ_MODULES.includes(moduleKey as IqModule)) {
    throw new HttpsError("invalid-argument", "Modulo IQ invalido.");
  }
}

function normalizeAllowedModules(value: unknown): Record<IqModule, boolean> {
  const input = asRecord(value);

  return IQ_MODULES.reduce((acc, moduleKey) => {
    acc[moduleKey] = input[moduleKey] === true;
    return acc;
  }, {} as Record<IqModule, boolean>);
}

function getEncryptionKey(): Buffer {
  const raw = IQ_CREDENTIALS_KEY.value();

  if (!raw || raw.trim().length < 16) {
    throw new HttpsError(
      "failed-precondition",
      "IQ_CREDENTIALS_KEY no esta configurada en Functions.",
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
    // fallback to hash below
  }

  return crypto.createHash("sha256").update(trimmed).digest();
}

function encryptSecret(secret: string) {
  const value = secret.trim();

  if (!value) {
    return null;
  }

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    passwordAlgorithm: "aes-256-gcm",
    passwordCiphertext: encrypted.toString("base64"),
    passwordIv: iv.toString("base64"),
    passwordTag: tag.toString("base64"),
    hasPassword: true,
  };
}

function sanitizeProfileForAdmin(id: string, data: FirebaseFirestore.DocumentData) {
  const username = String(data.username ?? "");

  return {
    id,
    alias: String(data.alias ?? ""),
    username,
    usernameMasked: maskUsername(username),
    erpUrl: String(data.erpUrl ?? DEFAULT_IQ_ERP_URL),
    active: data.active === true,
    hasPassword: data.hasPassword === true,
    lastTestAt: toMillis(data.lastTestAt),
    lastTestStatus: data.lastTestStatus ? String(data.lastTestStatus) : null,
    lastTestMessage: data.lastTestMessage ? String(data.lastTestMessage) : null,
    createdAt: toMillis(data.createdAt),
    updatedAt: toMillis(data.updatedAt),
  };
}

function sanitizeAccess(id: string, data: FirebaseFirestore.DocumentData, alias?: string | null) {
  return {
    id,
    pay0UserId: String(data.pay0UserId ?? id),
    iqEnabled: data.iqEnabled === true,
    iqCredentialProfileId: data.iqCredentialProfileId ? String(data.iqCredentialProfileId) : null,
    iqCredentialAlias: alias ?? null,
    allowedModules: normalizeAllowedModules(data.allowedModules),
    active: data.active === true,
    assignedAt: toMillis(data.assignedAt),
    updatedAt: toMillis(data.updatedAt),
  };
}

async function loadProfile(profileId: string, rootId: string) {
  const db = getDb();
  const snap = await db.collection("iqCredentialProfiles").doc(profileId).get();

  if (!snap.exists) {
    throw new HttpsError("not-found", "Cuenta IQ no encontrada.");
  }

  const data = snap.data() ?? {};

  if (String(data.rootId ?? "") !== rootId) {
    throw new HttpsError("permission-denied", "Cuenta IQ fuera de alcance.");
  }

  return { snap, data };
}

export const createIqCredentialProfile = onCall(callableWithIqSecret, async (request) => {
  const auth = await assertSuperAdmin(request);
  const data = asRecord(request.data);

  const alias = readString(data, "alias");
  const username = readString(data, "username");
  const password = readString(data, "password");
  const erpUrl = normalizeErpUrl(readString(data, "erpUrl"));

  if (!alias || !username) {
    throw new HttpsError("invalid-argument", "Alias y usuario IQ son requeridos.");
  }

  const db = getDb();

  const existingSnap = await db
    .collection("iqCredentialProfiles")
    .where("rootId", "==", auth.rootId)
    .get();

  const duplicate = existingSnap.docs.find((doc) => {
    const row = doc.data();
    return row.active === true &&
      String(row.alias ?? "").trim().toLowerCase() === alias.toLowerCase() &&
      String(row.username ?? "").trim().toLowerCase() === username.toLowerCase();
  });

  if (duplicate) {
    throw new HttpsError("already-exists", "Ya existe una cuenta IQ activa con ese alias y usuario.");
  }

  const encrypted = password ? encryptSecret(password) : null;

  const docRef = await db.collection("iqCredentialProfiles").add({
    rootId: auth.rootId,
    alias,
    username,
    erpUrl,
    active: true,
    hasPassword: encrypted?.hasPassword === true,
    ...(encrypted ?? {}),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    createdBy: auth.uid,
    updatedBy: auth.uid,
  });

  const created = await docRef.get();

  return {
    ok: true,
    data: sanitizeProfileForAdmin(created.id, created.data() ?? {}),
  };
});

export const updateIqCredentialProfile = onCall(callableWithIqSecret, async (request) => {
  const auth = await assertSuperAdmin(request);
  const data = asRecord(request.data);
  const profileId = readString(data, "profileId");

  if (!profileId) {
    throw new HttpsError("invalid-argument", "profileId requerido.");
  }

  const current = await loadProfile(profileId, auth.rootId);
  if (current.data.deletedAt) {
    throw new HttpsError("failed-precondition", "La cuenta IQ fue eliminada.");
  }
  const patch: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: auth.uid,
  };

  const alias = readString(data, "alias");
  const username = readString(data, "username");
  const password = readString(data, "password");
  const erpUrl = normalizeErpUrl(readString(data, "erpUrl"));

  if (alias) {
    patch.alias = alias;
  }

  if (username) {
    patch.username = username;
  }

  if (typeof data.active === "boolean") {
    patch.active = data.active;
  }

  if (erpUrl) {
    patch.erpUrl = erpUrl;
  }

  if (password) {
    const encrypted = encryptSecret(password);
    Object.assign(patch, encrypted);
  }

  await current.snap.ref.set(patch, { merge: true });
  const updated = await current.snap.ref.get();

  return {
    ok: true,
    data: sanitizeProfileForAdmin(updated.id, updated.data() ?? {}),
  };
});

export const listIqCredentialProfiles = onCall(callableWithIqSecret, async (request) => {
  const auth = await assertSuperAdmin(request);
  const db = getDb();

  const snap = await db
    .collection("iqCredentialProfiles")
    .where("rootId", "==", auth.rootId)
    .get();

  return {
    ok: true,
    data: snap.docs
      .filter((doc) => !doc.data().deletedAt)
      .map((doc) => sanitizeProfileForAdmin(doc.id, doc.data()))
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)),
  };
});

export const deactivateIqCredentialProfile = onCall(callableWithIqSecret, async (request) => {
  const auth = await assertSuperAdmin(request);
  const data = asRecord(request.data);
  const profileId = readString(data, "profileId");

  if (!profileId) {
    throw new HttpsError("invalid-argument", "profileId requerido.");
  }

  const current = await loadProfile(profileId, auth.rootId);

  await current.snap.ref.set(
    {
      active: false,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: auth.uid,
    },
    { merge: true },
  );

  return { ok: true, data: null };
});

export const deleteIqCredentialProfile = onCall(callableWithIqSecret, async (request) => {
  const auth = await assertSuperAdmin(request);
  const profileId = readString(asRecord(request.data), "profileId");

  if (!profileId) {
    throw new HttpsError("invalid-argument", "profileId requerido.");
  }

  const current = await loadProfile(profileId, auth.rootId);
  if (current.data.deletedAt) {
    return { ok: true, data: null };
  }

  await current.snap.ref.update({
    active: false,
    deletedAt: FieldValue.serverTimestamp(),
    deletedBy: auth.uid,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: auth.uid,
  });

  return { ok: true, data: null };
});

export const updateUserIqAccess = onCall(callableWithIqSecret, async (request) => {
  const auth = await assertSuperAdmin(request);
  const data = asRecord(request.data);

  const pay0UserId = readString(data, "pay0UserId");
  const iqCredentialProfileId = readString(data, "iqCredentialProfileId");
  const iqEnabled = readBoolean(data, "iqEnabled", true);
  const allowedModules = normalizeAllowedModules(data.allowedModules);

  if (!pay0UserId) {
    throw new HttpsError("invalid-argument", "pay0UserId requerido.");
  }

  if (iqEnabled && !iqCredentialProfileId) {
    throw new HttpsError("invalid-argument", "Cuenta IQ requerida.");
  }

  let profileAlias: string | null = null;

  if (iqCredentialProfileId) {
    const profile = await loadProfile(iqCredentialProfileId, auth.rootId);

    if (profile.data.active !== true) {
      throw new HttpsError("failed-precondition", "La cuenta IQ esta inactiva.");
    }

    profileAlias = String(profile.data.alias ?? "");
  }

  const db = getDb();
  const ref = db.collection("iqUserAccess").doc(pay0UserId);

  await ref.set(
    {
      rootId: auth.rootId,
      pay0UserId,
      iqEnabled,
      iqCredentialProfileId: iqCredentialProfileId || null,
      allowedModules,
      active: iqEnabled,
      assignedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      assignedBy: auth.uid,
      updatedBy: auth.uid,
    },
    { merge: true },
  );

  const updated = await ref.get();

  return {
    ok: true,
    data: sanitizeAccess(updated.id, updated.data() ?? {}, profileAlias),
  };
});

export const removeUserIqAccess = onCall(callableWithIqSecret, async (request) => {
  const auth = await assertSuperAdmin(request);
  const data = asRecord(request.data);
  const pay0UserId = readString(data, "pay0UserId");

  if (!pay0UserId) {
    throw new HttpsError("invalid-argument", "pay0UserId requerido.");
  }

  const db = getDb();
  await db.collection("iqUserAccess").doc(pay0UserId).set(
    {
      rootId: auth.rootId,
      pay0UserId,
      iqEnabled: false,
      iqCredentialProfileId: null,
      allowedModules: normalizeAllowedModules({}),
      active: false,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: auth.uid,
    },
    { merge: true },
  );

  return { ok: true, data: null };
});

export const listUserIqAccess = onCall(callableWithIqSecret, async (request) => {
  const auth = await assertSuperAdmin(request);
  const db = getDb();

  const accessSnap = await db
    .collection("iqUserAccess")
    .where("rootId", "==", auth.rootId)
    .orderBy("updatedAt", "desc")
    .get();

  const profileIds = Array.from(
    new Set(
      accessSnap.docs
        .map((doc) => String(doc.data().iqCredentialProfileId ?? ""))
        .filter(Boolean),
    ),
  );

  const aliases = new Map<string, string>();

  await Promise.all(
    profileIds.map(async (profileId) => {
      const profileSnap = await db.collection("iqCredentialProfiles").doc(profileId).get();
      const profileData = profileSnap.data();

      if (profileSnap.exists && profileData?.rootId === auth.rootId) {
        aliases.set(profileId, String(profileData.alias ?? ""));
      }
    }),
  );

  return {
    ok: true,
    data: accessSnap.docs.map((doc) => {
      const data = doc.data();
      const profileId = String(data.iqCredentialProfileId ?? "");
      return sanitizeAccess(doc.id, data, aliases.get(profileId) ?? null);
    }),
  };
});

export const getCurrentUserIqAccess = onCall(callableWithIqSecret, async (request) => {
  const auth = await assertAuth(request);
  const db = getDb();

  const snap = await db.collection("iqUserAccess").doc(auth.uid).get();

  if (!snap.exists) {
    return { ok: true, data: null };
  }

  const data = snap.data() ?? {};

  if (String(data.rootId ?? "") !== auth.rootId) {
    return { ok: true, data: null };
  }

  let alias: string | null = null;
  const profileId = String(data.iqCredentialProfileId ?? "");

  if (profileId) {
    const profileSnap = await db.collection("iqCredentialProfiles").doc(profileId).get();
    const profileData = profileSnap.data();

    if (profileSnap.exists && String(profileData?.rootId ?? "") === auth.rootId) {
      alias = String(profileData?.alias ?? "");
    }
  }

  return {
    ok: true,
    data: sanitizeAccess(snap.id, data, alias),
  };
});

export const resolveAssignedIqCredentialForModule = onCall(callableWithIqSecret, async (request) => {
  const auth = await assertAuth(request);
  const data = asRecord(request.data);
  const moduleKey = readString(data, "module");

  assertIqModule(moduleKey);

  const db = getDb();
  const accessSnap = await db.collection("iqUserAccess").doc(auth.uid).get();

  if (!accessSnap.exists) {
    throw new HttpsError("permission-denied", "Este usuario no tiene cuenta IQ asignada.");
  }

  const access = accessSnap.data() ?? {};

  if (String(access.rootId ?? "") !== auth.rootId || access.active !== true || access.iqEnabled !== true) {
    throw new HttpsError("permission-denied", "Este usuario no tiene acceso IQ activo.");
  }

  const allowedModules = normalizeAllowedModules(access.allowedModules);

  if (allowedModules[moduleKey] !== true) {
    throw new HttpsError("permission-denied", "Este usuario no tiene acceso IQ para este modulo.");
  }

  const profileId = String(access.iqCredentialProfileId ?? "");

  if (!profileId) {
    throw new HttpsError("permission-denied", "Este usuario no tiene cuenta IQ asignada.");
  }

  const profile = await loadProfile(profileId, auth.rootId);

  if (profile.data.active !== true) {
    throw new HttpsError("failed-precondition", "La cuenta IQ asignada esta inactiva.");
  }

  const username = String(profile.data.username ?? "");

  return {
    ok: true,
    data: {
      profileId,
      alias: String(profile.data.alias ?? ""),
      usernameMasked: maskUsername(username),
    erpUrl: String(data.erpUrl ?? DEFAULT_IQ_ERP_URL),
      module: moduleKey,
      hasPassword: profile.data.hasPassword === true,
    },
  };
});

export const testIqConnection = onCall(
  callableWithIqBrowser,
  async (request) => {
    const auth = await assertSuperAdmin(request);
    const data = asRecord(request.data);
    const profileId = readString(data, "profileId");

    if (!profileId) {
      throw new HttpsError("invalid-argument", "profileId requerido.");
    }

    let access = await loadIqCanonicalProfileById({
      profileId,
      rootId: auth.rootId,
      encryptionSecret: IQ_CREDENTIALS_KEY.value(),
      includePassword: true,
    });

    try {
      const session = await openIqCanonicalSession({
        access,
        requiredPermissions: "NONE",
      });

      const now = FieldValue.serverTimestamp();
      const status = "IQ_AUTHENTICATED";
      const message = "Sesion IQ confirmada por HTTP directo.";

      await getDb().collection("iqConnectionTests").add({
        rootId: auth.rootId,
        profileId: access.profileId,
        profileAlias: access.profileAlias,
        erpUrl: access.erpUrl,
        status,
        message,
        mode: "HTTP_DIRECT",
        transport: "HTTP_DIRECT",
        httpAuthEndpoint: "/users/sessions",
        authenticated: true,
        userId: session.userId || null,
        userType: session.userType || null,
        role: session.role || null,
        branchId: session.branchId ?? null,
        branchName: session.branchName || null,
        permissionsCount: session.permissions.length,
        createdAt: now,
        createdBy: auth.uid,
      });

      const profile = await loadProfile(profileId, auth.rootId);
      await profile.snap.ref.set(
        {
          erpUrl: access.erpUrl,
          lastTestAt: now,
          lastTestStatus: status,
          lastTestMessage: message,
          updatedAt: now,
          updatedBy: auth.uid,
        },
        { merge: true },
      );

      return {
        ok: true,
        data: {
          ok: true,
          message,
          mode: "HTTP_DIRECT",
          transport: "HTTP_DIRECT",
          status,
          authenticated: true,
          httpAuthEndpoint: "/users/sessions",
          permissionsCount: session.permissions.length,
          branchName: session.branchName || null,
        },
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "IQ_AUTH_UNKNOWN_ERROR";

      throw new HttpsError(
        "failed-precondition",
        `No se pudo confirmar la sesion IQ: ${message}`,
      );
    } finally {
      access = {
        ...access,
        password: "",
      };
    }
  },
);
