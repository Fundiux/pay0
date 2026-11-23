import type { Firestore } from "firebase-admin/firestore";
import type { RequestLookup, StatusSubject } from "./domain";

// Looks the client's request up in the system for a group. It never matches amounts: it only asks whether the client has
// an open request of that kind. NOT_FOUND only when the client has no record at all; UNKNOWN when it cannot be told
// (no client linked to the group, only finished records, or the lookup failed), so the neutral wording is used.

const SOLICITUD_INACTIVE = new Set(["CANCELADO", "CANCELADA", "RECHAZADO", "RECHAZADA", "ELIMINADA", "ELIMINADO", "OMITTED", "OMITIDO"]);
const SOLICITUD_DONE = new Set(["COMPLETADA"]);
const DISPERSION_TERMINAL = new Set([
  "CANCELADA", "CANCELADO", "CANCELACION_APLICADA", "DEVUELTA", "DEVOLUCION_APLICADA", "RECHAZADA", "RECHAZADO",
  "REINTEGRADA", "REINTEGRADO", "RESERVA_LIBERADA", "ELIMINADA", "ELIMINADO", "DELETED",
]);
const DISPERSION_DONE = new Set(["COMPLETADA", "COMPLETADO", "DISPERSADA", "PAGADA", "ENTREGADA", "CONCILIADA"]);
const LOOKUP_LIMIT = 50;

const status = (value: unknown) => String(value ?? "").trim().toUpperCase();

export function classifyRecords(statuses: string[], inactive: ReadonlySet<string>, done: ReadonlySet<string>): RequestLookup {
  const alive = statuses.filter(s => !inactive.has(s));
  if (alive.some(s => !done.has(s))) return "FOUND";
  if (alive.length > 0) return "UNKNOWN";
  return statuses.length === 0 ? "NOT_FOUND" : "UNKNOWN";
}

export async function clienteIdOfGroup(db: Firestore, rootId: string, chatId: string): Promise<string | null> {
  const snap = await db.collection("clientWhatsappGroups").where("rootId", "==", rootId).where("groupChatId", "==", chatId).limit(2).get();
  if (snap.size !== 1) return null;
  const id = String(snap.docs[0].get("clienteId") ?? snap.docs[0].get("clientId") ?? "").trim();
  return id || null;
}

export async function lookupRequestForClient(db: Firestore, rootId: string, clienteId: string | null, subject: StatusSubject): Promise<RequestLookup> {
  if (!clienteId || (subject !== "TRANSFER" && subject !== "INVOICE")) return "UNKNOWN";
  try {
    if (subject === "INVOICE") {
      const snap = await db.collection("solicitudes").where("rootId", "==", rootId).where("clienteId", "==", clienteId).limit(LOOKUP_LIMIT).get();
      return classifyRecords(snap.docs.map(doc => status(doc.get("status"))), SOLICITUD_INACTIVE, SOLICITUD_DONE);
    }
    const snap = await db.collection("clientDispersions").where("rootId", "==", rootId).where("clienteId", "==", clienteId).limit(LOOKUP_LIMIT).get();
    return classifyRecords(snap.docs.map(doc => status(doc.get("status"))), DISPERSION_TERMINAL, DISPERSION_DONE);
  } catch (error) {
    console.error("WHATSAPP_REPLY_LOOKUP_FAILED", { rootId, subject, message: error instanceof Error ? error.message.slice(0, 160) : "UNKNOWN" });
    return "UNKNOWN";
  }
}
