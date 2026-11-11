import * as admin from "firebase-admin";
import { resolverTierOf, type ResolverTier } from "./incidentResolution";
import { mexicoDayKey } from "./time";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const text = (value: unknown) => String(value ?? "").trim();

const KIND_LABELS: Record<string, string> = {
  NORMAL_ACTIVITY: "Actividad normal",
  REPEATED_FAILURE: "Fallas repetidas",
  AUTH_DENIED: "Acceso denegado",
  DATA_SCOPE_VIOLATION: "Datos fuera del alcance permitido",
  INTEGRITY_MISMATCH: "Datos que no cuadran",
};
const DECISION_LABELS: Record<string, string> = {
  NORMAL: "normal",
  SUSPICIOUS: "en vigilancia",
  RESTRICTED: "acceso restringido",
  QUARANTINE: "en cuarentena",
  BLOCKED: "bloqueado para revisión",
};
const STATUS_LABELS: Record<string, string> = {
  BLOCKED: "Bloqueada", ESCALATED: "Escalada a una persona", FAILED_RETRYABLE: "Falló; se reintentará", QUARANTINE: "En cuarentena",
  SUSPICIOUS: "En vigilancia", RESTRICTED: "Acceso restringido",
};

/** Spanish wording for the codes the agents write as incident causes; free Spanish text passes through unchanged. */
export function incidentCauseLabel(cause: unknown): string {
  const raw = text(cause);
  if (!raw) return "Sin motivo registrado";
  const sentinel = raw.match(/^([A-Z_]+):\s*([A-Z_]+)$/);
  if (sentinel && KIND_LABELS[sentinel[1]]) {
    const decision = DECISION_LABELS[sentinel[2]];
    return decision ? `${KIND_LABELS[sentinel[1]]}; ${decision}` : KIND_LABELS[sentinel[1]];
  }
  if (STATUS_LABELS[raw]) return STATUS_LABELS[raw];
  if (KIND_LABELS[raw]) return KIND_LABELS[raw];
  return raw;
}

export type IncidentSubject = {
  kind: "SOLICITUD" | "PAGO" | "DISPERSION";
  entityId: string;
  folio: string | null;
  clientName: string | null;
  amount: number | null;
  currency: string | null;
  /** Despacho or empresa (solicitud), empresa (pago) or beneficiario (dispersion). */
  providerName: string | null;
};

const COLLECTIONS: Record<string, { kind: IncidentSubject["kind"]; collection: string }> = {
  solicitud: { kind: "SOLICITUD", collection: "solicitudes" }, solicitudes: { kind: "SOLICITUD", collection: "solicitudes" },
  pago: { kind: "PAGO", collection: "pagos" }, pagos: { kind: "PAGO", collection: "pagos" },
  dispersion: { kind: "DISPERSION", collection: "clientDispersions" }, dispersiones: { kind: "DISPERSION", collection: "clientDispersions" },
  clientdispersion: { kind: "DISPERSION", collection: "clientDispersions" }, clientdispersions: { kind: "DISPERSION", collection: "clientDispersions" },
};
const entityTarget = (entityType: unknown) => COLLECTIONS[text(entityType).toLowerCase()];
const amountOf = (data: Record<string, any>) => {
  for (const value of [data.montoTotal, data.monto, data.amount, data.total]) { const n = Number(value); if (Number.isFinite(n) && n > 0) return n; }
  return null;
};
const firstText = (...values: unknown[]) => values.map(text).find(Boolean) || null;

/** Builds the readable subject of an entity. Returns null when the document belongs to another root. */
export function incidentSubjectFrom(kind: IncidentSubject["kind"], entityId: string, data: Record<string, any>, rootId: string, despachoName?: string | null): IncidentSubject | null {
  if (text(data.rootId) !== rootId) return null;
  const providerName = kind === "SOLICITUD" ? firstText(despachoName, data.empresaNombre, data.companyName)
    : kind === "PAGO" ? firstText(data.empresaNombre, data.companyName)
    : firstText(data.beneficiaryNombre, data.beneficiaryName, data.beneficiarioNombre, data.beneficiario);
  return {
    kind, entityId, folio: firstText(data.folio, data.pay0Folio, data.dispersionFolio),
    clientName: firstText(data.clienteNombre, data.clientName, data.clientDisplayName),
    amount: amountOf(data), currency: firstText(data.moneda, data.currency), providerName,
  };
}

/** One bounded getAll per collection (plus one for the despachos of the solicitudes); every document is checked against the rootId. */
export async function loadIncidentSubjects(rootId: string, incidents: Array<Record<string, any>>): Promise<Map<string, IncidentSubject>> {
  const wanted = new Map<string, Set<string>>();
  for (const row of incidents) {
    const target = entityTarget(row.entityType), id = text(row.entityId);
    if (!target || !id || id.includes("/")) continue;
    if (!wanted.has(target.collection)) wanted.set(target.collection, new Set());
    wanted.get(target.collection)!.add(id);
  }
  const docs = new Map<string, Record<string, any>>();
  await Promise.all([...wanted].map(async ([collection, ids]) => {
    const snaps = await db.getAll(...[...ids].map(id => db.collection(collection).doc(id)));
    for (const snap of snaps) if (snap.exists) docs.set(`${collection}/${snap.id}`, snap.data() as Record<string, any>);
  }));
  const despachoIds = new Set<string>();
  for (const [key, data] of docs) if (key.startsWith("solicitudes/") && text(data.rootId) === rootId && text(data.despachoId)) despachoIds.add(text(data.despachoId));
  const despachos = new Map<string, string>();
  if (despachoIds.size) {
    const snaps = await db.getAll(...[...despachoIds].map(id => db.collection("despachos").doc(id)));
    for (const snap of snaps) {
      const data = snap.data() || {};
      if (snap.exists && (!text(data.rootId) || text(data.rootId) === rootId)) despachos.set(snap.id, firstText(data.nombre, data.name) || "");
    }
  }
  const result = new Map<string, IncidentSubject>();
  for (const row of incidents) {
    const target = entityTarget(row.entityType), id = text(row.entityId);
    const data = target ? docs.get(`${target.collection}/${id}`) : undefined;
    if (!target || !data) continue;
    const subject = incidentSubjectFrom(target.kind, id, data, rootId, target.kind === "SOLICITUD" ? despachos.get(text(data.despachoId)) : null);
    if (subject) result.set(`${text(row.entityType)}/${id}`, subject);
  }
  return result;
}

export const RESOLVER_LABEL: Record<ResolverTier, string> = { SYSTEM: "Sistema", HUGO: "Hugo", PERSON: "Persona" };
const millisOf = (value: any): number => value?.toMillis?.() ?? (typeof value?.seconds === "number" ? value.seconds * 1000 : typeof value?._seconds === "number" ? value._seconds * 1000 : Number(value) || 0);

export type ReadableIncident = Record<string, any> & {
  causeLabel: string; subject: IncidentSubject | null; causes: string[]; count: number; ids: string[];
  resolverTier: ResolverTier | null; resolvedAtMs: number | null; autoResolved: boolean | null; resolutionText: string | null;
};

/** Open incidents plus those resolved on the given Mexico day; this is what the daily list and the dashboard show. */
export function incidentsOfTheDay<T extends ReadableIncident>(groups: T[], day: string): T[] {
  return groups.filter(group => group.status === "OPEN" || (group.status === "RESOLVED" && group.resolvedAtMs !== null && mexicoDayKey(new Date(group.resolvedAtMs)) === day));
}

/** Same entity and state: one card. Each cause is listed once and the newest incident leads. */
export function groupIncidents(incidents: Array<Record<string, any>>, subjects: Map<string, IncidentSubject>): ReadableIncident[] {
  const groups = new Map<string, ReadableIncident>();
  incidents.forEach((row, index) => {
    const key = text(row.entityId) ? `${text(row.entityType)}/${text(row.entityId)}/${text(row.status)}/${row.status === "RESOLVED" ? text(row.resolverTier ?? row.resolvedBy) : ""}` : `sin-entidad/${index}`;
    const label = incidentCauseLabel(row.cause);
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1; existing.ids.push(String(row.id));
      if (!existing.causes.includes(label)) existing.causes.push(label);
      return;
    }
    const { resolvedByUid: _uid, ...safe } = row;
    const tier = row.status === "RESOLVED" ? resolverTierOf(row.resolverTier ?? row.resolvedBy) : null;
    groups.set(key, { ...safe, resolverTier: tier, resolvedAtMs: row.status === "RESOLVED" ? millisOf(row.resolvedAt) || null : null,
      autoResolved: row.status === "RESOLVED" ? tier !== "PERSON" : null, resolutionText: text(row.actionTaken || row.resolutionNote) || null, causeLabel: label, causes: [label], count: 1, ids: [String(row.id)], subject: subjects.get(`${text(row.entityType)}/${text(row.entityId)}`) || null });
  });
  return [...groups.values()];
}

const money = (value: number, currency: string | null) => `$${value.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${currency && currency !== "MXN" ? ` ${currency}` : ""}`;
const KIND_WORD: Record<IncidentSubject["kind"], string> = { SOLICITUD: "Solicitud", PAGO: "Pago", DISPERSION: "Dispersión" };

/** "Solicitud S-123 · Cliente · $25,363.64 · Proveedor"; unknown pieces are left out. */
export function incidentSubjectLine(subject: IncidentSubject | null): string {
  if (!subject) return "";
  return [subject.folio ? `${KIND_WORD[subject.kind]} ${subject.folio}` : KIND_WORD[subject.kind], subject.clientName,
    subject.amount !== null ? money(subject.amount, subject.currency) : null, subject.providerName].filter(Boolean).join(" · ");
}
