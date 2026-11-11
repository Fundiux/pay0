import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { requireWhatsAppSuperadmin } from "../documentDelivery/whatsappConnectorAuthority";
import { logActivity } from "../../utils/logActivity";
import { MAX_OPERATOR_NUMBERS, countNumberConflicts, normalizeOperatorNumbers } from "./domain";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const COLLECTION = "userOperatorNumbers";
const docId = (rootId: string, userUid: string) => `${rootId}__${userUid}`;

function targetUidOf(value: unknown): string {
  const uid = String(value ?? "").trim();
  if (!/^[A-Za-z0-9_-]{6,128}$/.test(uid)) throw new HttpsError("invalid-argument", "Usuario inválido.");
  return uid;
}

async function assertTargetInRoot(rootId: string, targetUid: string) {
  const user = await db.doc(`users/${targetUid}`).get();
  if (!user.exists || String(user.get("rootId") || user.id) !== rootId) throw new HttpsError("not-found", "Usuario no encontrado.");
}

// Solo el superadmin ve y edita estos números; se guardan sin nombre.
export const getUserOperatorNumbers = onCall({ cors: true, timeoutSeconds: 30, memory: "256MiB" }, async request => {
  const { rootId } = await requireWhatsAppSuperadmin(request);
  const targetUid = targetUidOf(request.data?.targetUid);
  await assertTargetInRoot(rootId, targetUid);
  const snap = await db.doc(`${COLLECTION}/${docId(rootId, targetUid)}`).get();
  return { ok: true, numbers: snap.exists && snap.get("rootId") === rootId ? (snap.get("numbers") as string[] | undefined) ?? [] : [], max: MAX_OPERATOR_NUMBERS };
});

export const saveUserOperatorNumbers = onCall({ cors: true, timeoutSeconds: 30, memory: "256MiB" }, async request => {
  const { uid, rootId } = await requireWhatsAppSuperadmin(request);
  const targetUid = targetUidOf(request.data?.targetUid);
  await assertTargetInRoot(rootId, targetUid);
  const { numbers, invalid, duplicates } = normalizeOperatorNumbers(request.data?.numbers);
  if (invalid) throw new HttpsError("invalid-argument", "Hay números inválidos. Usa 10 dígitos con o sin lada 52.");
  if (numbers.length > MAX_OPERATOR_NUMBERS) throw new HttpsError("invalid-argument", `Máximo ${MAX_OPERATOR_NUMBERS} números por usuario.`);
  const ref = db.doc(`${COLLECTION}/${docId(rootId, targetUid)}`);
  await db.runTransaction(async tx => {
    const others = await tx.get(db.collection(COLLECTION).where("rootId", "==", rootId).limit(500));
    const rows = others.docs.map(doc => ({ userUid: String(doc.get("userUid")), numbers: (doc.get("numbers") as string[] | undefined) ?? [] }));
    if (countNumberConflicts(numbers, rows, targetUid)) throw new HttpsError("failed-precondition", "Uno de los números ya pertenece a otro usuario.");
    tx.set(ref, { rootId, userUid: targetUid, numbers, updatedBy: uid, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
  // La bitácora guarda solo cuántos números, nunca los números.
  await logActivity({
    event: "USUARIO_NUMEROS_ATENCION_ACTUALIZADOS", rootId, actorUid: uid, actorRole: "superadmin",
    referenceId: targetUid, referenceType: "user", description: `Se actualizó la lista de números de atención a clientes (${numbers.length}).`,
  }).catch(() => undefined);
  return { ok: true, numbers, duplicatesRemoved: duplicates };
});
