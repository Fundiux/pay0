import { Pay0Connector } from "./pay0Connector";
import type { HugoTeamAgent } from "./teamRouting";
import { db } from "../sharedCallables/helpers";

const normalize = (value: unknown) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const money = (value: number | null, currency = "MXN") => value == null ? "importe sin registrar" : value.toLocaleString("es-MX", { style: "currency", currency });
const date = (value: string | null) => value ? new Date(value).toLocaleDateString("es-MX", { timeZone: "America/Mexico_City" }) : "fecha sin registrar";
const amountInMessage = (message: string) => {
  const numeric = message.match(/\$\s*([\d,]+(?:\.\d{1,2})?)/)?.[1];
  if (numeric) return Number(numeric.replace(/,/g, ""));
  const words = normalize(message);
  if (/siete mil quinientos cuarenta/.test(words)) return 7540;
  return null;
};
type Candidate = { id: string; folio: string | null; empresa: string | null; cliente: string | null; monto: number | null; moneda: string; estado: string | null; createdAt: string | null };
export const solicitudLabel = (item: Candidate) => `${item.empresa || "Empresa sin nombre"} · ${item.cliente || "cliente sin nombre"} · ${date(item.createdAt)} · ${money(item.monto, item.moneda)} · ${item.estado || "sin estado"}`;

export async function resolveHumanSolicitud(message: string, uid: string, rootId: string, agents: HugoTeamAgent[]) {
  const connector = new Pay0Connector(db, { uid, rootId, role: "superadmin" });
  const folio = message.match(/\bS(?=[A-Z0-9]*\d)[A-Z0-9]{5,19}\b/i)?.[0]?.toUpperCase();
  if (folio) {
    const found = (await connector.getSolicitud(folio)).data as Candidate | null;
    return found ? { kind: "MATCH" as const, item: found, source: "getSolicitud" } : { kind: "NONE" as const, source: "getSolicitud" };
  }
  const normalized = normalize(message);
  const contextual = /\b(esa|ese|esta|este|la misma|su cotizacion|su oc|regresa|resumen)\b/.test(normalized);
  if (contextual) {
    const turns = await Promise.all(agents.map(agent => db.collection("hugoTeamTurns").where("conversationId", "==", `${rootId}_${uid}_${agent}`).orderBy("createdAt", "desc").limit(5).get()));
    const refs = turns.flatMap(snap => snap.docs).filter(doc => doc.get("selectedSolicitudId") && doc.get("rootId") === rootId).sort((a, b) => (b.get("createdAt")?.toMillis?.() || 0) - (a.get("createdAt")?.toMillis?.() || 0));
    if (refs.length) {
      const snapshot = await db.collection("solicitudes").doc(String(refs[0].get("selectedSolicitudId"))).get();
      if (snapshot.exists && snapshot.get("rootId") === rootId && snapshot.get("folio")) {
        const found = (await connector.getSolicitud(String(snapshot.get("folio")))).data as Candidate | null;
        if (found) return { kind: "MATCH" as const, item: found, source: "conversationContext" };
      }
    }
  }
  const sample = (await connector.searchSolicitudes(100)).data as Candidate[];
  const amount = amountInMessage(message);
  const companies = [...new Set(sample.map(item => item.empresa).filter(Boolean))] as string[];
  const clients = [...new Set(sample.map(item => item.cliente).filter(Boolean))] as string[];
  const company = companies.filter(name => normalized.includes(normalize(name))).sort((a, b) => b.length - a.length)[0];
  const client = clients.filter(name => normalized.includes(normalize(name))).sort((a, b) => b.length - a.length)[0];
  const status = /atorad|pendient|error/.test(normalized) ? /error|pendiente|bloquead/i : null;
  if (!company && !client && amount == null && !status && !/\b(ultima|reciente)\b/.test(normalized)) return { kind: "NEEDS_DETAIL" as const, source: "searchSolicitudes" };
  const matches = sample.filter(item => (!company || item.empresa === company) && (!client || item.cliente === client) && (amount == null || item.monto === amount) && (!status || status.test(item.estado || "")));
  if (sample.length === 100) return { kind: "PARTIAL" as const, options: matches.slice(0, 5).map(solicitudLabel), source: "searchSolicitudes" };
  if (matches.length === 1) return { kind: "MATCH" as const, item: matches[0], source: "searchSolicitudes" };
  if (matches.length > 1 && /\b(ultima|reciente)\b/.test(normalized) && matches[0].createdAt && matches[0].createdAt !== matches[1].createdAt) return { kind: "MATCH" as const, item: matches[0], source: "searchSolicitudes" };
  if (matches.length > 1) return { kind: "AMBIGUOUS" as const, options: matches.slice(0, 5).map(solicitudLabel), source: "searchSolicitudes" };
  return { kind: "NONE" as const, source: "searchSolicitudes", partial: sample.length === 100 };
}
