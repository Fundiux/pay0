import { Pay0Connector } from "./pay0Connector";
import type { HugoTeamAgent } from "./teamRouting";
import { db } from "../sharedCallables/helpers";

const normalize = (value: unknown) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const money = (value: number | null, currency = "MXN") => value == null ? "importe sin registrar" : value.toLocaleString("es-MX", { style: "currency", currency });
const date = (value: string | null) => value ? new Date(value).toLocaleDateString("es-MX", { timeZone: "America/Mexico_City" }) : "fecha sin registrar";
const spanishNumbers: Record<string, number> = {
  un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
  diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19,
  veinte: 20, veintiuno: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25, veintiseis: 26,
  veintisiete: 27, veintiocho: 28, veintinueve: 29, treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60,
  setenta: 70, ochenta: 80, noventa: 90, cien: 100, ciento: 100, doscientos: 200, trescientos: 300,
  cuatrocientos: 400, quinientos: 500, seiscientos: 600, setecientos: 700, ochocientos: 800, novecientos: 900,
};
const spokenAmount = (message: string) => {
  const tokens = normalize(message).split(/[^a-z]+/).filter(Boolean);
  const end = tokens.findIndex(token => token === "peso" || token === "pesos");
  if (end < 0) return null;
  let start = end - 1;
  while (start >= 0 && (tokens[start] === "mil" || tokens[start] === "y" || Object.prototype.hasOwnProperty.call(spanishNumbers, tokens[start]))) start -= 1;
  const words = tokens.slice(start + 1, end);
  if (!words.length || words.every(word => word === "y")) return null;
  let total = 0, group = 0;
  for (const word of words) {
    if (word === "y") continue;
    if (word === "mil") { total += (group || 1) * 1000; group = 0; }
    else group += spanishNumbers[word];
  }
  return total + group || null;
};
export const amountInMessage = (message: string) => {
  const numeric = message.match(/\$\s*(\d[\d,. ]*)/)?.[1]
    || message.match(/\b(?:monto|importe|total|por)\s*(?:(?:exacto\s*)?(?:de\s*)?|:\s*)(\d{1,3}(?:[,. ]\d{3})+(?:[,.]\d{1,2})?|\d{4,}(?:[,.]\d{1,2})?)/i)?.[1]
    || message.match(/\b(\d{1,3}(?:[,. ]\d{3})+|\d{4,})\s*(?:pesos?|mxn)\b/i)?.[1];
  if (numeric) {
    const compact = numeric.trim().replace(/\s/g, "");
    const value = Number(/^\d{1,3}(?:[,.]\d{3})+$/.test(compact) ? compact.replace(/[,.]/g, "") : compact.replace(/,/g, ""));
    if (Number.isFinite(value)) return value;
  }
  return spokenAmount(message);
};
type Candidate = { id: string; folio: string | null; empresa: string | null; cliente: string | null; monto: number | null; moneda: string; estado: string | null; createdAt: string | null };
export const solicitudLabel = (item: Candidate) => `${item.empresa || "Empresa sin nombre"} · ${item.cliente || "cliente sin nombre"} · ${date(item.createdAt)} · ${money(item.monto, item.moneda)} · ${item.estado || "sin estado"}`;

export async function resolveHumanSolicitud(message: string, uid: string, rootId: string, agents: HugoTeamAgent[], sessionId?: string) {
  const connector = new Pay0Connector(db, { uid, rootId, role: "superadmin" });
  const folio = message.match(/\bS(?=[A-Z0-9]*\d)[A-Z0-9]{5,19}\b/i)?.[0]?.toUpperCase();
  if (folio) {
    const found = (await connector.getSolicitud(folio)).data as Candidate | null;
    return found ? { kind: "MATCH" as const, item: found, source: "getSolicitud" } : { kind: "NONE" as const, source: "getSolicitud" };
  }
  const normalized = normalize(message);
  const amount = amountInMessage(message);
  if (/\b(ultima|reciente)\b/.test(normalized) && amount == null && !/\b(cliente|proveedor|empresa)\s*[:;]?\s*\w/.test(normalized)) {
    const latest = (await connector.getLatestSolicitud()).data.item as Candidate | null;
    return latest ? { kind: "MATCH" as const, item: latest, source: "getLatestSolicitud" } : { kind: "NONE" as const, source: "getLatestSolicitud" };
  }
  const contextual = /\b(esa|ese|esta|este|la misma|su cotizacion|su oc|regresa|resumen|oc)\b/.test(normalized);
  if (contextual && amount == null && !/\b(cliente|proveedor|empresa)\s*[:;]?\s*\w/.test(normalized)) {
    const turns = await Promise.all(agents.map(agent => db.collection("hugoTeamTurns").where("conversationId", "==", `${rootId}_${uid}_${agent}`).orderBy("createdAt", "desc").limit(20).get()));
    const refs = turns.flatMap(snap => snap.docs).filter(doc => doc.get("selectedSolicitudId") && doc.get("rootId") === rootId && (!sessionId || doc.get("voiceSessionId") === sessionId)).sort((a, b) => (b.get("createdAt")?.toMillis?.() || 0) - (a.get("createdAt")?.toMillis?.() || 0));
    if (refs.length) {
      const snapshot = await db.collection("solicitudes").doc(String(refs[0].get("selectedSolicitudId"))).get();
      if (snapshot.exists && snapshot.get("rootId") === rootId && snapshot.get("folio")) {
        const found = (await connector.getSolicitud(String(snapshot.get("folio")))).data as Candidate | null;
        if (found) return { kind: "MATCH" as const, item: found, source: "conversationContext" };
      }
    }
  }
  const sample = ((await connector.searchSolicitudes(1000)).data as Candidate[]).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  const companies = [...new Set(sample.map(item => item.empresa).filter(Boolean))] as string[];
  const clients = [...new Set(sample.map(item => item.cliente).filter(Boolean))] as string[];
  const company = companies.filter(name => normalized.includes(normalize(name))).sort((a, b) => b.length - a.length)[0];
  const client = clients.filter(name => normalized.includes(normalize(name))).sort((a, b) => b.length - a.length)[0];
  const status = /atorad|pendient|error/.test(normalized) ? /error|pendiente|bloquead/i : null;
  if (!company && !client && amount == null && !status && !/\b(ultima|reciente)\b/.test(normalized)) {
    if (/\b(cliente|proveedor|empresa)\b/.test(normalized)) return { kind: "NONE" as const, source: "searchSolicitudes", partial: sample.length === 1000, transcriptionMismatch: true };
    return { kind: "NEEDS_DETAIL" as const, source: "searchSolicitudes" };
  }
  const matches = sample.filter(item => (!company || item.empresa === company) && (!client || item.cliente === client) && (amount == null || item.monto === amount) && (!status || status.test(item.estado || "")));
  if (sample.length === 1000) return { kind: "PARTIAL" as const, options: matches.slice(0, 5).map(solicitudLabel), source: "searchSolicitudes" };
  if (matches.length === 1) return { kind: "MATCH" as const, item: matches[0], source: "searchSolicitudes" };
  if (matches.length > 1 && /\b(ultima|reciente)\b/.test(normalized) && matches[0].createdAt && matches[0].createdAt !== matches[1].createdAt) return { kind: "MATCH" as const, item: matches[0], source: "searchSolicitudes" };
  if (matches.length > 1) return { kind: "AMBIGUOUS" as const, options: matches.slice(0, 5).map(solicitudLabel), source: "searchSolicitudes" };
  return { kind: "NONE" as const, source: "searchSolicitudes", partial: sample.length === 1000 };
}
