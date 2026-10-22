import { createHash } from "node:crypto";

export const P4_ENGINE_VERSION = 7;
export const P4_MANIFEST_KIND = "P4_IMPORT_MANIFEST" as const;
export const P4_ALLOWED_COLLECTIONS = ["clients", "solicitudes", "pagos", "pagoAplicaciones"] as const;
export type P4Collection = typeof P4_ALLOWED_COLLECTIONS[number];
export type P4EntityType = "CLIENT" | "SOLICITUD" | "PAYMENT" | "APPLICATION";
export type P4ActionOperation = "NO_OP" | "EXISTING" | "RECONCILE" | "CREATE_HISTORICAL" | "DEPENDENCY_IMPORT" | "CANONICAL_DEPENDENCY_PENDING" | "SKIP_PURGED" | "REVIEW_REQUIRED" | "CLIENT_REVIEW_REQUIRED" | "FINANCIAL_RECONCILIATION_REVIEW" | "HISTORICAL_DATE_REVIEW_REQUIRED";
export type P4ApplicationStatus = "ACTIVE" | "CANCELLED" | "REVERSED" | "REJECTED" | "UNKNOWN";
export type P4CanonicalReadiness = "CANONICAL_READY" | "CANONICAL_REVIEW_REQUIRED";
export type P4CanonicalEvidence = {
  readiness: P4CanonicalReadiness;
  reviewReasons: string[];
  root: Record<string, unknown>;
  client: Record<string, unknown>;
  company: Record<string, unknown>;
  despacho: Record<string, unknown>;
  folio: Record<string, unknown>;
  status: Record<string, unknown>;
  monetary: Record<string, unknown>;
  temporal: Record<string, unknown>;
  graph: Record<string, unknown>;
};

export type P4Action = {
  actionId: string;
  entityType: P4EntityType;
  iqEntityId: string;
  canonicalGroupId: string;
  canonicalIqProfileId: string;
  observedThroughProfileIds: string[];
  rootId: string;
  targetPath: string;
  operation: P4ActionOperation;
  matchingEvidence: Record<string, unknown>;
  tombstoneKeys: string[];
  after: Record<string, unknown>;
  mutableFields: string[];
  reason?: string;
  dependencies?: string[];
  expectedDelta?: Record<string, unknown>;
  componentId?: string;
  historicalTime?: import("./temporal").P4HistoricalTime;
  canonicalEvidence?: P4CanonicalEvidence;
  reconciliationOf?: { manifestId: string; runId: string; actionId: string; importVersion: number };
};

export type P4ManifestContent = {
  kind: typeof P4_MANIFEST_KIND;
  version: number;
  range: { start: string; end: string; timezone: "America/Mexico_City" };
  canonicalGroups: Array<{ groupId: string; canonicalIqProfileId: string; observedThroughProfileIds: string[] }>;
  financialGraph: {
    solicitudes: P4FinancialEntity[];
    payments: P4FinancialEntity[];
    applications: P4FinancialApplication[];
  };
  actions: P4Action[];
  expectedPay0Writes: number;
  expectedIqWrites: 0;
  expectedExternalEffects: 0;
};

export type P4Manifest = P4ManifestContent & {
  manifestId: string;
  manifestHash: string;
  status: "PLANNED" | "APPROVED" | "EXECUTING" | "COMPLETED" | "ROLLED_BACK";
};

export type P4ExecutionBudget = { maxEntities: number; maxWrites: number; maxDurationMs: number; maxErrors: number; maxBatches: number };
export type P4SideEffectCounters = {
  iqWrites: 0; iqCreates: 0; iqDepositWrites: 0; iqApplicationWrites: 0;
  facturamaCalls: 0; complementRequests: 0; financialTasks: 0;
  ledgerReplayEffects: 0; commissionReplayEffects: 0; materialityReplayEffects: 0;
  emails: 0; telegramOperational: 0;
};

export const ZERO_SIDE_EFFECTS: P4SideEffectCounters = Object.freeze({
  iqWrites: 0, iqCreates: 0, iqDepositWrites: 0, iqApplicationWrites: 0,
  facturamaCalls: 0, complementRequests: 0, financialTasks: 0,
  ledgerReplayEffects: 0, commissionReplayEffects: 0, materialityReplayEffects: 0,
  emails: 0, telegramOperational: 0,
});

export class P4EngineError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "P4EngineError"; }
}

const text = (value: unknown): string => String(value ?? "").trim();
const moneyMinor = (value: unknown): number => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) throw new P4EngineError("P4_FINANCIAL_INVARIANT_FAILED", "Monto no numérico.");
  return Math.round(amount * 100);
};

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    return `{${Object.keys(row).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(row[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function manifestHash(content: P4ManifestContent): string {
  return createHash("sha256").update(canonicalJson(content)).digest("hex");
}

export function deterministicId(...parts: string[]): string {
  return createHash("sha256").update(parts.map(text).join("\u001f")).digest("hex");
}

export function collectionForEntity(entityType: P4EntityType): P4Collection {
  return ({ CLIENT: "clients", SOLICITUD: "solicitudes", PAYMENT: "pagos", APPLICATION: "pagoAplicaciones" } as const)[entityType];
}

export function validateTargetPath(action: P4Action): void {
  const parts = action.targetPath.split("/").filter(Boolean);
  if (parts.length !== 2 || parts[0] !== collectionForEntity(action.entityType) || !/^[A-Za-z0-9_-]{8,160}$/.test(parts[1]))
    throw new P4EngineError("P4_TARGET_PATH_INVALID", `Target inválido para ${action.actionId}.`);
}

const actionRank: Record<P4EntityType, number> = { CLIENT: 0, SOLICITUD: 1, PAYMENT: 2, APPLICATION: 3 };

export function normalizeManifestContent(input: P4ManifestContent): P4ManifestContent {
  const componentBalances = new Map<string,P4BalanceResult>();
  if(input.version>=3){for(const component of partitionFinancialComponents(input.financialGraph.solicitudes,input.financialGraph.payments,input.financialGraph.applications)){try{componentBalances.set(component.componentId,reconstructBalances(component.solicitudes,component.payments,component.applications));}catch{/* Failed components remain review-only and do not assert balances. */}}}
  const balances = input.version>=3 ? {solicitudes:{},payments:{}} as P4BalanceResult : reconstructBalances(input.financialGraph.solicitudes, input.financialGraph.payments, input.financialGraph.applications);
  const actions = [...input.actions].map(action => {
    const derivesBalance = ["RECONCILE", "CREATE_HISTORICAL", "DEPENDENCY_IMPORT", "NO_OP", "EXISTING"].includes(action.operation);
    const scopedBalances=input.version>=3&&action.componentId?componentBalances.get(action.componentId):balances;
    const solicitud = derivesBalance && action.entityType === "SOLICITUD" ? scopedBalances?.solicitudes[action.iqEntityId] : null;
    const payment = derivesBalance && action.entityType === "PAYMENT" ? scopedBalances?.payments[action.iqEntityId] : null;
    const after = solicitud ? { ...action.after, monto: solicitud.totalMinor / 100, totalAbonado: solicitud.appliedMinor / 100, saldoPendiente: solicitud.pendingMinor / 100 }
      : payment ? { ...action.after, monto: payment.totalMinor / 100, totalAplicado: payment.appliedMinor / 100, saldoDisponible: payment.availableMinor / 100 }
      : action.after;
    const derivedFields = solicitud ? ["monto", "totalAbonado", "saldoPendiente"] : payment ? ["monto", "totalAplicado", "saldoDisponible"] : [];
    return ({
    ...action,
    after,
    actionId: text(action.actionId), iqEntityId: text(action.iqEntityId), rootId: text(action.rootId), targetPath: text(action.targetPath),
    canonicalGroupId: text(action.canonicalGroupId), canonicalIqProfileId: text(action.canonicalIqProfileId),
    observedThroughProfileIds: [...new Set(action.observedThroughProfileIds.map(text).filter(Boolean))].sort(),
    tombstoneKeys: [...new Set(action.tombstoneKeys.map(text).filter(Boolean))].sort(),
    mutableFields: [...new Set([...action.mutableFields, ...derivedFields].map(text).filter(Boolean))].sort(),
  }); }).sort((a, b) => actionRank[a.entityType] - actionRank[b.entityType] || a.actionId.localeCompare(b.actionId));
  return { ...input, kind: P4_MANIFEST_KIND, version: input.version, actions,
    canonicalGroups: [...input.canonicalGroups].map(group => ({ ...group, observedThroughProfileIds: [...new Set(group.observedThroughProfileIds)].sort() })).sort((a, b) => a.groupId.localeCompare(b.groupId)),
    financialGraph: {
      solicitudes: [...input.financialGraph.solicitudes].sort((a, b) => `${text(a.canonicalGroupId)}:${a.id}`.localeCompare(`${text(b.canonicalGroupId)}:${b.id}`)),
      payments: [...input.financialGraph.payments].sort((a, b) => `${text(a.canonicalGroupId)}:${a.id}`.localeCompare(`${text(b.canonicalGroupId)}:${b.id}`)),
      applications: [...input.financialGraph.applications].sort((a, b) => `${text(a.canonicalGroupId)}:${a.id}`.localeCompare(`${text(b.canonicalGroupId)}:${b.id}`)),
    },
    expectedPay0Writes: actions.filter(action => ["RECONCILE", "CREATE_HISTORICAL", "DEPENDENCY_IMPORT"].includes(action.operation)).length,
    expectedIqWrites: 0, expectedExternalEffects: 0 };
}

export function validateManifest(content: P4ManifestContent): void {
  if (content.kind !== P4_MANIFEST_KIND || ![1, 2, 3, 4, 5, 6, P4_ENGINE_VERSION].includes(content.version)) throw new P4EngineError("P4_MANIFEST_VERSION_INVALID", "Versión de manifest no soportada.");
  if (content.range.timezone !== "America/Mexico_City" || !/^\d{4}-\d{2}-\d{2}$/.test(content.range.start) || !/^\d{4}-\d{2}-\d{2}$/.test(content.range.end) || content.range.start > content.range.end)
    throw new P4EngineError("P4_MANIFEST_RANGE_INVALID", "Rango del manifest inválido.");
  const ids = new Set<string>(); const targets = new Set<string>();
  const actionById=new Map(content.actions.map(action=>[action.actionId,action]));
  const financialKey=(group:string,id:string)=>content.version>=3?`${group}\u001f${id}`:id;
  const financialIds = {
    SOLICITUD: new Set(content.financialGraph.solicitudes.map(row => financialKey(text(row.canonicalGroupId),row.id))),
    PAYMENT: new Set(content.financialGraph.payments.map(row => financialKey(text(row.canonicalGroupId),row.id))),
    APPLICATION: new Set(content.financialGraph.applications.map(row => financialKey(text(row.canonicalGroupId),row.id))),
  };
  const components=content.version>=3?partitionFinancialComponents(content.financialGraph.solicitudes,content.financialGraph.payments,content.financialGraph.applications):[];
  const componentByEntity=new Map<string,string>();
  for(const component of components){for(const id of component.invoiceIds)componentByEntity.set(`SOLICITUD\u001f${component.canonicalGroupId}\u001f${id}`,component.componentId);for(const id of component.paymentIds)componentByEntity.set(`PAYMENT\u001f${component.canonicalGroupId}\u001f${id}`,component.componentId);for(const id of component.applicationIds)componentByEntity.set(`APPLICATION\u001f${component.canonicalGroupId}\u001f${id}`,component.componentId);}
  for (const action of content.actions) {
    validateTargetPath(action);
    if (!action.actionId || ids.has(action.actionId)) throw new P4EngineError("P4_DUPLICATE_ACTION", "Action ID faltante o duplicado.");
    ids.add(action.actionId);
    if (!action.iqEntityId || !action.rootId || !action.canonicalGroupId || !action.canonicalIqProfileId) throw new P4EngineError("P4_ROOT_REVIEW_REQUIRED", `Resolución incompleta en ${action.actionId}.`);
    const evidenceMethod = text(action.matchingEvidence?.method);
    if (!["EXACT_IQ_ID", "EXACT_CANONICAL_CLIENT", "PREAPPROVED_MAPPING", "IQ_GRAPH_RELATION", "P1_TOMBSTONE", "UNRESOLVED_STRONG_ID", "ENTITY_SEMANTICS_REVIEW", "CROSS_COLLECTION_IDENTITY_CONFLICT"].includes(evidenceMethod))
      throw new P4EngineError("P4_ROOT_REVIEW_REQUIRED", `Matching no determinista en ${action.actionId}.`);
    if (["CANONICAL_DEPENDENCY_PENDING", "REVIEW_REQUIRED", "CLIENT_REVIEW_REQUIRED", "FINANCIAL_RECONCILIATION_REVIEW", "HISTORICAL_DATE_REVIEW_REQUIRED"].includes(action.operation) && Object.keys(action.after).length)
      throw new P4EngineError("P4_ROOT_REVIEW_REQUIRED", `Una acción en revisión no puede contener payload: ${action.actionId}.`);
    if (["RECONCILE", "CREATE_HISTORICAL", "DEPENDENCY_IMPORT"].includes(action.operation) && targets.has(action.targetPath)) throw new P4EngineError("P4_DUPLICATE_TARGET", `Target duplicado ${action.targetPath}.`);
    if (action.entityType !== "CLIENT" && ["RECONCILE", "CREATE_HISTORICAL", "DEPENDENCY_IMPORT"].includes(action.operation) && !financialIds[action.entityType].has(financialKey(action.canonicalGroupId,action.iqEntityId)))
      throw new P4EngineError("P4_FINANCIAL_INVARIANT_FAILED", `Entidad financiera sin grafo: ${action.actionId}.`);
    const expectedComponent=componentByEntity.get(`${action.entityType}\u001f${action.canonicalGroupId}\u001f${action.iqEntityId}`);
    if(content.version>=3&&action.entityType!=="CLIENT"&&expectedComponent&&action.componentId!==expectedComponent)throw new P4EngineError("P4_FINANCIAL_INVARIANT_FAILED",`Componente inválido para ${action.actionId}.`);
    if(content.version>=4&&action.entityType!=="CLIENT"&&["RECONCILE","CREATE_HISTORICAL","DEPENDENCY_IMPORT","NO_OP","EXISTING"].includes(action.operation)){
      const clientDependency=(action.dependencies||[]).map(id=>actionById.get(id)).find(candidate=>candidate?.entityType==="CLIENT"&&["RECONCILE","CREATE_HISTORICAL","DEPENDENCY_IMPORT","NO_OP","EXISTING"].includes(candidate.operation));
      if(!text(action.after.clientId)&&!clientDependency)throw new P4EngineError("P4_UNRESOLVED_EXECUTABLE_CLIENT",`Cliente no resuelto para ${action.actionId}.`);
    }
    if(content.version>=5){const time=action.historicalTime;if(!time)throw new P4EngineError("P4_HISTORICAL_DATE_REVIEW_REQUIRED",`Contrato temporal ausente para ${action.actionId}.`);if(action.entityType!=="CLIENT"&&["RECONCILE","CREATE_HISTORICAL","DEPENDENCY_IMPORT"].includes(action.operation)&&(time.availability!=="EXACT"||!time.normalizedAt))throw new P4EngineError("P4_HISTORICAL_DATE_REVIEW_REQUIRED",`Fecha histórica ausente para ${action.actionId}.`);}
    if(content.version>=6){const evidence=action.canonicalEvidence;if(!evidence)throw new P4EngineError("P4_HISTORICAL_CANONICAL_FIELD_REVIEW_REQUIRED",`Evidencia canónica V6 ausente para ${action.actionId}.`);const reviewOp=["CANONICAL_DEPENDENCY_PENDING","REVIEW_REQUIRED","CLIENT_REVIEW_REQUIRED","FINANCIAL_RECONCILIATION_REVIEW","HISTORICAL_DATE_REVIEW_REQUIRED"].includes(action.operation);if(evidence.readiness==="CANONICAL_READY"&&reviewOp)throw new P4EngineError("P4_HISTORICAL_CANONICAL_FIELD_REVIEW_REQUIRED",`Readiness contradictorio en ${action.actionId}.`);if(evidence.readiness==="CANONICAL_REVIEW_REQUIRED"&&!evidence.reviewReasons.length)throw new P4EngineError("P4_HISTORICAL_CANONICAL_FIELD_REVIEW_REQUIRED",`Review V6 sin causa en ${action.actionId}.`);}
    targets.add(action.targetPath);
    const expectedActionId = deterministicId(String(content.version), action.entityType, action.iqEntityId, action.canonicalGroupId);
    if (action.actionId !== expectedActionId) throw new P4EngineError("P4_ACTION_ID_INVALID", `Action ID no determinista para ${action.iqEntityId}.`);
  }
}

export function buildManifest(contentInput: P4ManifestContent): P4Manifest {
  const content = normalizeManifestContent(contentInput); validateManifest(content);
  const hash = manifestHash(content);
  return { ...content, manifestId: `p4m_${hash.slice(0, 24)}`, manifestHash: hash, status: "PLANNED" };
}

export function assertManifestHash(manifest: P4Manifest): void {
  const { manifestId: _id, manifestHash: actual, status: _status, ...content } = manifest;
  if (manifestHash(content) !== actual) throw new P4EngineError("P4_MANIFEST_HASH_MISMATCH", "El manifest cambió después de planearse.");
}

export type P4FinancialApplication = { id: string; solicitudId: string; paymentId: string; amount: number; currency: string; status: P4ApplicationStatus; canonicalGroupId?: string };
export type P4FinancialEntity = { id: string; amount: number; currency: string; canonicalGroupId?: string };
export type P4BalanceResult = { solicitudes: Record<string, { totalMinor: number; appliedMinor: number; pendingMinor: number }>; payments: Record<string, { totalMinor: number; appliedMinor: number; availableMinor: number }> };

export type P4FinancialComponent = {
  componentId: string;
  canonicalGroupId: string;
  invoiceIds: string[];
  paymentIds: string[];
  applicationIds: string[];
  solicitudes: P4FinancialEntity[];
  payments: P4FinancialEntity[];
  applications: P4FinancialApplication[];
  entityCount: number;
};

export function partitionFinancialComponents(
  solicitudes: P4FinancialEntity[], payments: P4FinancialEntity[], applications: P4FinancialApplication[],
): P4FinancialComponent[] {
  const key = (group: string | undefined, kind: string, id: string) => `${text(group)}\u001f${kind}\u001f${text(id)}`;
  const parent = new Map<string, string>();
  const add = (node: string) => { if (!parent.has(node)) parent.set(node, node); };
  const find = (node: string): string => { const current = parent.get(node); if (!current || current === node) return node; const root = find(current); parent.set(node, root); return root; };
  const union = (left: string, right: string) => { const a = find(left), b = find(right); if (a !== b) parent.set(a < b ? b : a, a < b ? a : b); };
  for (const row of solicitudes) add(key(row.canonicalGroupId, "I", row.id));
  for (const row of payments) add(key(row.canonicalGroupId, "P", row.id));
  for (const row of applications) {
    const app = key(row.canonicalGroupId, "A", row.id), invoice = key(row.canonicalGroupId, "I", row.solicitudId), payment = key(row.canonicalGroupId, "P", row.paymentId);
    add(app); add(invoice); add(payment); union(app, invoice); union(app, payment);
  }
  const buckets = new Map<string, { solicitudes:P4FinancialEntity[];payments:P4FinancialEntity[];applications:P4FinancialApplication[] }>();
  const bucket = (node: string) => { const root = find(node); if (!buckets.has(root)) buckets.set(root, { solicitudes:[],payments:[],applications:[] }); return buckets.get(root)!; };
  for (const row of solicitudes) bucket(key(row.canonicalGroupId,"I",row.id)).solicitudes.push(row);
  for (const row of payments) bucket(key(row.canonicalGroupId,"P",row.id)).payments.push(row);
  for (const row of applications) bucket(key(row.canonicalGroupId,"A",row.id)).applications.push(row);
  return [...buckets.values()].map(rows => {
    const invoiceIds=rows.solicitudes.map(x=>x.id).sort(),paymentIds=rows.payments.map(x=>x.id).sort(),applicationIds=rows.applications.map(x=>x.id).sort();
    const canonicalGroupId=text(rows.applications[0]?.canonicalGroupId??rows.solicitudes[0]?.canonicalGroupId??rows.payments[0]?.canonicalGroupId);
    const componentId=`p4c_${deterministicId(canonicalGroupId,invoiceIds.join(","),paymentIds.join(","),applicationIds.join(",")).slice(0,24)}`;
    return {componentId,canonicalGroupId,invoiceIds,paymentIds,applicationIds,solicitudes:[...rows.solicitudes].sort((a,b)=>a.id.localeCompare(b.id)),payments:[...rows.payments].sort((a,b)=>a.id.localeCompare(b.id)),applications:[...rows.applications].sort((a,b)=>a.id.localeCompare(b.id)),entityCount:invoiceIds.length+paymentIds.length+applicationIds.length};
  }).sort((a,b)=>a.componentId.localeCompare(b.componentId));
}

export function reconstructBalances(solicitudes: P4FinancialEntity[], payments: P4FinancialEntity[], applications: P4FinancialApplication[]): P4BalanceResult {
  const solicitudMap = new Map(solicitudes.map(row => [row.id, { row, total: moneyMinor(row.amount), applied: 0 }]));
  const paymentMap = new Map(payments.map(row => [row.id, { row, total: moneyMinor(row.amount), applied: 0 }]));
  const appIds = new Set<string>();
  for (const app of applications) {
    if (appIds.has(app.id)) throw new P4EngineError("P4_FINANCIAL_INVARIANT_FAILED", `Aplicación duplicada ${app.id}.`);
    appIds.add(app.id);
    if (app.status !== "ACTIVE") continue;
    const solicitud = solicitudMap.get(app.solicitudId); const payment = paymentMap.get(app.paymentId);
    if (!solicitud || !payment) throw new P4EngineError("P4_FINANCIAL_INVARIANT_FAILED", `Referencias incompletas en ${app.id}.`);
    if (text(solicitud.row.currency).toUpperCase() !== text(payment.row.currency).toUpperCase() || text(app.currency).toUpperCase() !== text(payment.row.currency).toUpperCase())
      throw new P4EngineError("P4_FINANCIAL_INVARIANT_FAILED", `Moneda incompatible en ${app.id}.`);
    const amount = moneyMinor(app.amount); if (amount < 0) throw new P4EngineError("P4_FINANCIAL_INVARIANT_FAILED", `Monto negativo en ${app.id}.`);
    solicitud.applied += amount; payment.applied += amount;
  }
  for (const value of [...solicitudMap.values(), ...paymentMap.values()]) if (value.applied > value.total) throw new P4EngineError("P4_FINANCIAL_INVARIANT_FAILED", "Aplicaciones exceden total.");
  return {
    solicitudes: Object.fromEntries([...solicitudMap].map(([id, value]) => [id, { totalMinor: value.total, appliedMinor: value.applied, pendingMinor: value.total - value.applied }])),
    payments: Object.fromEntries([...paymentMap].map(([id, value]) => [id, { totalMinor: value.total, appliedMinor: value.applied, availableMinor: value.total - value.applied }])),
  };
}

export function historicalPayload(action: P4Action, runId: string, manifestId: string, importedAt: unknown, importVersion = 1): Record<string, unknown> {
  const time=action.historicalTime;
  return { ...action.after, rootId: action.rootId, source: "IQ_IMPORT", importRunId: runId, importVersion,
    importManifestId: manifestId, canonicalIqProfileId: action.canonicalIqProfileId, canonicalIqGroupId: action.canonicalGroupId,
    observedThroughProfileIds: action.observedThroughProfileIds, originalIqEntityId: action.iqEntityId, ...(action.componentId ? { financialComponentId: action.componentId } : {}),
    p4ActionId: action.actionId, importedAt, ...(time?{originalIqTimestamp:time.rawValue,historicalEventAt:time.normalizedAt,historicalEventDate:time.normalizedDate,historicalTimeSourceField:time.sourceField,historicalTimeSourceTimezone:time.sourceTimezone,historicalTimeSemanticType:time.semanticType,historicalDateAvailability:time.availability}: {}) };
}
