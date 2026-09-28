import { createHash } from "crypto";
import * as admin from "firebase-admin";
import { FieldPath } from "firebase-admin/firestore";
import { assignLoginUsername, defaultLoginUsername, loginUsernameRef, normalizeLoginUsername } from "./loginIdentity";

export type UsernameMigrationPlan = {
  version: 1; projectId: string; rootId: string; createdAt: string;
  assignments: Array<{ uid: string; username: string; expectedUsername: string | null }>;
  skipped: number; nextCursor: string | null;
};

function suggestedUsername(data: any, uid: string): string {
  const source = String(data.username || data.nombreUsuario || data.displayName || "")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim()
    .replace(/\s+/g, "-").replace(/[^a-z0-9._-]/g, "").slice(0, 32)
    .replace(/^[._-]+|[._-]+$/g, "");
  try { return normalizeLoginUsername(source); } catch { return defaultLoginUsername(uid); }
}

export async function planUsernameMigration(input: {
  projectId: string; rootId: string; limit: number; cursor?: string;
}, auth: admin.auth.Auth = admin.auth()): Promise<UsernameMigrationPlan> {
  if (!input.rootId || !input.projectId || !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
    throw new Error("Specify project, root and a limit between 1 and 100.");
  }
  const db = admin.firestore();
  const root = !input.cursor ? await db.doc(`users/${input.rootId}`).get() : null;
  const legacyRoot = root?.exists && !root.data()?.rootId ? root : null;
  const pageSize = input.limit - (legacyRoot ? 1 : 0);
  if (pageSize < 1) throw new Error("Use a limit of at least 2 when migrating a legacy root profile.");
  let query = db.collection("users").where("rootId", "==", input.rootId).orderBy(FieldPath.documentId()).limit(pageSize + 1);
  if (input.cursor) query = query.startAfter(input.cursor);
  const snapshot = await query.get();
  const rows: FirebaseFirestore.DocumentSnapshot[] = snapshot.docs.slice(0, pageSize);
  // A legacy root profile may predate rootId. Include it in the first bounded page.
  if (legacyRoot) rows.push(legacyRoot);
  const plan: UsernameMigrationPlan = { version: 1, projectId: input.projectId, rootId: input.rootId,
    createdAt: new Date().toISOString(), assignments: [], skipped: 0,
    nextCursor: snapshot.docs.length > pageSize ? snapshot.docs[pageSize - 1].id : null };
  const planned = new Map<string, string>();
  for (const row of rows) {
    const data = row.data()!;
    let account: admin.auth.UserRecord;
    try { account = await auth.getUser(row.id); }
    catch (error: any) {
      if (error?.code === "auth/user-not-found") { plan.skipped++; continue; }
      throw Object.assign(new Error("Could not verify Auth identities; no migration was applied."), { code: String(error?.code || "AUTH_LOOKUP_FAILED") });
    }
    if (!account.email || !account.providerData.some(provider => provider.providerId === "password")) { plan.skipped++; continue; }
    let username = data.usernameNormalized || suggestedUsername(data, row.id);
    try { username = normalizeLoginUsername(username); } catch { username = suggestedUsername(data, row.id); }
    const available = async (candidate: string) => {
      if (planned.has(candidate) && planned.get(candidate) !== row.id) return false;
      const reservation = (await loginUsernameRef(candidate).get()).data();
      return !reservation || (reservation.uid === row.id && reservation.state !== "RETIRED");
    };
    if (!await available(username)) {
      const suffix = createHash("sha256").update(row.id).digest("hex").slice(0, 8);
      username = `${username.slice(0, 23).replace(/[._-]+$/g, "")}-${suffix}`;
    }
    if (!await available(username)) username = defaultLoginUsername(row.id);
    if (!await available(username)) throw new Error("A username collision requires a new bounded migration plan.");
    planned.set(username, row.id);
    plan.assignments.push({ uid: row.id, username, expectedUsername: data.usernameNormalized || null });
  }
  return plan;
}

export async function applyUsernameMigration(plan: UsernameMigrationPlan, expectedProject: string, expectedRoot: string, auth: admin.auth.Auth = admin.auth()): Promise<number> {
  if (plan.version !== 1 || plan.projectId !== expectedProject || plan.rootId !== expectedRoot ||
      !Array.isArray(plan.assignments) || plan.assignments.length > 100) throw new Error("Migration scope mismatch.");
  if (new Set(plan.assignments.map(row => row.uid)).size !== plan.assignments.length) throw new Error("Duplicate user in migration plan.");
  // Validate the whole page before any writes. Each assignment also rechecks
  // ownership, expected identity and unique reservation inside its transaction.
  for (const row of plan.assignments) {
    normalizeLoginUsername(row.username);
    const [account, profile] = await Promise.all([auth.getUser(row.uid), admin.firestore().doc(`users/${row.uid}`).get()]);
    if (!account.email || !account.providerData.some(provider => provider.providerId === "password") ||
        !profile.exists || String(profile.data()?.rootId || row.uid) !== expectedRoot) throw new Error("Migration identity changed; prepare a new plan.");
  }
  for (const row of plan.assignments) await assignLoginUsername({ ...row, rootId: expectedRoot });
  return plan.assignments.length;
}
