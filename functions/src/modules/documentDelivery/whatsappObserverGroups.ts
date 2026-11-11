// Finds the synced WhatsApp group an agent may be assigned to observe. No Firestore SDK import so it is testable with a fake.

type Snap = { exists: boolean; get(field: string): unknown };
type QuerySnap = { docs: Snap[] };
export type ObserverGroupDb = {
  doc(path: string): { get(): Promise<Snap> };
  collection(name: string): { where(field: string, op: "==", value: unknown): any };
};

const clean = (value: unknown) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 160);

// The agents' own synced chats come first (same root, same chat id, a live group); the historic connector is only a fallback,
// and only when its row is a valid group of this root. An invalid historic row must never hide a valid agent row.
export async function resolveObservableGroup(db: ObserverGroupDb, rootId: string, chatId: string): Promise<{ name: string; source: "AGENT" | "LEGACY" } | null> {
  const agentRows: QuerySnap = await db.collection("whatsappAgentChats").where("rootId", "==", rootId).where("chatId", "==", chatId).limit(25).get();
  const agentRow = agentRows.docs.find(row => row.exists && row.get("rootId") === rootId && row.get("isGroup") === true && row.get("active") === true);
  if (agentRow) return { name: clean(agentRow.get("name")), source: "AGENT" };
  const legacy = await db.doc(`whatsappQrChats/${encodeURIComponent(chatId)}`).get();
  if (legacy.exists && legacy.get("rootId") === rootId && legacy.get("isGroup") === true) return { name: clean(legacy.get("name")), source: "LEGACY" };
  return null;
}
