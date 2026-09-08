import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { assertAuthorized } from "../../utils/authGuard";

const db = getFirestore();

function requireAuth(request: any): string {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "No autenticado.");
  return uid;
}
export const listUsers = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    try {
      const uid = requireAuth(request);

      const meSnap = await db.doc(`users/${uid}`).get();
      const me = meSnap.data() || {};
      assertAuthorized(request.auth, me, { allowedRoles: ["superadmin", "admin"], requiredModule: "usuarios", requiredAction: "view" });
      const myRole = String(me.role || me.supervisorRole || "");
      const myRootId = (me.rootId as string) || uid;

      if (!["superadmin","admin"].includes(String(myRole))) {
        throw new HttpsError("permission-denied", "No autorizado.");
      }

      const data = request.data || {};
      let targetRootId = data.rootId ? String(data.rootId) : myRootId;

      // admin: solo su root
      if (String(myRole) !== "superadmin" && targetRootId !== myRootId) {
        throw new HttpsError("permission-denied", "No autorizado.");
      }

      const qs = await db.collection("users").where("rootId", "==", targetRootId).get();
      const users = qs.docs.map(d => {
        const x: any = d.data() || {};
        return {
          uid: d.id,
          email: x.email ?? null,
          displayName: x.displayName ?? x.nombreUsuario ?? null,
          phone: x.phone ?? null,
          role: x.role ?? null,
          rootId: x.rootId ?? null,
          parentUserId: x.parentUserId ?? null,
          isActive: x.active ?? x.isActive ?? true,
          isDeleted: x.isDeleted ?? false,
          userNumber: x.userNumber ?? x.numeroUsuario ?? x.sequenceNumber ?? null,
          numeroUsuario: x.numeroUsuario ?? x.userNumber ?? x.sequenceNumber ?? null,
          sequenceNumber: x.sequenceNumber ?? x.userNumber ?? x.numeroUsuario ?? null,
        };
      });

      return { ok: true, users };
    } catch (e: any) {
      // si ya es HttpsError lo respetamos
      if (e?.httpErrorCode?.status) throw e;
      console.error("[listUsers] ERROR:", e);
      throw new HttpsError("internal", e?.message || "INTERNAL");
    }
  }
);


