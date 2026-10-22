import { P4_ENGINE_VERSION, P4_MANIFEST_KIND, buildManifest, deterministicId, partitionFinancialComponents, reconstructBalances,
  type P4Action, type P4ActionOperation, type P4ApplicationStatus, type P4EntityType, type P4FinancialComponent, type P4Manifest } from "./domain";
import { normalizeIqHistoricalDate, temporalAfter } from "./temporal";
import { enrichCanonicalV6 } from "./canonicalPlan";
import { resolveFiscalEvidence } from "./fiscalEvidence";
import { P4_PROTECTED_REVIEW_IQ_IDS } from "./phasedExecution";

export const P4_PLAN_TIMEZONE = "America/Mexico_City" as const;
export const P4_PLAN_MAX_DAYS = 31;
export const P4_PAY0_PROFILE_ID = "bEGPMuplqNHMZ3lvYkeb";
export const P4_RR_PROFILE_ID = "Q3TaFdNTdR2mLPh7KcTi";
export const P4_BETELL_PROFILE_ID = "LxyRRZrJsAYoiAU62scb";

export type P4PlanGroup = { groupId: string; canonicalIqProfileId: string; memberProfileIds: string[] };
export const P4_PLAN_GROUPS: Record<string, P4PlanGroup> = {
  "iq-group-rr": { groupId: "iq-group-rr", canonicalIqProfileId: P4_RR_PROFILE_ID, memberProfileIds: [P4_RR_PROFILE_ID, P4_BETELL_PROFILE_ID] },
  "iq-group-pay0": { groupId: "iq-group-pay0", canonicalIqProfileId: P4_PAY0_PROFILE_ID, memberProfileIds: [P4_PAY0_PROFILE_ID] },
};

export type IqPlanKind = "CLIENT" | "SOLICITUD" | "PAYMENT" | "APPLICATION";
export type IqPlanRow = { kind: IqPlanKind; id: string; profileId: string; raw: Record<string, unknown>; inRange: boolean };
export type Pay0PlanRow = { collection: "clients" | "solicitudes" | "pagos" | "pagoAplicaciones" | "companies"; id: string; data: Record<string, unknown> };
export type TombstonePlanRow = { id: string; data: Record<string, unknown> };
export type PlannerInput = { rootId: string; range: { start: string; end: string; timezone: string }; groupIds: string[]; iqRows: IqPlanRow[]; pay0Rows: Pay0PlanRow[]; tombstones: TombstonePlanRow[] };

const text = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();
const upper = (value: unknown) => text(value).toUpperCase();
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const first = (row: Record<string, unknown>, names: string[]) => names.map(name => text(row[name])).find(Boolean) || "";
const nestedId = (value: unknown) => first(object(value), ["id", "iq_id", "folio", "rfc"]);
const amount = (row: Record<string, unknown>) => Number(row.sum ?? row.amount ?? row.monto ?? row.total ?? row.subtotal ?? 0);
const currency = (row: Record<string, unknown>) => upper(row.currency ?? row.moneda ?? "MXN") || "MXN";
const safeId = (prefix: string, ...parts: string[]) => `${prefix}_${deterministicId(...parts).slice(0, 28)}`;
const values = (row: Record<string, unknown>, names: string[]) => names.map(name => text(row[name])).filter(Boolean);

export function validatePlanRequest(data: unknown): { range: { start: string; end: string; timezone: typeof P4_PLAN_TIMEZONE }; groupIds: string[] } {
  const row = object(data); const range = object(row.range);
  if ("manifest" in row || "actions" in row || "roots" in row || "targetPaths" in row || "balances" in row || "historicalTime" in row || "createdAt" in row || "fechaPago" in row || "appliedAt" in row || "reportDateAt" in row) throw Object.assign(new Error("El caller no puede proporcionar un manifest."), { code: "P4_CLIENT_MANIFEST_FORBIDDEN" });
  const start = text(range.start), end = text(range.end), timezone = text(row.timezone ?? range.timezone);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end || timezone !== P4_PLAN_TIMEZONE)
    throw Object.assign(new Error("Rango o timezone inválido."), { code: "P4_PLAN_INVALID_RANGE" });
  const startMs = Date.parse(`${start}T00:00:00Z`), endMs = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || Math.floor((endMs - startMs) / 86_400_000) + 1 > P4_PLAN_MAX_DAYS)
    throw Object.assign(new Error("El rango excede el máximo permitido."), { code: "P4_PLAN_INVALID_RANGE" });
  const requested = Array.isArray(row.profileGroups) ? row.profileGroups.map(text) : [];
  const groupIds = [...new Set(requested)].sort();
  if (!groupIds.length || groupIds.some(id => !P4_PLAN_GROUPS[id])) throw Object.assign(new Error("Grupo no autorizado o inexistente."), { code: "P4_PLAN_GROUP_NOT_FOUND" });
  return { range: { start, end, timezone: P4_PLAN_TIMEZONE }, groupIds };
}

function iqClientId(row: Record<string, unknown>): string { return first(row, ["client_id", "clientId", "customer_id"]) || nestedId(row.client); }
function invoiceId(row: Record<string, unknown>): string { return first(row, ["id", "invoice_id", "invoiceId", "folio"]); }
function paymentId(row: Record<string, unknown>): string { return first(row, ["id", "deposit_id", "depositId", "folio"]); }
function applicationId(row: Record<string, unknown>): string { return first(row, ["id", "application_id", "applicationId"]); }
function appInvoiceId(row: Record<string, unknown>): string { return first(row, ["invoice_id", "invoiceId", "solicitud_iq_id"]); }
function appPaymentId(row: Record<string, unknown>): string { return first(row, ["deposit_id", "payment_id", "depositId", "paymentId"]); }
function appStatus(row: Record<string, unknown>): P4ApplicationStatus {
  const status = upper(row.operation_status ?? row.status ?? row.conciliation_status);
  if (/CANCEL/.test(status)) return "CANCELLED"; if (/REVERS|REVERT/.test(status)) return "REVERSED"; if (/REJECT/.test(status)) return "REJECTED";
  if (!status || /ACTIVE|APPLIED|CONCILI|SUCCESS|COMPLET|EN[\s_-]*OPERACI[OÓ]N/.test(status)) return "ACTIVE"; return "UNKNOWN";
}
function aliases(entityType: P4EntityType): string[] {
  if (entityType === "CLIENT") return ["iqClientId", "iqId", "externalIqId", "originalIqEntityId", "rfc"];
  if (entityType === "SOLICITUD") return ["iqId", "iqFolio", "iqInvoiceId", "externalIqId", "originalIqEntityId"];
  if (entityType === "PAYMENT") return ["iqDepositId", "iqDepositFolio", "iqPagoDepositId", "iqPagoDepositFolio", "iqId", "iqFolio", "externalIqId", "originalIqEntityId"];
  return ["iqApplicationId", "externalIqId", "originalIqEntityId"];
}
function collection(entityType: P4EntityType): Pay0PlanRow["collection"] { return ({ CLIENT: "clients", SOLICITUD: "solicitudes", PAYMENT: "pagos", APPLICATION: "pagoAplicaciones" })[entityType] as Pay0PlanRow["collection"]; }
function targetCandidates(rows: Pay0PlanRow[], type: P4EntityType, iqId: string, group?:P4PlanGroup) {
  return rows.filter(row => {
    if(row.collection!==collection(type))return false;
    const identityMatch=aliases(type).some(field=>text(row.data[field])===iqId)||(type==="CLIENT"&&[text(object(row.data.iqLink).clientId),text(object(row.data.originClientIqLink).clientIqId),...Object.values(object(row.data.iqLinksByProfile)).map(link=>text(object(link).clientId))].includes(iqId));
    if(!identityMatch||type!=="CLIENT")return identityMatch;
    const persistedGroup=text(row.data.canonicalIqGroupId),profiles=[text(object(row.data.iqLink).profileId),text(object(row.data.originClientIqLink).profileId),...Object.keys(object(row.data.iqLinksByProfile))].filter(Boolean);
    return !!group&&(persistedGroup===group.groupId||profiles.some(profileId=>group.memberProfileIds.includes(profileId)));
  });
}
function crossCollectionCandidates(rows:Pay0PlanRow[],type:P4EntityType,iqId:string){const expected=collection(type),identityFields=["iqId","iqFolio","iqInvoiceId","iqDepositId","iqDepositFolio","iqPagoDepositId","iqPagoDepositFolio","iqApplicationId","externalIqId","originalIqEntityId"];return rows.filter(row=>row.collection!==expected&&identityFields.some(field=>text(row.data[field])===iqId));}
function resolveCandidates(rows:Pay0PlanRow[],type:P4EntityType,item:Logical):{matches:Pay0PlanRow[];method:"EXACT_IQ_ID"|"PREAPPROVED_MAPPING"}{
  const exact=targetCandidates(rows,type,item.id,item.group);if(exact.length)return{matches:exact,method:"EXACT_IQ_ID"};
  const folio=first(item.raw,["folio","external_reference","reference"]);if(folio&&type!=="APPLICATION")return{matches:rows.filter(row=>row.collection===collection(type)&&values(row.data,["folio","iqFolio","externalReference","reference"]).includes(folio)),method:"PREAPPROVED_MAPPING"};
  return{matches:[],method:"EXACT_IQ_ID"};
}
function isPurged(tombstones: TombstonePlanRow[], keys: string[]) { return tombstones.some(t => values(t.data, ["entityId", "folio", "iqEntityId", "iqId"]).some(value => keys.includes(value))); }
function mutableFields(type: P4EntityType) { const identity=["iqUsername","associatedName","adminId","identityMappingVersion","identityMappingHash"],canonical=["rootId","clientId","clienteId","companyId","companyName","empresaNombre","despachoId","companyNumber","empresaNumero","folio","status","canonicalFolio",...identity];return type === "CLIENT" ? ["rootId","iqClientId", "iqClientName", "iqLink", "iqLinksByProfile", "originClientIqLink", "source", "name", "razonSocial", "rfc", "active", "createdAt",...identity] : type === "SOLICITUD" ? [...canonical,"iqId", "iqFolio", "monto", "moneda", "totalAbonado", "saldoPendiente", "createdAt","invoiceStatus","tipoFactura","facturaMetodoPago","facturaFolio","facturaSerie","facturaDisplay","facturaUuid","uuidCfdi","fiscalEvidenceSource"] : type === "PAYMENT" ? [...canonical,"iqDepositId", "monto", "montoTotal", "montoAplicado", "montoDisponible", "moneda", "totalAplicado", "saldoDisponible", "createdAt", "fechaPago", "reportDateAt"] : ["rootId","clientId","clienteId","iqApplicationId", "solicitudId", "pagoId", "montoAplicado", "montoTotal", "moneda", "status", "createdAt", "appliedAt",...identity] ; }

type Logical = { kind: IqPlanKind; id: string; group: P4PlanGroup; observed: string[]; raw: Record<string, unknown>; inRange: boolean };
function logicalRows(input: PlannerInput): Logical[] {
  const out = new Map<string, Logical>();
  for (const row of input.iqRows) {
    const group = Object.values(P4_PLAN_GROUPS).find(item => input.groupIds.includes(item.groupId) && item.memberProfileIds.includes(row.profileId));
    if (!group || !row.id) continue; const key = `${group.groupId}:${row.kind}:${row.id}`, prior = out.get(key);
    if (prior) { prior.observed = [...new Set([...prior.observed, row.profileId])].sort(); prior.inRange ||= row.inRange; }
    else out.set(key, { kind: row.kind, id: row.id, group, observed: [row.profileId], raw: row.raw, inRange: row.inRange });
  }
  return [...out.values()].sort((a, b) => `${a.group.groupId}:${a.kind}:${a.id}`.localeCompare(`${b.group.groupId}:${b.kind}:${b.id}`));
}

function operationalIdentity(item:Logical,logical:Logical[]){
  const direct=object(item.raw.__p4Responsibility);if(Object.keys(direct).length)return direct;
  if(item.kind!=="CLIENT")return direct;
  const dependent=logical.find(candidate=>candidate.group.groupId===item.group.groupId&&candidate.kind!=="CLIENT"&&iqClientId(candidate.raw)===item.id&&Object.keys(object(candidate.raw.__p4Responsibility)).length);
  const inherited=object(dependent?.raw.__p4Responsibility);return Object.keys(inherited).length?{...inherited,associatedName:text(dependent?.raw.__p4AssociatedName)}:inherited;
}

function existingTime(value:unknown):number|null{if(value&&typeof value==="object"&&typeof (value as {toDate?:unknown}).toDate==="function"){const ms=((value as {toDate:()=>Date}).toDate()).getTime();return Number.isFinite(ms)?ms:null;}const ms=typeof value==="string"||value instanceof Date?new Date(value as string|Date).getTime():NaN;return Number.isFinite(ms)?ms:null;}
function makeAction(input: PlannerInput, item: Logical, entityType: P4EntityType, operation: P4ActionOperation, targetId: string, evidence: Record<string, unknown>, after: Record<string, unknown>, reason: string, dependencies: string[] = [], existing:Record<string,unknown>|null=null): P4Action {
  const historicalTime=normalizeIqHistoricalDate(entityType,item.raw);
  if(historicalTime.required&&historicalTime.availability!=="EXACT"&&["RECONCILE","CREATE_HISTORICAL","DEPENDENCY_IMPORT"].includes(operation)){operation="HISTORICAL_DATE_REVIEW_REQUIRED";after={};reason="Required IQ historical timestamp is missing or invalid";}
  else if(operation==="RECONCILE"&&entityType!=="CLIENT"&&historicalTime.normalizedAt){const field=entityType==="PAYMENT"?(existing?.fechaPago??existing?.reportDateAt??existing?.createdAt):entityType==="APPLICATION"?(existing?.appliedAt??existing?.createdAt):existing?.createdAt;const current=existingTime(field),planned=Date.parse(historicalTime.normalizedAt);if(current!==null&&current!==planned){operation="HISTORICAL_DATE_REVIEW_REQUIRED";after={};reason="Existing PAY0 historical timestamp conflicts with exact IQ evidence";}else after={...after,...temporalAfter(entityType,historicalTime)};}
  else if(!["REVIEW_REQUIRED","CLIENT_REVIEW_REQUIRED","FINANCIAL_RECONCILIATION_REVIEW","HISTORICAL_DATE_REVIEW_REQUIRED","SKIP_PURGED"].includes(operation)&&operation!=="RECONCILE")after={...after,...temporalAfter(entityType,historicalTime)};
  const actionId = deterministicId(String(P4_ENGINE_VERSION), entityType, item.id, item.group.groupId);
  return { actionId, entityType, iqEntityId: item.id, canonicalGroupId: item.group.groupId, canonicalIqProfileId: item.group.canonicalIqProfileId,
    observedThroughProfileIds: item.observed, rootId: input.rootId, targetPath: `${collection(entityType)}/${targetId}`, operation, matchingEvidence: evidence,
    tombstoneKeys: [...new Set([item.id, first(item.raw, ["folio"])] .filter(Boolean))].sort(), after, mutableFields: mutableFields(entityType), reason, dependencies, historicalTime,
    expectedDelta: { operation, fields: Object.keys(after).sort(), relationships: dependencies, expectedExternalEffects: 0 } };
}

const minor=(value:unknown)=>Math.round(Number(value)*100);
function componentDepth(component:P4FinancialComponent,applicationId:string){
  const neighbors=new Map<string,Set<string>>(),link=(a:string,b:string)=>{if(!neighbors.has(a))neighbors.set(a,new Set());if(!neighbors.has(b))neighbors.set(b,new Set());neighbors.get(a)!.add(b);neighbors.get(b)!.add(a);};
  for(const app of component.applications){const a=`A:${app.id}`;link(a,`I:${app.solicitudId}`);link(a,`P:${app.paymentId}`);}
  const start=`A:${applicationId}`,queue:Array<[string,number]>=[[start,0]],seen=new Set<string>();let depth=0;
  while(queue.length){const [node,distance]=queue.shift()!;if(seen.has(node))continue;seen.add(node);depth=Math.max(depth,distance);for(const next of [...(neighbors.get(node)||[])].sort())if(!seen.has(next))queue.push([next,distance+1]);}
  return depth;
}
function componentEvidence(component:P4FinancialComponent,error:unknown){
  const active=component.applications.filter(app=>app.status==="ACTIVE"),invariants:Array<Record<string,unknown>>=[];
  for(const invoice of component.solicitudes){const applied=active.filter(app=>app.solicitudId===invoice.id).reduce((sum,app)=>sum+minor(app.amount),0),total=minor(invoice.amount);if(applied>total)invariants.push({type:"INVOICE_OVER_APPLICATION",entityId:invoice.id,total:total/100,applied:applied/100,excess:(applied-total)/100,applicationIds:active.filter(app=>app.solicitudId===invoice.id).map(app=>app.id).sort()});}
  for(const payment of component.payments){const applied=active.filter(app=>app.paymentId===payment.id).reduce((sum,app)=>sum+minor(app.amount),0),total=minor(payment.amount);if(applied>total)invariants.push({type:"PAYMENT_OVER_APPLICATION",entityId:payment.id,total:total/100,applied:applied/100,excess:(applied-total)/100,applicationIds:active.filter(app=>app.paymentId===payment.id).map(app=>app.id).sort()});}
  const duplicates=new Map<string,string[]>();for(const app of active){const key=[app.solicitudId,app.paymentId,minor(app.amount),upper(app.currency)].join("|");duplicates.set(key,[...(duplicates.get(key)||[]),app.id]);}
  const duplicateCandidates=[...duplicates.entries()].filter(([,ids])=>ids.length>1).map(([key,ids])=>{const [invoiceId,paymentId,amountMinor,currency]=key.split("|");return{classification:"FINANCIAL_DUPLICATE_CANDIDATE",applicationIds:ids.sort(),invoiceId,paymentId,amount:Number(amountMinor)/100,currency,status:"ACTIVE"};}).sort((a,b)=>a.applicationIds.join(":").localeCompare(b.applicationIds.join(":")));
  return{componentId:component.componentId,componentInvoiceIds:component.invoiceIds,componentPaymentIds:component.paymentIds,componentApplicationIds:component.applicationIds,componentEntityCount:component.entityCount,financialReview:true,financialCode:text((error as {code?:unknown})?.code)||"P4_FINANCIAL_INVARIANT_FAILED",invariantFailureReason:"Applications exceed a parent total or violate a component financial invariant",invariants,duplicateCandidates};
}

export function buildServerPlan(input: PlannerInput): { manifest: P4Manifest; summary: Record<string, unknown> } {
  const logical = logicalRows(input); const byKey = new Map(logical.map(item => [`${item.group.groupId}:${item.kind}:${item.id}`, item]));
  // Add client nodes observed inside financial rows. They are dependencies, never a historical crawl.
  for (const item of [...logical]) { const id = iqClientId(item.raw); const key = `${item.group.groupId}:CLIENT:${id}`; if (id && !byKey.has(key)) { const child: Logical = { kind: "CLIENT", id, group: item.group, observed: item.observed, raw: object(item.raw.client), inRange: false }; logical.push(child); byKey.set(key, child); } }
  logical.sort((a,b) => `${a.group.groupId}:${a.kind}:${a.id}`.localeCompare(`${b.group.groupId}:${b.kind}:${b.id}`));
  const actions: P4Action[] = []; const targetByGraph = new Map<string,string>(),actionByGraph=new Map<string,P4Action>();
  for (const item of logical.filter(x => x.kind !== "APPLICATION")) {
    const type = item.kind as P4EntityType, keys = [item.id, first(item.raw, ["folio"])].filter(Boolean);
    const resolved=resolveCandidates(input.pay0Rows,type,item),matches=resolved.matches; let op: P4ActionOperation; let targetId: string; let evidence: Record<string,unknown>; let reason: string;
    if (isPurged(input.tombstones, keys)) { op="SKIP_PURGED"; targetId=safeId("review",item.group.groupId,type,item.id); evidence={method:"P1_TOMBSTONE",keys}; reason="P1 tombstone server-side"; }
    else if (P4_PROTECTED_REVIEW_IQ_IDS.has(item.id)) { op=type==="CLIENT"?"CLIENT_REVIEW_REQUIRED":"REVIEW_REQUIRED"; targetId=safeId("review",item.group.groupId,type,item.id); evidence={method:"UNRESOLVED_STRONG_ID",iqEntityId:item.id,protectedHistoricalReview:true}; reason="Protected historical entity requires explicit review"; }
    else if (matches.length > 1) { op=type==="CLIENT"?"CLIENT_REVIEW_REQUIRED":"REVIEW_REQUIRED"; targetId=safeId("review",item.group.groupId,type,item.id); evidence={method:"UNRESOLVED_STRONG_ID",candidateCount:matches.length}; reason="Multiple PAY0 roots match the strong IQ identifier"; }
    else if (matches.length === 1) { const legacyImport=matches[0].data.source==="IQ_IMPORT"&&Number(matches[0].data.importVersion||0)<7; targetId=matches[0].id; op=legacyImport||resolved.method!=="EXACT_IQ_ID"?"RECONCILE":"NO_OP"; evidence={method:resolved.method,targetId,...(legacyImport?{legacyImportVersion:Number(matches[0].data.importVersion||0),legacyManifestId:text(matches[0].data.importManifestId),legacyRunId:text(matches[0].data.importRunId),legacyActionId:text(matches[0].data.p4ActionId)}:{})}; reason=legacyImport?"Previous historical document requires R3 reconciliation":op==="NO_OP"?"Strong IQ link already present":"PAY0 root exists and needs IQ metadata"; }
    else { const dependentApplicationIds=logical.filter(candidate=>candidate.kind==="APPLICATION"&&(type==="SOLICITUD"?appInvoiceId(candidate.raw):type==="PAYMENT"?appPaymentId(candidate.raw):iqClientId(candidate.raw))===item.id).map(candidate=>candidate.id).sort();targetId=safeId(type.toLowerCase(),item.group.groupId,item.id); op=type==="CLIENT"?"CREATE_HISTORICAL":item.inRange?"CREATE_HISTORICAL":"DEPENDENCY_IMPORT"; evidence={method:"EXACT_IQ_ID",iqEntityId:item.id,...(type==="CLIENT"?{identitySource:"IQ_CLIENT_CATALOG_EXACT_NAME",rfc:upper(item.raw.rfc),companyRequired:false,accessStrategy:"ROOT_SCOPED"}:{...(!item.inRange?{originalTimestamp:first(item.raw,["created_at","createdAt","date","fecha"]),reasonForInclusion:"P4F_GRAPH_CLOSURE",dependentApplicationIds}: {})})}; reason=type==="CLIENT"?"Authoritative IQ client absent from PAY0":item.inRange?"IQ entity absent from PAY0":"Required parent outside requested range"; }
    const clientKey=`${item.group.groupId}:CLIENT:${iqClientId(item.raw)}`,clientTarget=targetByGraph.get(clientKey),clientAction=actionByGraph.get(clientKey);
    const clientMapping={iqClientId:item.id,iqClientName:first(item.raw,["name"]),iqLink:{status:"LINKED",active:true,clientId:item.id,clientName:first(item.raw,["name"]),profileId:item.group.canonicalIqProfileId,source:"P4I_EXACT_IQ_CLIENT"},iqLinksByProfile:{[item.group.canonicalIqProfileId]:{status:"LINKED",active:true,clientId:item.id,clientName:first(item.raw,["name"]),profileId:item.group.canonicalIqProfileId,source:"P4I_EXACT_IQ_CLIENT"}},originClientIqLink:{profileId:item.group.canonicalIqProfileId,clientIqId:item.id,clientIqName:first(item.raw,["name"])} };
    let after:Record<string,unknown> = ["REVIEW_REQUIRED","CLIENT_REVIEW_REQUIRED","SKIP_PURGED"].includes(op) ? {} : type==="CLIENT" ? {...clientMapping,name:first(item.raw,["name"]),razonSocial:first(item.raw,["name"]),rfc:upper(item.raw.rfc),active:true}
      : type==="SOLICITUD" ? { iqId:item.id, iqFolio:first(item.raw,["folio"]), clientId:clientTarget||null, monto:amount(item.raw), moneda:currency(item.raw) }
      : { iqDepositId:item.id, clientId:clientTarget||null, monto:amount(item.raw), moneda:currency(item.raw) };
    const semantics=object(item.raw.__p4EntitySemantics),crossMatches=type==="CLIENT"?[]:crossCollectionCandidates(input.pay0Rows,type,item.id);
    if(type!=="CLIENT"&&text(semantics.status)!=="VERIFIED"){op="REVIEW_REQUIRED";reason=text(semantics.status)==="MISMATCH"?"IQ payload semantics contradict endpoint routing":"IQ payload does not prove its entity class";evidence={method:"ENTITY_SEMANTICS_REVIEW",semantics};after={};}
    if(type!=="CLIENT"&&crossMatches.length){op="REVIEW_REQUIRED";reason="IQ identity already exists in a different PAY0 collection";evidence={method:"CROSS_COLLECTION_IDENTITY_CONFLICT",expectedCollection:collection(type),conflicts:crossMatches.map(row=>`${row.collection}/${row.id}`).sort()};after={};}
    if(type==="SOLICITUD"&&Object.keys(after).length){const fiscal=resolveFiscalEvidence(item.raw);evidence={...evidence,fiscal};if(fiscal.decision==="REVIEW_REQUIRED"){op="REVIEW_REQUIRED";reason=fiscal.reviewCode||"FISCAL_METHOD_REVIEW_REQUIRED";after={};}else after={...after,invoiceStatus:fiscal.invoiceStatus,...(fiscal.fiscalMethod?{tipoFactura:fiscal.fiscalMethod,facturaMetodoPago:fiscal.fiscalMethod}:{}),...(fiscal.folio?{facturaFolio:fiscal.folio,facturaDisplay:[fiscal.serie,fiscal.folio].filter(Boolean).join("-")}:{}),...(fiscal.serie?{facturaSerie:fiscal.serie}:{}),...(fiscal.uuid?{facturaUuid:fiscal.uuid,uuidCfdi:fiscal.uuid}:{}),fiscalEvidenceSource:fiscal.source};}
    if(Object.keys(after).length){const identity=operationalIdentity(item,logical),adminId=text(identity.adminId),associatedName=text(item.raw.__p4AssociatedName)||text(identity.associatedName);evidence={...evidence,operationalIdentity:identity};if(text(identity.status)!=="RESOLVED"||!adminId||!associatedName){op=type==="CLIENT"?"CLIENT_REVIEW_REQUIRED":"REVIEW_REQUIRED";reason=text(identity.reviewCode)||"OPERATIONAL_IDENTITY_REVIEW_REQUIRED";after={};}else after={...after,iqUsername:text(identity.iqUsername),associatedName,adminId,identityMappingVersion:text(identity.policyVersion),identityMappingHash:text(identity.policyHash)};}
    if(type!=="CLIENT"&&(!iqClientId(item.raw)||!clientTarget||["SKIP_PURGED","REVIEW_REQUIRED","CLIENT_REVIEW_REQUIRED","FINANCIAL_RECONCILIATION_REVIEW"].includes(clientAction?.operation||""))){op="CLIENT_REVIEW_REQUIRED";reason="Client root is not executable or resolved";evidence={method:"UNRESOLVED_STRONG_ID",clientIqId:iqClientId(item.raw),clientResolution:object(item.raw.__p4ClientResolution)};for(const key of Object.keys(after))delete after[key];}
    const action=makeAction(input,item,type,op,targetId,evidence,after,reason,clientAction?[clientAction.actionId]:[],matches[0]?.data||null); if(matches[0]?.data.source==="IQ_IMPORT"&&Number(matches[0].data.importVersion||0)<7)action.reconciliationOf={manifestId:text(matches[0].data.importManifestId),runId:text(matches[0].data.importRunId),actionId:text(matches[0].data.p4ActionId),importVersion:Number(matches[0].data.importVersion||0)}; actions.push(action); const graphKey=`${item.group.groupId}:${item.kind}:${item.id}`;targetByGraph.set(graphKey,action.targetPath.split("/")[1]);actionByGraph.set(graphKey,action);
  }
  const graphSolicitudes: Array<{id:string;amount:number;currency:string;canonicalGroupId:string}> = [], graphPayments: Array<{id:string;amount:number;currency:string;canonicalGroupId:string}> = [];
  for (const item of logical) { if(item.kind==="SOLICITUD") graphSolicitudes.push({id:item.id,amount:amount(item.raw),currency:currency(item.raw),canonicalGroupId:item.group.groupId}); if(item.kind==="PAYMENT") graphPayments.push({id:item.id,amount:amount(item.raw),currency:currency(item.raw),canonicalGroupId:item.group.groupId}); }
  const graphApplications: Array<{id:string;solicitudId:string;paymentId:string;amount:number;currency:string;status:P4ApplicationStatus;canonicalGroupId:string}> = [];
  for (const item of logical.filter(x=>x.kind==="APPLICATION")) {
    const sid=appInvoiceId(item.raw), pid=appPaymentId(item.raw), sk=`${item.group.groupId}:SOLICITUD:${sid}`, pk=`${item.group.groupId}:PAYMENT:${pid}`;
    const closure=object(item.raw.__p4Closure),closureStatus=text(closure.status)||"COMPLETE";
    const parentActions=[actionByGraph.get(sk),actionByGraph.get(pk)],explicitClientKey=`${item.group.groupId}:CLIENT:${iqClientId(item.raw)}`,parentClientTargets=[...new Set(parentActions.map(action=>text(action?.after.clientId)).filter(Boolean))],clientTarget=targetByGraph.get(explicitClientKey)||(parentClientTargets.length===1?parentClientTargets[0]:""),clientAction=actionByGraph.get(explicitClientKey)||actions.find(candidate=>candidate.entityType==="CLIENT"&&parentActions.some(parent=>parent?.dependencies?.includes(candidate.actionId))),hasParents=!!sid&&!!pid&&byKey.has(sk)&&byKey.has(pk),clientBlocked=!clientTarget||!clientAction||['SKIP_PURGED','REVIEW_REQUIRED','CLIENT_REVIEW_REQUIRED','FINANCIAL_RECONCILIATION_REVIEW','HISTORICAL_DATE_REVIEW_REQUIRED'].includes(clientAction.operation)||parentActions.some(action=>action?.operation==="CLIENT_REVIEW_REQUIRED"),strong=closureStatus==="COMPLETE"&&hasParents&&!clientBlocked&&parentActions.every(action=>action&&!['SKIP_PURGED','REVIEW_REQUIRED','CLIENT_REVIEW_REQUIRED','FINANCIAL_RECONCILIATION_REVIEW','HISTORICAL_DATE_REVIEW_REQUIRED'].includes(action.operation)); const matches=targetCandidates(input.pay0Rows,"APPLICATION",item.id); const keys=[item.id];
    if(hasParents)graphApplications.push({id:item.id,solicitudId:sid,paymentId:pid,amount:amount(item.raw),currency:currency(item.raw),status:appStatus(item.raw),canonicalGroupId:item.group.groupId});
    let op:P4ActionOperation, targetId:string, reason:string, evidence:Record<string,unknown>, after:Record<string,unknown>={};
    if(isPurged(input.tombstones,keys)){op="SKIP_PURGED";targetId=safeId("review",item.group.groupId,"APPLICATION",item.id);reason="P1 tombstone server-side";evidence={method:"P1_TOMBSTONE",keys};}
    else if(!strong){op=clientBlocked?"CLIENT_REVIEW_REQUIRED":"REVIEW_REQUIRED";targetId=safeId("review",item.group.groupId,"APPLICATION",item.id);reason=clientBlocked?"Application client root is not executable or resolved":closureStatus==="COMPLETE"?"Application is missing a strong payment or invoice root":"Application graph closure is incomplete";evidence={method:"UNRESOLVED_STRONG_ID",invoiceId:sid,paymentId:pid,closureStatus,depth:Number(closure.depth||0),entityCount:Number(closure.entityCount||0)};}
    else { if(matches.length>1){op="REVIEW_REQUIRED";targetId=safeId("review",item.group.groupId,"APPLICATION",item.id);reason="Multiple PAY0 application roots";evidence={method:"UNRESOLVED_STRONG_ID",candidateCount:matches.length};}
      else {targetId=matches[0]?.id||safeId("application",item.group.groupId,item.id);op=matches.length?"NO_OP":item.inRange?"CREATE_HISTORICAL":"DEPENDENCY_IMPORT";reason=matches.length?"Strong IQ application link already present":item.inRange?"Strong IQ graph resolved":"Required balance application outside requested range";evidence={method:"IQ_GRAPH_RELATION",invoiceId:sid,paymentId:pid,clientIqId:iqClientId(item.raw),closureStatus,depth:Number(closure.depth||0),entityCount:Number(closure.entityCount||0),...(!item.inRange?{originalTimestamp:first(item.raw,["created_at","createdAt","date","fecha"]),reasonForInclusion:"P4F_BALANCE_CLOSURE"}: {})}; const status=appStatus(item.raw),semantics=object(item.raw.__p4EntitySemantics),identity=object(item.raw.__p4Responsibility),adminId=text(identity.adminId);after={iqApplicationId:item.id,solicitudId:targetByGraph.get(sk),pagoId:targetByGraph.get(pk),clientId:clientTarget,montoAplicado:amount(item.raw),moneda:currency(item.raw),status,rawIqStatus:first(item.raw,["operation_status","status","conciliation_status"]),iqUsername:text(identity.iqUsername),associatedName:text(item.raw.__p4AssociatedName),adminId,identityMappingVersion:text(identity.policyVersion),identityMappingHash:text(identity.policyHash)};if(status==="UNKNOWN"||text(semantics.status)!=="VERIFIED"||text(identity.status)!=="RESOLVED"||!adminId){op="REVIEW_REQUIRED";reason=status==="UNKNOWN"?"Unknown IQ application status":text(semantics.status)!=="VERIFIED"?"IQ application semantics are not verified":text(identity.reviewCode)||"OPERATIONAL_IDENTITY_REVIEW_REQUIRED";evidence={...evidence,method:"UNRESOLVED_STRONG_ID",rawStatus:after.rawIqStatus,semantics,operationalIdentity:identity};after={};}}}
    const action=makeAction(input,item,"APPLICATION",op,targetId,evidence,after,reason,strong?[clientAction!.actionId,deterministicId(String(P4_ENGINE_VERSION),"SOLICITUD",sid,item.group.groupId),deterministicId(String(P4_ENGINE_VERSION),"PAYMENT",pid,item.group.groupId)]:[],matches[0]?.data||null);if(matches[0]?.data.source==="IQ_IMPORT"&&Number(matches[0].data.importVersion||0)<7){action.operation="RECONCILE";action.reason="Previous historical document requires R3 reconciliation";action.reconciliationOf={manifestId:text(matches[0].data.importManifestId),runId:text(matches[0].data.importRunId),actionId:text(matches[0].data.p4ActionId),importVersion:Number(matches[0].data.importVersion||0)};}actions.push(action);
  }
  const components=partitionFinancialComponents(graphSolicitudes,graphPayments,graphApplications),componentBalances=new Map<string,ReturnType<typeof reconstructBalances>>(),reviewComponents=new Set<string>();
  const actionFor=(component:P4FinancialComponent,type:P4EntityType,id:string)=>actions.find(action=>action.canonicalGroupId===component.canonicalGroupId&&action.entityType===type&&action.iqEntityId===id);
  for(const component of components){
    const componentActions=[...component.invoiceIds.map(id=>actionFor(component,"SOLICITUD",id)),...component.paymentIds.map(id=>actionFor(component,"PAYMENT",id)),...component.applicationIds.map(id=>actionFor(component,"APPLICATION",id))].filter(Boolean) as P4Action[];
    for(const action of componentActions){action.componentId=component.componentId;action.matchingEvidence={...action.matchingEvidence,componentId:component.componentId,componentInvoiceIds:component.invoiceIds,componentPaymentIds:component.paymentIds,componentApplicationIds:component.applicationIds,componentEntityCount:component.entityCount,...(action.entityType==="APPLICATION"?{depth:componentDepth(component,action.iqEntityId),entityCount:component.entityCount,additionalApplicationIds:component.applicationIds.filter(id=>id!==action.iqEntityId)}:{})};}
    const componentClientIds=[...new Set(componentActions.map(action=>text(action.after.clientId)).filter(Boolean))];
    if(componentClientIds.length>1){reviewComponents.add(component.componentId);for(const action of componentActions){if(action.operation==="FINANCIAL_RECONCILIATION_REVIEW"||action.operation==="SKIP_PURGED")continue;action.operation="CLIENT_REVIEW_REQUIRED";action.after={};action.reason="Financial component resolves to incompatible clients";action.matchingEvidence={...action.matchingEvidence,method:"UNRESOLVED_STRONG_ID",clientConflictIds:componentClientIds,clientFinancialConflict:true};}}
    if(componentActions.some(action=>action.operation==="CLIENT_REVIEW_REQUIRED")){reviewComponents.add(component.componentId);for(const action of componentActions){if(action.operation==="FINANCIAL_RECONCILIATION_REVIEW"||action.operation==="SKIP_PURGED")continue;action.operation="CLIENT_REVIEW_REQUIRED";action.after={};action.reason="Financial component depends on an unresolved client";action.matchingEvidence={...action.matchingEvidence,method:"UNRESOLVED_STRONG_ID",clientFinancialConflict:true};}}
    try{const balances=reconstructBalances(component.solicitudes,component.payments,component.applications);componentBalances.set(component.componentId,balances);for(const action of componentActions)action.matchingEvidence={...action.matchingEvidence,financialState:"FINANCIALLY_VALID"};}
    catch(error){reviewComponents.add(component.componentId);const review=componentEvidence(component,error);for(const action of componentActions){if(action.operation==="SKIP_PURGED")continue;action.operation="FINANCIAL_RECONCILIATION_REVIEW";action.after={};action.reason="Connected financial component invariant requires review";action.matchingEvidence={...action.matchingEvidence,...review,method:"UNRESOLVED_STRONG_ID",financialState:"FINANCIAL_RECONCILIATION_REVIEW"};}}
  }
  enrichCanonicalV6({actions,rawByKey:new Map(logical.map(item=>[`${item.group.groupId}:${item.kind}:${item.id}`,item.raw])),companies:input.pay0Rows.filter(row=>row.collection==="companies").map(row=>({id:row.id,name:first(row.data,["nombre","name","razonSocial"]),despachoId:text(row.data.despachoId)||null,companyNumber:Number(row.data.companyNumber??row.data.numeroEmpresa)||null})),clients:input.pay0Rows.filter(row=>row.collection==="clients").map(row=>({id:row.id,rootId:text(row.data.rootId),data:row.data})),balances:componentBalances});
  const groups=input.groupIds.map(id=>P4_PLAN_GROUPS[id]).map(group=>({groupId:group.groupId,canonicalIqProfileId:group.canonicalIqProfileId,observedThroughProfileIds:[...new Set(logical.filter(x=>x.group.groupId===group.groupId).flatMap(x=>x.observed))].sort()}));
  const manifest=buildManifest({kind:P4_MANIFEST_KIND,version:P4_ENGINE_VERSION,range:input.range as {start:string;end:string;timezone:typeof P4_PLAN_TIMEZONE},canonicalGroups:groups,financialGraph:{solicitudes:graphSolicitudes,payments:graphPayments,applications:graphApplications},actions,expectedPay0Writes:0,expectedIqWrites:0,expectedExternalEffects:0});
  const counts=manifest.actions.reduce<Record<string,number>>((out,a)=>(out[a.operation]=(out[a.operation]||0)+1,out),{});
  const applicationActions=manifest.actions.filter(x=>x.entityType==="APPLICATION");
  const componentById=new Map(components.map(component=>[component.componentId,component]));
  const graphClosures=applicationActions.map(action=>{const evidence=action.matchingEvidence,sid=text(evidence.invoiceId),pid=text(evidence.paymentId),component=componentById.get(action.componentId||""),financialReview=action.operation==="FINANCIAL_RECONCILIATION_REVIEW",balances=componentBalances.get(action.componentId||"");return{applicationId:action.iqEntityId,componentId:action.componentId||null,parentInvoiceId:sid,parentPaymentId:pid,componentInvoiceIds:component?.invoiceIds||[],componentPaymentIds:component?.paymentIds||[],additionalApplicationIds:(component?.applicationIds||[]).filter(id=>id!==action.iqEntityId),depth:component?componentDepth(component,action.iqEntityId):Number(evidence.depth||0),entityCount:component?.entityCount||Number(evidence.entityCount||0),invoiceBalance:financialReview?null:balances?.solicitudes[sid]||null,paymentBalance:financialReview?null:balances?.payments[pid]||null,closureStatus:financialReview?"FINANCIAL_RECONCILIATION_REVIEW":text(evidence.closureStatus)||"REVIEW_REQUIRED",operation:action.operation,invariants:evidence.invariants||[],duplicateCandidates:evidence.duplicateCandidates||[]};});
  const executableOperations=new Set<P4ActionOperation>(["CREATE_HISTORICAL","DEPENDENCY_IMPORT","RECONCILE","NO_OP","EXISTING"]),reviewOperations=new Set<P4ActionOperation>(["CANONICAL_DEPENDENCY_PENDING","REVIEW_REQUIRED","CLIENT_REVIEW_REQUIRED","FINANCIAL_RECONCILIATION_REVIEW","HISTORICAL_DATE_REVIEW_REQUIRED"]);
  const componentSummary=components.map(component=>{const componentActions=manifest.actions.filter(action=>action.componentId===component.componentId),status=componentActions.some(action=>action.operation==="FINANCIAL_RECONCILIATION_REVIEW")?"FINANCIAL_RECONCILIATION_REVIEW":componentActions.some(action=>action.operation==="CLIENT_REVIEW_REQUIRED")?"CLIENT_REVIEW_REQUIRED":componentActions.some(action=>action.operation==="CANONICAL_DEPENDENCY_PENDING")?"CANONICAL_DEPENDENCY_PENDING":"FINANCIALLY_VALID";return{componentId:component.componentId,canonicalGroupId:component.canonicalGroupId,invoiceIds:component.invoiceIds,paymentIds:component.paymentIds,applicationIds:component.applicationIds,entityCount:component.entityCount,status};});
  const financialExecutableWithUnresolvedClient=manifest.actions.filter(action=>action.entityType!=="CLIENT"&&executableOperations.has(action.operation)&&!text(action.after.clientId)&&!action.dependencies?.some(id=>manifest.actions.some(candidate=>candidate.entityType==="CLIENT"&&candidate.actionId===id&&executableOperations.has(candidate.operation)))).length;
  return {manifest,summary:{plannerVersion:"P4-R3",logicalEntities:{clients:logical.filter(x=>x.kind==="CLIENT").length,invoices:graphSolicitudes.length,deposits:graphPayments.length,applications:logical.filter(x=>x.kind==="APPLICATION").length},counts,components:componentSummary,totalComponents:components.length,healthyComponents:components.length-reviewComponents.size,reviewComponents:reviewComponents.size,graphClosures,canonicalReady:manifest.actions.filter(action=>action.canonicalEvidence?.readiness==="CANONICAL_READY").length,canonicalReview:manifest.actions.filter(action=>action.canonicalEvidence?.readiness==="CANONICAL_REVIEW_REQUIRED").length,executableApplications:applicationActions.filter(x=>executableOperations.has(x.operation)).length,residualReviewApplications:applicationActions.filter(x=>reviewOperations.has(x.operation)).length,executableActions:manifest.actions.filter(x=>executableOperations.has(x.operation)).length,residualReviewActions:manifest.actions.filter(x=>reviewOperations.has(x.operation)).length,financialExecutableWithUnresolvedClient,tombstonesChecked:input.tombstones.length,iqWrites:0,externalEffects:0}};
}
