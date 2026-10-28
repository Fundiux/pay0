import type { Firestore } from "firebase-admin/firestore";
import type { HugoGeneralReadToolName } from "./contract";
import { findPagos, findPeople, findSolicitudes, getSolicitudDetail, resolveSolicitudForDetail } from "./search";
import type { RawRow, ReadSnapshot } from "./search";
import { validateHugoReadInput } from "./validate";

type BaseCollection = "solicitudes" | "pagos" | "users" | "clients" | "companies";
export type LoadSnapshotOptions = { collections?: BaseCollection[]; solicitudIds?: string[] };
const BASE: BaseCollection[] = ["solicitudes", "pagos", "users", "clients", "companies"];
const safeId = (value: unknown) => typeof value === "string" && !!value && value.length <= 160 && !value.includes("/");

async function rootRows(query: any, rootId: string): Promise<RawRow[]> {
  const snap = await query.get();
  return snap.docs.map((doc: any) => {
    const row = doc.data() || {};
    // Fail closed: a row from another root must never reach the voice model.
    if (row.rootId !== rootId) throw Error("HUGO_READ_ROOT_MISMATCH");
    return { ...row, id: doc.id };
  });
}

// Every read is scoped by the server-resolved rootId. uploads and pagoAplicaciones
// are only read for explicit solicitud ids (detail view).
export async function loadReadSnapshot(db: Firestore, rootId: string, opts: LoadSnapshotOptions = {}): Promise<ReadSnapshot> {
  if (!safeId(rootId)) throw Error("HUGO_READ_ROOT_MISMATCH");
  const wanted = new Set(opts.collections || BASE);
  const read = (name: BaseCollection) => wanted.has(name) ? rootRows(db.collection(name).where("rootId", "==", rootId), rootId) : Promise.resolve([] as RawRow[]);
  const ids = [...new Set(opts.solicitudIds || [])];
  if (ids.some(id => !safeId(id)) || ids.length > 10) throw Error("HUGO_TOOL_INVALID_INPUT");
  const related = (collection: string) => Promise.all(ids.map(id => rootRows(db.collection(collection).where("rootId", "==", rootId).where("solicitudId", "==", id), rootId))).then(rows => rows.flat());
  const [solicitudes, pagos, users, clients, companies, uploads, aplicaciones] = await Promise.all([
    read("solicitudes"), read("pagos"), read("users"), read("clients"), read("companies"),
    ids.length ? related("uploads") : Promise.resolve(undefined), ids.length ? related("pagoAplicaciones") : Promise.resolve(undefined),
  ]);
  return { solicitudes, pagos, users, clients, companies, ...(uploads ? { uploads } : {}), ...(aplicaciones ? { aplicaciones } : {}), now: new Date() };
}

const PEOPLE_COLLECTIONS: Record<string, BaseCollection[]> = { USUARIO: ["users"], CLIENTE: ["clients"], EMPRESA: ["companies"], TODOS: ["users", "clients", "companies"] };

export async function runHugoReadTool(db: Firestore, rootId: string, name: HugoGeneralReadToolName, rawInput: unknown) {
  const input = validateHugoReadInput(name, rawInput);
  if (name === "findSolicitudes") return findSolicitudes(await loadReadSnapshot(db, rootId, { collections: ["solicitudes", "users", "clients", "companies"] }), input);
  if (name === "findPagos") return findPagos(await loadReadSnapshot(db, rootId, { collections: ["pagos", "users", "clients", "companies"] }), input);
  if (name === "findPeople") return findPeople(await loadReadSnapshot(db, rootId, { collections: PEOPLE_COLLECTIONS[input.tipo || "TODOS"] }), input);
  const base = await loadReadSnapshot(db, rootId, { collections: ["solicitudes", "pagos", "users", "clients", "companies"] });
  const target = resolveSolicitudForDetail(base, input).row;
  if (!target) return getSolicitudDetail(base, input);
  const related = await loadReadSnapshot(db, rootId, { collections: [], solicitudIds: [target.id] });
  return getSolicitudDetail({ ...base, uploads: related.uploads, aplicaciones: related.aplicaciones }, input);
}
