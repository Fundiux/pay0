import { createHash } from "crypto";
import * as admin from "firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { defineString } from "firebase-functions/params";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { assertAuthorized } from "../../utils/authGuard";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const webApiKey = defineString("PAY0_FIREBASE_WEB_API_KEY", { default: "" });
const roles: Array<"superadmin" | "admin" | "operador"> = ["superadmin", "admin", "operador"];
const INVALID_LOGIN = "Usuario o contraseña incorrectos.";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export function normalizeLoginUsername(value: unknown): string {
  const username = String(value ?? "").normalize("NFKC").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{1,30}[a-z0-9]$/.test(username)) {
    throw new HttpsError("invalid-argument", "El usuario debe tener entre 3 y 32 caracteres: letras sin acentos, números, punto, guion o guion bajo; comienza y termina con letra o número.");
  }
  return username;
}

export const loginUsernameRef = (username: string) => db.doc(`authUsernames/${hash(username)}`);
export const defaultLoginUsername = (uid: string) => `usuario-${hash(uid).slice(0, 16)}`;

// A reservation alone cannot authenticate: login also verifies the binding on
// users/{uid}. Retired aliases stay reserved so they cannot impersonate a user.
export async function reserveLoginUsername(uid: string, username: string, rootId: string): Promise<void> {
  const normalized = normalizeLoginUsername(username);
  await db.runTransaction(async tx => {
    const ref = loginUsernameRef(normalized);
    const existing = await tx.get(ref);
    if (existing.exists && (existing.data()?.uid !== uid || existing.data()?.state === "RETIRED")) {
      throw new HttpsError("already-exists", "Ese nombre de usuario no está disponible.");
    }
    tx.set(ref, { uid, rootId, username: normalized, state: "ACTIVE", updatedAt: FieldValue.serverTimestamp(),
      ...(!existing.exists ? { createdAt: FieldValue.serverTimestamp() } : {}) }, { merge: true });
  });
}

export async function createUserWithLogin(input: {
  email: string; password: string; displayName?: string; username?: unknown; rootId: string;
}): Promise<{ user: admin.auth.UserRecord; username: string }> {
  const requested = input.username ? normalizeLoginUsername(input.username) : null;
  let user: admin.auth.UserRecord;
  try {
    user = await admin.auth().createUser({ email: input.email, password: input.password,
      displayName: input.displayName, disabled: false });
  } catch (error: any) {
    if (error?.code === "auth/email-already-exists") throw new HttpsError("already-exists", "El email ya está en uso.");
    throw new HttpsError("invalid-argument", "No se pudo crear la cuenta. Revisa el correo y la contraseña.");
  }
  const username = requested || defaultLoginUsername(user.uid);
  try {
    await reserveLoginUsername(user.uid, username, input.rootId);
  } catch (error) {
    // Only the account created by this call is eligible for compensation.
    await admin.auth().deleteUser(user.uid);
    throw error;
  }
  return { user, username };
}

export async function discardUnpublishedLoginUser(uid: string, username: string): Promise<void> {
  if ((await db.doc(`users/${uid}`).get()).exists) return;
  await admin.auth().deleteUser(uid);
  await db.runTransaction(async tx => {
    const ref = loginUsernameRef(username);
    const snap = await tx.get(ref);
    if (snap.data()?.uid === uid) tx.delete(ref);
  });
}

export async function assignLoginUsername(input: {
  uid: string; rootId: string; username: string; expectedUsername?: string | null;
}): Promise<string> {
  const username = normalizeLoginUsername(input.username);
  await db.runTransaction(async tx => {
    const userRef = db.doc(`users/${input.uid}`);
    const user = await tx.get(userRef);
    const data = user.data();
    if (!data || String(data.rootId || input.uid) !== input.rootId) throw new HttpsError("permission-denied", "Usuario fuera de alcance.");
    const previous = String(data.usernameNormalized || "");
    if (input.expectedUsername !== undefined && previous !== String(input.expectedUsername || "") && previous !== username) {
      throw new HttpsError("failed-precondition", "La identidad cambió desde la preparación; genera otro plan.");
    }
    const ref = loginUsernameRef(username);
    const existing = await tx.get(ref);
    if (existing.exists && (existing.data()?.uid !== input.uid || existing.data()?.state === "RETIRED")) {
      throw new HttpsError("already-exists", "Ese nombre de usuario no está disponible.");
    }
    const previousRef = previous && previous !== username ? loginUsernameRef(previous) : null;
    const previousSnap = previousRef ? await tx.get(previousRef) : null;
    if (previousSnap?.exists && previousSnap.data()?.uid !== input.uid) throw new HttpsError("failed-precondition", "La identidad anterior requiere revisión.");
    tx.set(ref, { uid: input.uid, rootId: input.rootId, username, state: "ACTIVE", updatedAt: FieldValue.serverTimestamp(),
      ...(!existing.exists ? { createdAt: FieldValue.serverTimestamp() } : {}) }, { merge: true });
    tx.update(userRef, { username, usernameNormalized: username, usernameUpdatedAt: FieldValue.serverTimestamp() });
    if (previousRef && previousSnap?.exists) tx.update(previousRef, { state: "RETIRED", updatedAt: FieldValue.serverTimestamp() });
  });
  return username;
}

export async function consumeUsernameLoginAttempt(username: string, ip: string, now = Date.now()): Promise<void> {
  const windowMs = 15 * 60_000;
  const buckets = [
    { key: `ip:${ip}`, limit: 60 },
    { key: `username:${username}`, limit: 20 },
  ].map(bucket => ({ ...bucket, ref: db.doc(`authLoginLimits/${hash(bucket.key)}`) }));
  await db.runTransaction(async tx => {
    const snapshots = await tx.getAll(...buckets.map(bucket => bucket.ref));
    const counts = snapshots.map(snap => {
      const data = snap.data();
      return data && now - Number(data.windowStartedAt) < windowMs ? Number(data.count || 0) : 0;
    });
    if (buckets.some((bucket, i) => counts[i] >= bucket.limit)) {
      throw new HttpsError("resource-exhausted", "Demasiados intentos. Espera unos minutos e inténtalo de nuevo.");
    }
    buckets.forEach((bucket, i) => tx.set(bucket.ref, {
      count: counts[i] + 1,
      windowStartedAt: counts[i] ? snapshots[i].data()!.windowStartedAt : now,
      expiresAt: Timestamp.fromMillis(now + windowMs * 2),
    }));
  });
}

function passwordEndpoint(): string {
  const emulator = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  if (emulator) {
    if (!/^127\.0\.0\.1:\d+$/.test(emulator) || !String(process.env.GCLOUD_PROJECT || "").startsWith("demo-")) {
      throw new HttpsError("unavailable", "Entorno de autenticación local inválido.");
    }
    return `http://${emulator}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=local-test-only`;
  }
  const key = webApiKey.value();
  if (!key) throw new HttpsError("unavailable", "El acceso con usuario no está disponible temporalmente. Puedes ingresar con tu correo.");
  return `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(key)}`;
}

export async function authenticateLoginUsername(request: any): Promise<{ customToken: string }> {
  const rawUsername = String(request.data?.username ?? "").slice(0, 128);
  const password = typeof request.data?.password === "string" ? request.data.password : "";
  const ip = String(request.rawRequest?.ip || request.rawRequest?.socket?.remoteAddress || "unknown").slice(0, 128);
  await consumeUsernameLoginAttempt(rawUsername.normalize("NFKC").trim().toLowerCase(), ip);
  let username: string;
  try { username = normalizeLoginUsername(rawUsername); } catch { throw new HttpsError("unauthenticated", INVALID_LOGIN); }
  if (!password || password.length > 4096) throw new HttpsError("unauthenticated", INVALID_LOGIN);
  const endpoint = passwordEndpoint();
  let uid = "";
  let email = `unavailable-${hash(username).slice(0, 24)}@login.invalid`;
  let eligible = false;
  try {
    const binding = (await loginUsernameRef(username).get()).data();
    if (binding?.state === "ACTIVE" && typeof binding.uid === "string") {
      const [account, profileSnap] = await Promise.all([admin.auth().getUser(binding.uid), db.doc(`users/${binding.uid}`).get()]);
      const profile = profileSnap.data();
      if (profile?.usernameNormalized === username && String(profile.rootId || binding.uid) === binding.rootId &&
          !account.disabled && account.email && !account.multiFactor?.enrolledFactors?.length) {
        assertAuthorized({ uid: account.uid }, profile, { allowedRoles: roles });
        uid = account.uid;
        email = account.email; // Authoritative Auth email, never the writable profile email.
        eligible = true;
      }
    }
  } catch { /* The same credential error covers missing/disabled/unavailable identities. */ }
  let result: any;
  try {
    // Always make the same Auth verification request, including unknown aliases.
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }), signal: AbortSignal.timeout(10_000) });
    result = await response.json();
    if (!response.ok || !eligible || result.localId !== uid || !result.idToken || result.mfaPendingCredential) {
      throw new Error("Credential verification failed");
    }
  } catch { throw new HttpsError("unauthenticated", INVALID_LOGIN); }
  // Recheck both records after password verification; never return a token for
  // an alias reassigned/retired or a profile disabled while the request ran.
  const [binding, profile] = await Promise.all([loginUsernameRef(username).get(), db.doc(`users/${uid}`).get()]);
  try {
    if (binding.data()?.uid !== uid || binding.data()?.state !== "ACTIVE" || profile.data()?.usernameNormalized !== username) throw new Error("Identity changed");
    assertAuthorized({ uid }, profile.data(), { allowedRoles: roles });
  } catch { throw new HttpsError("unauthenticated", INVALID_LOGIN); }
  try { return { customToken: await admin.auth().createCustomToken(uid) }; }
  catch { throw new HttpsError("unavailable", "El acceso con usuario no está disponible temporalmente. Puedes ingresar con tu correo."); }
}

export const loginWithUsername = onCall(
  { region: "us-central1", cors: true, timeoutSeconds: 30, memory: "256MiB", maxInstances: 10 },
  authenticateLoginUsername,
);

export const setMyUsername = onCall(
  { region: "us-central1", cors: true, timeoutSeconds: 30, memory: "256MiB" },
  async request => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Inicia sesión.");
    const profile = (await db.doc(`users/${uid}`).get()).data();
    assertAuthorized(request.auth, profile, { allowedRoles: roles });
    const age = Date.now() / 1000 - Number(request.auth?.token?.auth_time || 0);
    if (age < -60 || age > 300) throw new HttpsError("failed-precondition", "Confirma tu contraseña actual para cambiar el usuario.");
    const username = await assignLoginUsername({ uid, rootId: String(profile?.rootId || uid), username: String(request.data?.username || "") });
    return { ok: true, username };
  },
);
