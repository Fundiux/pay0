import { createHash } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import * as admin from "firebase-admin";
import { LESSONS } from "./lessons";

// Stage 2 of Hugo's learning: per-group proposals. Three lessons of the same kind in the same group become a proposal;
// only the owner approves it, with the guidance text that Hugo may later follow in that group (simulated for 3 days first).
// Nothing here sends anything to a client.

export const PLAYBOOK = "whatsappAgentPlaybooks";
export const PROPOSAL_THRESHOLD = 3;
export const SIMULATION_MS = 3 * 24 * 60 * 60 * 1000;
export const GUIDANCE_MIN = 10;
export const GUIDANCE_MAX = 400;

export type LessonRow = { type: string; kind: string; subject: string | null; category: string | null; phrase: string | null; reason: string | null; chatId: string; groupName: string };
export type Proposal = {
  id: string; chatId: string; groupName: string; signature: string; type: string; kind: string; subject: string | null; category: string | null;
  evidenceCount: number; examples: string[]; suggestedGuidance: string;
};

export const signatureOf = (lesson: Pick<LessonRow, "type" | "kind" | "subject" | "category">) => `${lesson.type}|${lesson.kind || "-"}|${lesson.subject || "-"}|${lesson.category || "-"}`;
export const proposalId = (rootId: string, chatId: string, signature: string) => "pb_" + createHash("sha256").update(`${rootId}|${chatId}|${signature}`).digest("hex").slice(0, 40);

const SUBJECT_TEXT: Record<string, string> = { TRANSFER: "su transferencia", INVOICE: "su factura" };
const CATEGORY_TEXT: Record<string, string> = {
  WRONG_FACT: "Hugo dio un dato incorrecto; antes de afirmar algo debe confirmarlo en el sistema y, si no lo tiene, decir que lo va a validar.",
  TONE: "Hugo respondió con un tono que no le gustó a este cliente; ajustar el trato a como le habla el equipo.",
  NOT_NEEDED: "Hugo respondió cuando no hacía falta; en este grupo debe esperar más a que el equipo conteste.",
  TOO_LATE: "Hugo respondió tarde; en este grupo debe avisar al equipo más pronto.",
  OTHER: "Una persona tuvo que corregir a Hugo en este grupo.",
};

/** A starting text for the owner to edit. Never contains amounts, times or internal terms. */
export function suggestGuidance(type: string, kind: string, subject: string | null, category: string | null): string {
  if (type === "CORRECTION") return CATEGORY_TEXT[category || "OTHER"] || CATEGORY_TEXT.OTHER;
  const about = subject && SUBJECT_TEXT[subject] ? ` por ${SUBJECT_TEXT[subject]}` : "";
  return kind === "STATUS_INQUIRY"
    ? `Este cliente pregunta${about} y nadie le contesta a tiempo; Hugo debe avisar al equipo y atender con la información del sistema.`
    : "Este cliente hace consultas que nadie le contesta a tiempo; Hugo debe avisar al equipo y responder con prudencia.";
}

/** Groups lessons per group and kind; every group of three or more is a proposal. Pure. */
export function proposeEntries(rootId: string, lessons: LessonRow[]): Proposal[] {
  const buckets = new Map<string, LessonRow[]>();
  for (const lesson of lessons) {
    if (!lesson.chatId) continue;
    const key = `${lesson.chatId}\u0000${signatureOf(lesson)}`;
    buckets.set(key, [...(buckets.get(key) || []), lesson]);
  }
  const proposals: Proposal[] = [];
  for (const rows of buckets.values()) {
    if (rows.length < PROPOSAL_THRESHOLD) continue;
    const first = rows[0], signature = signatureOf(first);
    const examples = [...new Set(rows.map(row => (row.type === "CORRECTION" ? row.reason : row.phrase) || "").filter(Boolean))].slice(0, 3);
    proposals.push({
      id: proposalId(rootId, first.chatId, signature), chatId: first.chatId, groupName: first.groupName, signature, type: first.type, kind: first.kind,
      subject: first.subject, category: first.category, evidenceCount: rows.length, examples, suggestedGuidance: suggestGuidance(first.type, first.kind, first.subject, first.category),
    });
  }
  return proposals;
}

/**
 * Guardrails for any text Hugo may follow or say to a client in a group. Until the calculator and its format exist,
 * no amount or number is allowed at all, and nothing may reveal who validates or how the money is split.
 * Returns the problem in Spanish, or null when the text is acceptable.
 */
export function validateGuidance(text: string): string | null {
  const value = String(text ?? "").replace(/\s+/g, " ").trim();
  if (value.length < GUIDANCE_MIN) return "El texto es muy corto.";
  if (value.length > GUIDANCE_MAX) return `El texto no puede pasar de ${GUIDANCE_MAX} caracteres.`;
  if (/\d|\$|%|\b(pesos|mxn|usd|dolares|dólares)\b/i.test(value)) return "No se permiten cifras ni montos: los números a clientes se activarán cuando exista la calculadora.";
  if (/pay\s*-?\s*0|despacho|\biq\b|\bfolio\b/i.test(value)) return "No debe mencionar PAY0, despachos, IQ ni folios internos.";
  if (/(valid\w*|consult\w*|confirm\w*|autoriz\w*)\s+(con|ante)\s+(alguien|otra|otro|un tercero|terceros|proveedor|la empresa|el banco)|otra empresa|un tercero/i.test(value)) return "No debe decir que algo se valida o se consulta con alguien más.";
  if (/prometemos|garantizamos|a más tardar|en \w+ (minutos|horas)|hoy mismo|mañana/i.test(value)) return "No debe prometer tiempos ni fechas.";
  return null;
}

/** Rebuilds the proposals of one group from its lessons. Existing entries keep their decision; a pending one only refreshes its evidence. */
export async function refreshPlaybookProposals(db: Firestore, rootId: string, chatId: string): Promise<number> {
  const snap = await db.collection(LESSONS).where("rootId", "==", rootId).where("chatId", "==", chatId).limit(500).get();
  const rows: LessonRow[] = snap.docs.map(doc => ({
    type: String(doc.get("type") ?? ""), kind: String(doc.get("kind") ?? ""), subject: doc.get("subject") || null, category: doc.get("category") || null,
    phrase: doc.get("phrase") || null, reason: doc.get("reason") || null, chatId, groupName: String(doc.get("groupName") ?? ""),
  }));
  const proposals = proposeEntries(rootId, rows);
  let created = 0;
  for (const proposal of proposals) {
    const ref = db.doc(`${PLAYBOOK}/${proposal.id}`);
    const known = await ref.get();
    const FieldValue = admin.firestore.FieldValue;
    if (!known.exists) {
      await ref.create({ rootId, ...proposal, status: "PROPOSED", guidance: "", createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }).then(() => { created++; }).catch(() => undefined);
    } else if (known.get("status") === "PROPOSED" && Number(known.get("evidenceCount")) !== proposal.evidenceCount) {
      await ref.update({ evidenceCount: proposal.evidenceCount, examples: proposal.examples, updatedAt: FieldValue.serverTimestamp() });
    }
  }
  return created;
}
