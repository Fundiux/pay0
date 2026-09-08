import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { assertAuthorized, getUserRole } from "../../utils/authGuard";
import { logActivityBatch } from "../../utils/logActivity";

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();

function requireAuth(request: any) {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesion.");
  }

  return request.auth.uid as string;
}

async function getMyUser(uid: string) {
  const a = await db.doc(`users/${uid}`).get();
  if (a.exists) return a.data() as any;

  const b = await db.doc(`usuarios/${uid}`).get();
  if (b.exists) return b.data() as any;

  return null;
}

function requireRole(user: any, roles: Array<"superadmin" | "admin" | "operador">) {
  const role = getUserRole(user);

  if (!roles.includes(role as any)) {
    throw new HttpsError("permission-denied", "No autorizado.");
  }

  return role;
}

export const repairUserNumbersByRootCallable = onCall(
  { cors: true, timeoutSeconds: 120, memory: "512MiB" },
  async (request) => {
    const uid = requireAuth(request);
    const caller = await getMyUser(uid);
    assertAuthorized(request.auth, caller, { allowedRoles: ["superadmin"], requiredModule: "usuarios", requiredAction: "permissions" });
    const role = requireRole(caller, ["superadmin"]);
    const rootId = String((caller as any)?.rootId || uid);

    const usersById = new Map<
      string,
      FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot
    >();

    const usersSnap = await db
      .collection("users")
      .where("rootId", "==", rootId)
      .get();

    usersSnap.docs.forEach((doc) => usersById.set(doc.id, doc));

    const callerSnap = await db.doc(`users/${uid}`).get();
    if (callerSnap.exists) {
      usersById.set(uid, callerSnap);
    }

    const users = Array.from(usersById.values()).map((doc: any) => {
      const data: any = doc.data() || {};

      return {
        ref: doc.ref,
        uid: doc.id,
        data,
        role: String(data.role || data.supervisorRole || ""),
        name: String(data.displayName || data.nombreUsuario || data.username || data.email || doc.id),
      };
    });

    users.sort((a, b) => {
      if (a.uid === uid) return -1;
      if (b.uid === uid) return 1;

      const rank = (r: string) => {
        const rr = String(r || "").toLowerCase();

        if (rr === "superadmin") return 0;
        if (rr === "admin") return 1;
        if (rr === "operador") return 2;

        return 3;
      };

      const roleDiff = rank(a.role) - rank(b.role);
      if (roleDiff !== 0) return roleDiff;

      return a.name.localeCompare(b.name);
    });

    const batch = db.batch();
    let count = 0;

    for (const item of users) {
      count += 1;

      batch.set(
        item.ref,
        {
          rootId,
          userNumber: count,
          numeroUsuario: count,
          sequenceNumber: count,
          sequenceScope: `users:${rootId}`,
          sequenceCounterPath: `counters/${rootId}/sequences/users__global`,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    const counterRef = db.doc(`counters/${rootId}/sequences/users__global`);

    batch.set(
      counterRef,
      {
        current: count,
        scope: "users",
        scopeKey: "global",
        rootId,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    logActivityBatch(batch, db, {
      event: "USER_NUMBERS_REPAIRED",
      rootId,
      adminId: rootId,
      actorUid: uid,
      actorUsername: String((caller as any)?.username || ""),
      actorRole: role,
      entityType: "users",
      entityId: "users",
      referenceId: "users",
      referenceType: "users",
      description: `Numeracion canonica de usuarios reparada. Usuarios numerados: ${count}.`,
      createdBy: uid,
    });

    await batch.commit();

    return {
      ok: true,
      totalUsers: count,
      repaired: count,
      current: count,
    };
  }
);
