import { createHash } from "node:crypto";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { assertAuthorized } from "../../utils/authGuard";
import { db, getMyUser, requireAuth } from "../sharedCallables/helpers";
import { Pay0Connector } from "./pay0Connector";
import { assertTeamReadOnly, routeTeamTurn, TEAM_AGENTS, type HugoTeamAgent } from "./teamRouting";
import { MAX_SOLICITUD_DOCUMENT_SIZE_BYTES } from "../solicitudDocuments/domain";
import { parseOcCommercialMetadataBuffer } from "../solicitudDocuments/service";

const ELIUT_UID = "Ab4z0RttIqXbZFT0NuWsDjBkt6J2";
const folioPattern = /\bS(?=[A-Z0-9]*\d)[A-Z0-9]{5,19}\b/i;
const safe = (value: unknown, max = 500) => String(value ?? "").trim().slice(0, max);
const agentName = (id: HugoTeamAgent) => TEAM_AGENTS.find(row => row.id === id)!.name;

async function authorized(request: any) {
  const uid = requireAuth(request);
  if (uid !== ELIUT_UID) throw new HttpsError("permission-denied", "El equipo de Hugo está habilitado sólo para Eliut.");
  const user = await getMyUser(uid);
  assertAuthorized(request.auth, user, { allowedRoles: ["superadmin"] });
  const rootId = safe(user?.rootId || uid, 128);
  if (!rootId || user?.active === false || user?.disabled === true) throw new HttpsError("permission-denied", "La autoridad delegada no está vigente.");
  return { uid, rootId, user };
}

type TeamEvidence = { collection: string; folio: string; kind: string };
async function readTeamFacts(rootId: string, uid: string, user: any, auth: any, message: string, consulted: HugoTeamAgent[]) {
  const evidence: TeamEvidence[] = [];
  const folio = safe(message.match(folioPattern)?.[0]?.toUpperCase(), 20);
  if (folio) {
    const result = await new Pay0Connector(db, { uid, rootId, role: "superadmin" }).getSolicitud(folio);
    const solicitud: any = result.data;
    if (!solicitud) return { text: `No encontré una Solicitud única con folio ${folio} en tu alcance PAY0.`, evidence };
    evidence.push({ collection: "solicitudes", folio, kind: "SOLICITUD" });
    const uploads = await db.collection("uploads").where("rootId", "==", rootId).where("solicitudId", "==", solicitud.id).limit(100).get();
    const partialDocuments = uploads.size === 100;
    const documents = uploads.docs.filter(row => row.get("active") === true).map(row => String(row.get("documentType") || "Otro"));
    const activeOc = uploads.docs.filter(row => row.get("active") === true && row.get("status") === "READY" && row.get("documentType") === "ORDEN_COMPRA");
    const quoteCount = documents.filter(type => type === "COTIZACION").length;
    const jobId = safe((await db.collection("solicitudes").doc(solicitud.id).get()).get("cotizacionAutoGenerateJobId"), 160);
    const job = jobId ? await db.collection("solicitudQuotationJobs").doc(jobId).get() : null;
    const jobStatus = job?.exists && job.get("rootId") === rootId ? safe(job.get("status"), 60) : "sin job canónico asociado";
    const amount = solicitud.monto == null ? NaN : Number(solicitud.monto);
    const formatted = Number.isFinite(amount) ? amount.toLocaleString("es-MX", { style: "currency", currency: solicitud.moneda || "MXN" }) : "importe no registrado";
    const base = `${folio}: ${solicitud.estado || "sin estado"}; empresa ${solicitud.empresa || "no registrada"}; cliente ${solicitud.cliente || "no registrado"}; ${formatted}. Documentos activos en la muestra: ${documents.length ? documents.join(", ") : "ninguno"}. Cotizaciones PAY0 activas en la muestra: ${quoteCount}${partialDocuments ? "; lectura parcial, no concluye ausencia" : ""}. Job de cotización: ${jobStatus}.`;
    if (job?.exists && job.get("rootId") === rootId) evidence.push({ collection: "solicitudQuotationJobs", folio, kind: "COTIZACION_JOB" });
    for (const type of new Set(documents)) evidence.push({ collection: "uploads", folio, kind: type });
    const prefix = consulted.includes("sofia") ? "Sofía revisó metadatos documentales de PAY0. " : "";
    const wantsOcAnalysis = consulted.includes("sofia") && /\b(analiza|analizar|extrae|extraer|lee|leer)\b/i.test(message) && /\bOC\b|orden de compra/i.test(message);
    if (wantsOcAnalysis) {
      if (partialDocuments || activeOc.length !== 1) return { text: `${prefix}${base} No pude demostrar una OC activa READY única para analizar.`, evidence };
      const oc = activeOc[0], storagePath = safe(oc.get("storagePath"), 500);
      const prefixPath = `roots/${rootId}/solicitudes/${solicitud.id}/docs/ORDEN_COMPRA/${oc.id}-`;
      if (!storagePath.startsWith(prefixPath)) return { text: `${prefix}${base} La ruta de la OC no coincide con la Solicitud; detuve la lectura.`, evidence };
      const file = admin.storage().bucket().file(storagePath);
      const [metadata] = await file.getMetadata();
      const size = Number(metadata.size || 0);
      if (!Number.isFinite(size) || size <= 0 || size > MAX_SOLICITUD_DOCUMENT_SIZE_BYTES) return { text: `${prefix}${base} El tamaño de la OC no permite una extracción segura.`, evidence };
      const [buffer] = await file.download({ start: 0, end: MAX_SOLICITUD_DOCUMENT_SIZE_BYTES });
      const extracted = await parseOcCommercialMetadataBuffer(buffer);
      if (!extracted) return { text: `${prefix}${base} La extracción comercial de la OC no produjo datos confiables.`, evidence };
      const items = extracted.items.map(item => `${item.quantity} × ${safe(item.description, 120)}`);
      evidence.push({ collection: "uploads", folio, kind: "OC_CONTENIDO_LEIDO" });
      return { text: `${prefix}${base} OC analizada en memoria: ${items.length} partida(s): ${items.join("; ") || "sin partidas"}. Subtotal ${extracted.subtotal ?? "no identificado"}, IVA ${extracted.iva ?? "no identificado"}, total ${extracted.total ?? "no identificado"}, moneda ${extracted.currency || "no identificada"}. No persistí la extracción.`, evidence };
    }
    return { text: `${prefix}${base} Pide “analiza la OC” para leer su contenido sin persistirlo.`, evidence };
  }
  if (/\b(plantilla|plantillas|biblioteca)\b/i.test(message)) {
    assertAuthorized(auth, user, { allowedRoles: ["superadmin"], requiredModule: "corporateResources", requiredAction: "view" });
    if (user.modules?.corporateResources === false || user.modules?.corporateResources?.view === false) throw new HttpsError("permission-denied", "La Biblioteca no está habilitada para esta sesión.");
    const resources = await db.collection("pay0CanonicalResources").where("rootId", "==", rootId).limit(100).get();
    const templates = resources.docs.filter(row => row.get("resourceKind") === "DOCUMENT_TEMPLATE").slice(0, 20);
    const companies = await Promise.all(templates.map(row => { const id = safe(row.get("ownCompanyId"), 128); return id && !id.includes("/") ? db.collection("companies").doc(id).get() : Promise.resolve(null); }));
    const rows = templates.map((row, index) => {
      const company = companies[index]?.get("rootId") === rootId ? companies[index].data() : null;
      return `${safe(company?.nombre || company?.razonSocial || "Empresa sin nombre", 100)}: ${safe(row.get("title") || row.get("stableKey"), 100)}, versión activa ${row.get("activeVersion") ?? "ninguna"}`;
    });
    return { text: `Biblioteca de Plantillas de PAY0: ${rows.length ? rows.join("; ") : "sin plantillas en la muestra"}.${resources.size === 100 || templates.length === 20 ? " Muestra parcial; consulta la Biblioteca para el listado completo." : ""}`, evidence: templates.map(row => ({ collection: "pay0CanonicalResources", folio: safe(row.get("title") || "Plantilla", 100), kind: "PLANTILLA" })) };
  }
  if (consulted.includes("sentinel") || /\b(pendientes?|errores?)\b/i.test(message)) {
    const incidents = await db.collection("agentIncidents").where("rootId", "==", rootId).orderBy("createdAt", "desc").limit(20).get();
    const active = incidents.docs.filter(row => row.get("reportingExcluded") !== true && row.get("status") === "OPEN");
    const evidence = await Promise.all(active.map(async row => {
      const entityId = safe(row.get("entityId"), 120);
      const solicitud = entityId ? await db.collection("solicitudes").doc(entityId).get() : null;
      const folio = solicitud?.exists && solicitud.get("rootId") === rootId ? safe(solicitud.get("folio"), 120) : "Solicitud sin folio verificable";
      return { collection: "agentIncidents", folio, kind: "INCIDENTE" };
    }));
    const specialist = consulted.includes("sentinel") ? "Sentinel" : "María";
    return { text: `${specialist} revisó hasta 20 incidencias recientes del alcance autorizado: ${active.length} abiertas en esa muestra. No cambió estados ni ejecutó contención.`, evidence };
  }
  if (!/\b(última|ultima|reciente)\b/i.test(message)) return { text: "Indica el folio de la Solicitud para consultar su estado y expediente sin ambigüedad.", evidence };
  const latest = await new Pay0Connector(db, { uid, rootId, role: "superadmin" }).getLatestSolicitud();
  const item: any = latest.data.item;
  return { text: item ? `La Solicitud más reciente visible en PAY0 es ${item.folio || "sin folio"}, estado ${item.estado || "sin estado"}. Indica un folio para revisar documentos y cotización.` : "No encontré Solicitudes en el alcance autorizado.", evidence: item?.folio ? [{ collection: "solicitudes", folio: item.folio, kind: "SOLICITUD" }] : [] };
}

export const sendHugoTeamTurn = onCall({ region: "us-central1", timeoutSeconds: 45, memory: "256MiB" }, async request => {
  const { uid, rootId, user } = await authorized(request);
  const message = safe(request.data?.message, 2000), turnId = safe(request.data?.turnId, 100);
  const selected = request.data?.agent;
  const channel = request.data?.channel;
  if (!message || !/^[a-f0-9-]{36}$/.test(turnId) || !TEAM_AGENTS.some(row => row.id === selected) || !["TEXT", "AUDIO"].includes(channel)) throw new HttpsError("invalid-argument", "Turno incompleto.");
  const route = routeTeamTurn(message, selected);
  const ref = db.collection("hugoTeamTurns").doc(createHash("sha256").update(`${rootId}|${uid}|${turnId}`).digest("hex"));
  const existing = await ref.get();
  if (existing.exists) {
    if (existing.get("actorUid") !== uid || existing.get("message") !== message || existing.get("selectedAgent") !== selected || existing.get("channel") !== channel) throw new HttpsError("already-exists", "El identificador de turno ya pertenece a otra petición.");
    return { ok: true, ...existing.data() };
  }
  const blocked = assertTeamReadOnly(message, channel);
  const askFolio = !blocked && !folioPattern.test(message) && /\bsolicitud\b/i.test(message) && !/\b(última|ultima|reciente|pendientes?|errores?)\b/i.test(message);
  const recognized = folioPattern.test(message) || /\b(plantilla|plantillas|biblioteca|pendientes?|errores?|incidente|alerta|seguridad|solicitud|reciente|última|ultima)\b/i.test(message);
  const unavailable = !blocked && !recognized;
  const fact = blocked ? { text: blocked, evidence: [] as TeamEvidence[] } : unavailable
    ? { text: "Aún no tengo una herramienta verificada para esa consulta. No ejecuté acciones ni inventé una respuesta.", evidence: [] as TeamEvidence[] }
    : await readTeamFacts(rootId, uid, user, request.auth, message, route.consulted);
  const hasFolio = folioPattern.test(message);
  const toolsUsed = blocked || unavailable || askFolio ? [] : hasFolio ? ["getSolicitud", "listSolicitudUploads", "getQuotationJob", ...(fact.evidence.some(item => item.kind === "OC_CONTENIDO_LEIDO") ? ["parseOcCommercialMetadataBuffer"] : [])]
    : /\b(plantilla|plantillas|biblioteca)\b/i.test(message) ? ["listCorporateResources"]
    : route.consulted.includes("sentinel") || /\b(pendientes?|errores?)\b/i.test(message) ? ["listAgentIncidents"] : ["getLatestSolicitud"];
  const modulesAffected = [...new Set(fact.evidence.map(item => item.collection === "uploads" ? "documentos" : item.collection === "agentIncidents" ? "agentes" : item.collection === "pay0CanonicalResources" ? "corporateResources" : "solicitudes"))];
  const activity = blocked ? "Vista previa sin consulta ni cambio" : unavailable || askFolio ? "No se ejecutó herramienta" : route.consulted.map(agent => `${agentName(agent)} consultó PAY0`).join("; ");
  const reply = route.agent === "hugo" && route.consulted.length > 1 ? `Hugo consultó a ${route.consulted.map(agentName).join(" y ")}. ${fact.text}` : fact.text;
  const row = { actorUid: uid, rootId, conversationId: `${rootId}_${uid}_${route.agent}`, turnId, selectedAgent: selected, agent: route.agent,
    consultedAgents: unavailable || askFolio ? [] : route.consulted, channel, message, reply, action: blocked ? "PENDING_AUTHORIZATION" : unavailable ? "UNAVAILABLE" : askFolio ? "NEEDS_CLARIFICATION" : "READ", activity,
    evidence: fact.evidence, toolsUsed, modulesAffected, result: blocked ? "NO_EXECUTION" : unavailable ? "CAPABILITY_NOT_AVAILABLE" : askFolio ? "NEEDS_FOLIO" : "READ_COMPLETE", createdAt: FieldValue.serverTimestamp() };
  try { await ref.create(row); } catch (error: any) {
    if (error?.code !== 6) throw error;
    const winner = await ref.get();
    if (winner.get("actorUid") !== uid || winner.get("message") !== message || winner.get("selectedAgent") !== selected || winner.get("channel") !== channel) throw new HttpsError("already-exists", "El turno cambió durante la ejecución.");
    return { ok: true, ...winner.data() };
  }
  return { ok: true, ...row };
});

export const listHugoTeamTurns = onCall({ region: "us-central1", timeoutSeconds: 20, memory: "256MiB" }, async request => {
  const { uid, rootId } = await authorized(request);
  const selected = request.data?.agent;
  if (!TEAM_AGENTS.some(row => row.id === selected)) throw new HttpsError("invalid-argument", "Agente inválido.");
  const rows = await db.collection("hugoTeamTurns").where("conversationId", "==", `${rootId}_${uid}_${selected}`).orderBy("createdAt", "desc").limit(20).get();
  return { ok: true, agent: selected, turns: rows.docs.map(doc => ({ id: doc.id, ...doc.data() })).reverse() };
});
