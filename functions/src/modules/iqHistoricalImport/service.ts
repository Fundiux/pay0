import * as admin from "firebase-admin";
import { randomUUID } from "node:crypto";
import { FieldValue, FieldPath } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { assertAuthorized, getUserRole } from "../../utils/authGuard";
import { getMyUser, requireAuth } from "../sharedCallables/helpers";
import {
  P4EngineError, ZERO_SIDE_EFFECTS, assertManifestHash, canonicalJson,
  deterministicId, historicalPayload, validateManifest,
  type P4Action, type P4ExecutionBudget, type P4Manifest,
} from "./domain";
import { discoverServerPlan, type DiscoveryBudget } from "./discovery";
import { buildServerPlan, validatePlanRequest } from "./planner";
import { P4_TEMPORAL_TIMESTAMP_FIELDS } from "./temporal";
import {
  actionEligibility, financialCanaryChains, isReviewAction,
  isWriteAction, selectCanaryAction, simulateCanarySequence, summarizeActionProgress,
  type P4ActionProgress, type P4CanaryPhase,
} from "./phasedExecution";
import { assessCanonicalReconciliation, assessV5V6Reconciliation, canonicalHistoricalFields } from "./canonicalPayload";
import { P4_EXECUTION_PROVENANCE_FIELD, assessApplicationParent, executionProvenance, hasExecutionProvenance, previewExecutionProvenanceRepair } from "./pass1Recovery";
import { buildFinancialComponentIsolation, type P4FinancialComponentIsolation } from "./financialComponentIsolation";
import { P4_SCOPE_SELECTOR_VERSION, assertScopeApproval, buildExecutionScope, scopeBudget, scopeCanaryQueue, scopeQueue, validateScopeRequest as validateExecutionScopeRequest, type P4HistoricalBatchEvidence, type P4Scope, type P4ScopeBudget } from "./batchScope";
import { P4O_R1_PHASES, P4O_R1_PROTECTED_FIELDS, buildCanonicalReconciliationPreview, fingerprint, priorPhases, queryEligible, reconciliationId, reconciliationSessionStatus, selectScopedAction, validateReconciliationRequest, type P4CanonicalReconciliationPhase } from "./canonicalReconciliation";
import { P4O_R4_SCOPE_ID, assertPatchContract, buildScopePreview, pendingScopeActions, phaseStatus, requiresPostClientPlan, scopeActionProgressId, scopeBackupId, scopeSessionId, selectScopeActions, validateScopeRequest, type P4ScopeActionState } from "./canonicalReconciliationScope";
import { R3_OPERATIONAL_POLICY, R3_OPERATIONAL_POLICY_BACKUP_ID, R3_OPERATIONAL_POLICY_HASH } from "./r3OperationalPolicy";
import { P4_MANIFEST_STORAGE_VERSION, decodeManifestChunks, encodeManifestChunks, manifestChunkId } from "./manifestStorage";
import {
  P4CurrentStateReader, evaluateHistoricalExecutionGuard, pay0StateEvidence,
  type P4CurrentStateEvidence, type P4TerminalDecision, type P4TerminalGuardResult,
} from "./terminalGuard";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const manifests = db.collection("p4ImportManifests");
const runs = db.collection("p4ImportRuns");
const locks = db.collection("p4ImportLocks");
const backups = db.collection("p4ImportDeltaBackups");
const audit = db.collection("p4ImportAudit");
const reconciliationSessions = db.collection("p4CanonicalReconciliations");
const reconciliationBackups = db.collection("p4CanonicalReconciliationBackups");
const r3PolicyBackups = db.collection("p4R3OperationalPolicyBackups");
const scopeEvidence = db.collection("p4ImportScopeEvidence");
const scopeApprovals = db.collection("p4ImportScopeApprovals");
const scopeLocks = db.collection("p4ImportScopeLocks");
const provenanceRepairSessions = db.collection("p4ProvenanceRepairSessions");
const financialComponentReviews = db.collection("p4FinancialComponentReviews");
const IQ_CREDENTIALS_KEY = defineSecret("IQ_CREDENTIALS_KEY");
const now = () => FieldValue.serverTimestamp();
const clean = (value: unknown, max = 180) => String(value ?? "").trim().slice(0, max);
function materializeTemporalFields(payload:Record<string,unknown>):Record<string,unknown>{const out={...payload};for(const field of P4_TEMPORAL_TIMESTAMP_FIELDS){const value=out[field];if(typeof value==="string"){const date=new Date(value);if(!Number.isFinite(date.getTime()))throw new P4EngineError("P4_HISTORICAL_DATE_REVIEW_REQUIRED",`Fecha histórica inválida en ${field}.`);out[field]=admin.firestore.Timestamp.fromDate(date);}}return out;}

type Context = { uid: string; rootId: string };
type Mode = "PLAN" | "APPROVE" | "PREVIEW_PHASE" | "PREVIEW_SCOPE" | "APPROVE_SCOPE" | "EXECUTE_SCOPE" | "RESUME_SCOPE" | "STATUS_SCOPE" | "VERIFY_SCOPE" | "ROLLBACK_SCOPE" | "PREVIEW_FINANCIAL_COMPONENT_ISOLATION" | "ISOLATE_FINANCIAL_COMPONENT" | "VERIFY_FINANCIAL_COMPONENT_ISOLATION" | "PREVIEW_RECONCILE_PROVENANCE_REPAIR" | "REPAIR_RECONCILE_PROVENANCE" | "VERIFY_RECONCILE_PROVENANCE_REPAIR" | "PREVIEW_CANONICAL_RECONCILIATION" | "PREVIEW_CANONICAL_RECONCILIATION_R1" | "PREVIEW_CANONICAL_RECONCILIATION_SCOPE" | "RECONCILE_CANONICAL" | "RECONCILE_CANONICAL_SCOPE" | "VERIFY_CANONICAL_RECONCILIATION" | "VERIFY_CANONICAL_RECONCILIATION_SCOPE" | "ROLLBACK_CANONICAL_RECONCILIATION" | "ROLLBACK_CANONICAL_RECONCILIATION_SCOPE" | "PREVIEW_R3_OPERATIONAL_POLICY" | "ACTIVATE_R3_OPERATIONAL_POLICY" | "VERIFY_R3_OPERATIONAL_POLICY" | "ROLLBACK_R3_OPERATIONAL_POLICY" | "EXECUTE" | "RESUME" | "STATUS" | "VERIFY" | "ROLLBACK";
const DEFAULT_BUDGET: P4ExecutionBudget = { maxEntities: 25, maxWrites: 100, maxDurationMs: 45_000, maxErrors: 1, maxBatches: 5 };

async function context(request: any): Promise<Context> {
  const uid = requireAuth(request), user = await getMyUser(uid);
  assertAuthorized(request.auth, user, { allowedRoles: ["superadmin"] });
  if (getUserRole(user) !== "superadmin") throw new HttpsError("permission-denied", "P4_UNAUTHORIZED");
  return { uid, rootId: clean(user.rootId || uid, 128) };
}

function publicError(error: unknown): never {
  if (error instanceof HttpsError) throw error;
  if (error instanceof P4EngineError) throw new HttpsError("failed-precondition", error.code, { p4Code: error.code });
  const stableCode=clean((error as {code?:unknown})?.code,80);
  if(/^P4_[A-Z0-9_]+$/.test(stableCode)) throw new HttpsError(stableCode==="P4_CLIENT_MANIFEST_FORBIDDEN"?"invalid-argument":"failed-precondition",stableCode,{p4Code:stableCode});
  console.error("P4_ENGINE_INTERNAL", error);
  throw new HttpsError("internal", "P4_INTERNAL");
}

function budget(input: any): P4ExecutionBudget {
  const number = (value: unknown, fallback: number, max: number) => Math.max(1, Math.min(max, Math.trunc(Number(value) || fallback)));
  return { maxEntities: number(input?.maxEntities, DEFAULT_BUDGET.maxEntities, 100), maxWrites: number(input?.maxWrites, DEFAULT_BUDGET.maxWrites, 400),
    maxDurationMs: number(input?.maxDurationMs, DEFAULT_BUDGET.maxDurationMs, 480_000), maxErrors: number(input?.maxErrors, DEFAULT_BUDGET.maxErrors, 20),
    maxBatches: number(input?.maxBatches, DEFAULT_BUDGET.maxBatches, 20) };
}

const serial = (snap: FirebaseFirestore.DocumentSnapshot) => ({ id: snap.id, ...snap.data() });
const actionDoc = (runId: string, actionId: string) => runs.doc(runId).collection("actions").doc(actionId);
function manifestFromRow(row: Record<string, any>): P4Manifest {
  return { manifestId: row.manifestId, manifestHash: row.manifestHash, status: row.status,
    kind: row.kind, version: row.version, range: row.range, canonicalGroups: row.canonicalGroups,
    actions: row.actions, financialGraph: row.financialGraph, expectedPay0Writes: row.expectedPay0Writes, expectedIqWrites: row.expectedIqWrites,
    expectedExternalEffects: row.expectedExternalEffects } as P4Manifest;
}

function planningBudget(input: any): DiscoveryBudget {
  const bounded=(value:unknown,fallback:number,max:number)=>Math.max(1,Math.min(max,Math.trunc(Number(value)||fallback)));
  return {maxPages:bounded(input?.maxPages,1800,2500),maxRecords:bounded(input?.maxRecords,10000,30000),maxFirestoreReads:bounded(input?.maxFirestoreReads,10000,20000),maxDurationMs:bounded(input?.maxDurationMs,420000,480000)};
}

async function plan(ctx: Context, data: any) {
  const request=validatePlanRequest(data), discovered=await discoverServerPlan({rootId:ctx.rootId,groupIds:request.groupIds,range:request.range,secret:IQ_CREDENTIALS_KEY.value(),budget:planningBudget(data?.planningBudget)});
  if(discovered.partial) return {ok:false,mode:"PLAN",status:"PLAN_PARTIAL",p4Code:"P4_PLAN_BUDGET_EXCEEDED",metrics:discovered.metrics,expectedIqWrites:0,expectedExternalEffects:0};
  const {manifest,summary}=buildServerPlan({rootId:ctx.rootId,range:request.range,groupIds:request.groupIds,iqRows:discovered.iqRows,pay0Rows:discovered.pay0Rows,tombstones:discovered.tombstones});
  if (manifest.actions.some(action => action.rootId !== ctx.rootId)) throw new P4EngineError("P4_ROOT_REVIEW_REQUIRED", "El manifest contiene otro root.");
  const planRunId=`p4p_${manifest.manifestHash.slice(0,24)}`;
  const ref = manifests.doc(manifest.manifestId), manifestChunks=encodeManifestChunks(manifest);
  await db.runTransaction(async tx => {
    const existing = await tx.get(ref);
    if (existing.exists) {
      if (existing.get("manifestHash") !== manifest.manifestHash) throw new P4EngineError("P4_MANIFEST_HASH_MISMATCH", "El ID ya existe con otro contenido.");
      return;
    }
    const {actions:_actions,financialGraph:_financialGraph,...manifestHeader}=manifest;
    tx.create(ref, { ...manifestHeader, manifestStorage:P4_MANIFEST_STORAGE_VERSION, chunkCount:manifestChunks.length, planRunId, planningSummary:summary, planningMetrics:discovered.metrics, serverGenerated:true, rootId: ctx.rootId, createdBy: ctx.uid, createdAt: now(), updatedAt: now(), approvedBy: null, approvedAt: null });
    manifestChunks.forEach((payload,index)=>tx.create(ref.collection("chunks").doc(manifestChunkId(index)),{index,payload}));
    tx.create(audit.doc(), { mode: "PLAN", planRunId, manifestId: manifest.manifestId, rootId: ctx.rootId, actorUid: ctx.uid, result: "PLANNED", metrics:discovered.metrics, createdAt: now() });
  });
  const counts = manifest.actions.reduce<Record<string, number>>((out, action) => { out[`${action.canonicalGroupId}:${action.entityType}:${action.operation}`] = (out[`${action.canonicalGroupId}:${action.entityType}:${action.operation}`] || 0) + 1; return out; }, {});
  return { ok: true, mode: "PLAN", planRunId, manifestId: manifest.manifestId, manifestHash: manifest.manifestHash, status: "PLANNED", counts, summary, metrics:discovered.metrics,
    expectedPay0Writes: manifest.expectedPay0Writes, expectedIqWrites: 0, expectedExternalEffects: 0 };
}

async function loadManifest(ctx: Context, manifestId: string): Promise<{ ref: FirebaseFirestore.DocumentReference; manifest: P4Manifest }> {
  const ref = manifests.doc(manifestId), snap = await ref.get();
  if (!snap.exists || snap.get("rootId") !== ctx.rootId) throw new P4EngineError("P4_MANIFEST_NOT_FOUND", "Manifest no disponible.");
  if (snap.get("serverGenerated") !== true) throw new P4EngineError("P4_CLIENT_MANIFEST_FORBIDDEN", "Sólo se aceptan manifests generados por el planner server-side.");
  let manifest:P4Manifest;
  if(snap.get("manifestStorage")===P4_MANIFEST_STORAGE_VERSION){
    const chunkCount=Number(snap.get("chunkCount")||0),chunkSnap=await ref.collection("chunks").orderBy("index").get();
    if(!Number.isInteger(chunkCount)||chunkCount<1||chunkSnap.size!==chunkCount)throw new P4EngineError("P4_MANIFEST_STORAGE_INCOMPLETE","Manifest segmentado incompleto.");
    try{manifest=decodeManifestChunks(chunkSnap.docs.map(doc=>String(doc.get("payload")||"")));}catch{throw new P4EngineError("P4_MANIFEST_STORAGE_INVALID","Manifest segmentado inválido.");}
    manifest={...manifest,status:snap.get("status")};
  }else manifest=manifestFromRow(snap.data() || {});
  assertManifestHash(manifest); validateManifest(manifest);
  return { ref, manifest };
}

function phase(value: unknown): P4CanaryPhase {
  const candidate = clean(value, 20).toUpperCase();
  if (!["CLIENT", "SOLICITUD", "PAYMENT", "APPLICATION"].includes(candidate)) throw new P4EngineError("P4_CANARY_PHASE_INVALID", "Phase canary invalida.");
  return candidate as P4CanaryPhase;
}

async function loadActionProgress(runId: string): Promise<P4ActionProgress> {
  if (!runId) return {};
  const snapshot = await runs.doc(runId).collection("actions").get();
  return Object.fromEntries(snapshot.docs.map(doc => [doc.id, clean(doc.get("status"), 40) || "PENDING"])) as P4ActionProgress;
}

function targetMatchesAction(snap: FirebaseFirestore.DocumentSnapshot, manifest: P4Manifest, action: P4Action): boolean {
  const current=(snap.data()||{}) as Record<string,unknown>,direct=snap.exists&&snap.get("p4ActionId")===action.actionId&&snap.get("importManifestId")===manifest.manifestId&&snap.get("source")==="IQ_IMPORT";
  if (!snap.exists) return false;
  if(hasExecutionProvenance(current,manifest,action))return true;
  return Boolean(direct)&&targetFieldsMatch(snap, action, action.after);
}

function fieldMatches(actual: unknown, expected: unknown): boolean {
  if (typeof expected === "string" && actual && typeof (actual as any).toMillis === "function") {
    const actualMs=(actual as any).toMillis(), expectedMs=Date.parse(expected); return Number.isFinite(expectedMs) && actualMs===expectedMs;
  }
  return canonicalJson(actual) === canonicalJson(expected);
}

function targetFieldsMatch(snap: FirebaseFirestore.DocumentSnapshot, action: P4Action, expectedAfter: Record<string, unknown>): boolean {
  return action.mutableFields.every(field => !(field in expectedAfter) || fieldMatches(snap.get(field), expectedAfter[field]));
}

function expectedAfterForProgress(manifest: P4Manifest, action: P4Action, progress: P4ActionProgress, verifiedTargets: Set<string>) {
  if (!action.componentId || !["SOLICITUD", "PAYMENT"].includes(action.entityType)) return action.after;
  const applications = manifest.actions.filter(candidate => candidate.componentId === action.componentId && candidate.entityType === "APPLICATION" && isWriteAction(candidate));
  const balancesApplied = applications.every(candidate => progress[candidate.actionId] === "COMPLETED" || verifiedTargets.has(candidate.actionId));
  if (balancesApplied) return action.after;
  return action.entityType === "SOLICITUD" ? { ...action.after, totalAbonado: 0, saldoPendiente: Number(action.after.monto || 0) }
    : { ...action.after, totalAplicado: 0, saldoDisponible: Number(action.after.monto || 0) };
}

async function loadVerifiedTargets(manifest: P4Manifest): Promise<Set<string>> {
  const actions = manifest.actions.filter(isWriteAction);
  const snapshots = actions.length ? await db.getAll(...actions.map(action => db.doc(action.targetPath))) : [];
  return new Set(actions.filter((action, index) => targetMatchesAction(snapshots[index], manifest, action)).map(action => action.actionId));
}

function dependencyPreview(manifest: P4Manifest, action: P4Action, progress: P4ActionProgress) {
  return (action.dependencies || []).map(actionId => {
    const dependency = manifest.actions.find(candidate => candidate.actionId === actionId);
    const satisfied = dependency ? ["NO_OP", "EXISTING"].includes(dependency.operation) || progress[actionId] === "COMPLETED" : false;
    return { actionId, entityType: dependency?.entityType || null, iqEntityId: dependency?.iqEntityId || null, operation: dependency?.operation || null, satisfied };
  });
}

function balancePreview(manifest: P4Manifest, action: P4Action) {
  if (action.entityType !== "APPLICATION") return null;
  const graph = manifest.financialGraph.applications.find(row => row.id === action.iqEntityId && clean(row.canonicalGroupId) === action.canonicalGroupId);
  if (!graph) return null;
  const invoice = manifest.actions.find(row => row.entityType === "SOLICITUD" && row.iqEntityId === graph.solicitudId && row.canonicalGroupId === action.canonicalGroupId);
  const payment = manifest.actions.find(row => row.entityType === "PAYMENT" && row.iqEntityId === graph.paymentId && row.canonicalGroupId === action.canonicalGroupId);
  const amount = Number(graph.amount || 0);
  const invoiceAfter = Number(invoice?.after.totalAbonado || 0), paymentAfter = Number(payment?.after.totalAplicado || 0);
  return {
    invoice: { id: graph.solicitudId, total: Number(invoice?.after.monto || 0), appliedBefore: invoiceAfter - amount, applicationAmount: amount, appliedAfter: invoiceAfter, pendingAfter: Number(invoice?.after.saldoPendiente || 0) },
    payment: { id: graph.paymentId, total: Number(payment?.after.monto || 0), appliedBefore: paymentAfter - amount, applicationAmount: amount, appliedAfter: paymentAfter, availableAfter: Number(payment?.after.saldoDisponible || 0) },
  };
}

function candidatePreview(manifest: P4Manifest, action: P4Action | null, progress: P4ActionProgress) {
  if (!action) return null;
  const temporalFields = Object.fromEntries(["createdAt", "fechaPago", "reportDateAt", "appliedAt"].filter(field => field in action.after).map(field => [field, action.after[field]]));
  const parentActions = action.entityType === "APPLICATION" ? (action.dependencies || []).map(id => manifest.actions.find(candidate => candidate.actionId === id)).filter((candidate): candidate is P4Action => !!candidate && ["SOLICITUD", "PAYMENT"].includes(candidate.entityType)) : [];
  const targetPaths = [action.targetPath, ...parentActions.map(parent => parent.targetPath)];
  const coreWriteOperations = action.entityType === "APPLICATION" ? 8 : 4;
  const dependentComponentCount = action.entityType === "CLIENT" ? new Set(manifest.actions.filter(candidate => (candidate.dependencies || []).includes(action.actionId)).map(candidate => candidate.componentId).filter(Boolean)).size : 0;
  return {
    actionId: action.actionId, entityType: action.entityType, iqEntityId: action.iqEntityId, canonicalGroupId: action.canonicalGroupId,
    componentId: action.componentId || null, operation: action.operation, targetPath: action.targetPath,
    clientId: clean(action.after.clientId) || null, dependencies: dependencyPreview(manifest, action, progress),
    historicalTime: action.historicalTime || null, destinationBusinessTimeFields: temporalFields,
    importedAt: "NOT_ASSIGNED_UNTIL_EXECUTE", auditTime: "NOT_ASSIGNED_UNTIL_EXECUTE",
    dependentComponentCount, balances: balancePreview(manifest, action), expected: {
      logicalActions: 1, businessDocuments: targetPaths.length, actionTransactionWriteOperations: coreWriteOperations,
      invocationControlWriteOperations: 8, totalWriteOperations: coreWriteOperations + 8, uniqueDocuments: action.entityType === "APPLICATION" ? 12 : 8,
      targetDocumentPaths: targetPaths, internalDocuments: ["p4ImportDeltaBackups/{deterministic}", ...(action.entityType === "APPLICATION" ? ["p4ImportDeltaBackups/{invoice-balance}", "p4ImportDeltaBackups/{payment-balance}"] : []), "p4ImportRuns/{runId}/actions/{actionId}", "p4ImportAudit/{action}", "p4ImportAudit/{phase-completed}", "p4ImportRuns/{runId}", "p4ImportLocks/{manifestId}", "p4ImportManifests/{manifestId}"],
      rollback: action.operation === "RECONCILE" ? "RESTORE_MUTABLE_FIELDS" : action.entityType === "APPLICATION" ? "DELETE_CREATED_TARGET_AND_RESTORE_PARENT_BALANCES" : "DELETE_CREATED_TARGET",
      source: "IQ_IMPORT", iqWrites: 0, externalEffects: 0,
    },
  };
}

async function previewPhase(ctx: Context, data: any) {
  if (data?.actionId || data?.cursor || data?.componentId || data?.dependencyOverride) throw new P4EngineError("P4_CANARY_CALLER_SELECTION_FORBIDDEN", "El caller no puede seleccionar action, cursor, component o dependencies.");
  const { manifest } = await loadManifest(ctx, clean(data?.manifestId, 80));
  const runId = clean(data?.runId, 80), [progress, verifiedTargets] = await Promise.all([loadActionProgress(runId), loadVerifiedTargets(manifest)]);
  const requestedPhase = data?.phase ? phase(data.phase) : null;
  const preferredComponentId = runId ? clean((await runs.doc(runId).get()).get("canaryComponentId"), 80) : "";
  const selected = requestedPhase ? selectCanaryAction({ manifest, phase: requestedPhase, progress, verifiedTargets, preferredComponentId }) : null;
  const simulation = simulateCanarySequence(manifest, progress, verifiedTargets);
  const chain = financialCanaryChains(manifest).find(row => row.componentId === simulation.solicitud.componentId) || null;
  return {
    ok: true, mode: "PREVIEW_PHASE", manifestId: manifest.manifestId, manifestHash: manifest.manifestHash, manifestVersion: manifest.version,
    phase: requestedPhase, selected: selected ? candidatePreview(manifest, selected.selected, progress) : null,
    canaryPreview: {
      client: candidatePreview(manifest, simulation.client.selected, progress),
      solicitud: candidatePreview(manifest, simulation.solicitud.selected, { ...progress, ...(simulation.client.selected ? { [simulation.client.selected.actionId]: "COMPLETED" as const } : {}) }),
      payment: candidatePreview(manifest, simulation.payment.selected, simulation.progress),
      application: candidatePreview(manifest, simulation.application.selected, simulation.progress),
      financialComponentId: chain?.componentId || null,
    },
    transitions: {
      initial: summarizeActionProgress(manifest, progress, verifiedTargets),
      afterSimulatedCanaries: summarizeActionProgress(manifest, simulation.progress, verifiedTargets),
      completedActionIds: Object.entries(simulation.progress).filter(([, status]) => status === "COMPLETED").map(([id]) => id),
    },
    reviewExclusion: { clientIqId: "7565", clientSelectable: false, financialComponentId: "p4c_f3f8c30e4f16573d063e9ece", financialSelectable: false, applicationIds: ["162839", "162841", "162842"] },
    expectedIqWrites: 0, expectedExternalEffects: 0,
  };
}

async function scopeContext(ctx:Context,data:any):Promise<{manifest:P4Manifest;scope:P4Scope;budget:P4ScopeBudget}>{
  if(data?.actionId||data?.actionIds||data?.targetPath||data?.targetPaths||data?.componentId||data?.cursor||data?.iqEntityId||data?.patch||data?.dependencies)
    throw new P4EngineError("P4_SCOPE_CALLER_SELECTION_FORBIDDEN","El caller no puede seleccionar miembros del scope.");
  const manifestId=clean(data?.manifestId,80),manifestHash=clean(data?.manifestHash,80),{manifest}=await loadManifest(ctx,manifestId);
  if(manifestHash!==manifest.manifestHash)throw new P4EngineError("P4_MANIFEST_HASH_MISMATCH","Hash requerido para scope.");
  const request=validateExecutionScopeRequest(data?.scope),evidenceId=`${manifest.manifestId}_${request.type}`;
  const evidenceSnap=request.type==="BATCH_B"||request.type==="BATCH_C"?await scopeEvidence.doc(evidenceId).get():null;
  const historicalEvidence=evidenceSnap?.exists?evidenceSnap.data() as P4HistoricalBatchEvidence:undefined;
  const [verified,isolationSnaps]=await Promise.all([loadVerifiedTargets(manifest),financialComponentReviews.where("manifestId","==",manifest.manifestId).get()]);
  const activeIsolations=isolationSnaps.docs.filter(doc=>doc.get("rootId")===ctx.rootId&&doc.get("status")==="ACTIVE");
  const isolatedComponentIds=new Set(activeIsolations.map(doc=>clean(doc.get("componentId"),80)).filter(Boolean));
  for(const actionId of activeIsolations.flatMap(doc=>Array.isArray(doc.get("sourceCompletedActionIds"))?doc.get("sourceCompletedActionIds"):[]))verified.add(clean(actionId,80));
  const scope=buildExecutionScope({manifest,request,historicalEvidence,completedActionIds:verified,isolatedComponentIds});
  return{manifest,scope,budget:scopeBudget(data?.budget)};
}

async function previewExecutionScope(ctx:Context,data:any){
  const {manifest,scope,budget}=await scopeContext(ctx,data),verified=await loadVerifiedTargets(manifest),canary=scopeCanaryQueue(scope,manifest,verified)[0]||null;
  const counts=scope.members.reduce<Record<string,number>>((out,row)=>{const key=`${row.role}:${row.entityType}:${row.operation}`;out[key]=(out[key]||0)+1;return out;},{});
  return{ok:true,mode:"PREVIEW_SCOPE",scope,budget,counts,selected:scope.members.length,excluded:scope.excluded.length,canary:canary?candidatePreview(manifest,canary,{}):null,expectedPay0Writes:scope.expectedPay0Writes,expectedIqWrites:0,expectedExternalEffects:0,readOnly:true};
}

async function approveExecutionScope(ctx:Context,data:any){
  const {manifest,scope,budget}=await scopeContext(ctx,data);assertScopeApproval({scope,manifest,scopeId:data?.scopeId,scopeHash:data?.scopeHash,manifestHash:data?.manifestHash,selectorVersion:data?.selectorVersion});
  const confirmation=clean(data?.confirmation,260);if(confirmation!==`APPROVE_SCOPE:${manifest.manifestId}:${scope.scopeId}:${scope.scopeHash}`)throw new P4EngineError("P4_SCOPE_APPROVAL_CONFIRMATION_REQUIRED","Confirmación de scope inválida.");
  const ref=scopeApprovals.doc(scope.scopeId);await db.runTransaction(async tx=>{const current=await tx.get(ref);if(current.exists){if(current.get("scopeHash")!==scope.scopeHash||current.get("manifestHash")!==manifest.manifestHash)throw new P4EngineError("P4_SCOPE_APPROVAL_MISMATCH","Aprobación previa no coincide.");return;}
    tx.create(ref,{scopeId:scope.scopeId,scopeHash:scope.scopeHash,selectorVersion:P4_SCOPE_SELECTOR_VERSION,manifestId:manifest.manifestId,manifestHash:manifest.manifestHash,rootId:ctx.rootId,status:"APPROVED",scope,budget,allowedEffects:{pay0Writes:true,iqWrites:false,externalEffects:false},approvedBy:ctx.uid,approvedAt:now(),updatedAt:now()});
    tx.create(audit.doc(),{mode:"P4_SCOPE_APPROVED",scopeId:scope.scopeId,scopeHash:scope.scopeHash,manifestId:manifest.manifestId,rootId:ctx.rootId,actorUid:ctx.uid,budget,createdAt:now()});});
  return{ok:true,mode:"APPROVE_SCOPE",status:"APPROVED",scopeId:scope.scopeId,scopeHash:scope.scopeHash,manifestId:manifest.manifestId,budget,expectedIqWrites:0,expectedExternalEffects:0};
}

function budgetWithin(requested:P4ScopeBudget,approved:P4ScopeBudget){return(Object.keys(requested) as Array<keyof P4ScopeBudget>).every(key=>requested[key]<=approved[key]);}

async function executeExecutionScope(ctx:Context,data:any,mode:"EXECUTE_SCOPE"|"RESUME_SCOPE"){
  const {manifest,scope,budget}=await scopeContext(ctx,data);assertScopeApproval({scope,manifest,scopeId:data?.scopeId,scopeHash:data?.scopeHash,manifestHash:data?.manifestHash,selectorVersion:data?.selectorVersion});
  const approvalRef=scopeApprovals.doc(scope.scopeId),approval=await approvalRef.get();if(!approval.exists||approval.get("rootId")!==ctx.rootId||approval.get("status")!=="APPROVED"||approval.get("scopeHash")!==scope.scopeHash)throw new P4EngineError("P4_SCOPE_NOT_APPROVED","Scope no aprobado.");
  const approvedBudget=approval.get("budget") as P4ScopeBudget;if(!budgetWithin(budget,approvedBudget))throw new P4EngineError("P4_SCOPE_BUDGET_EXCEEDS_APPROVAL","Budget excede aprobación.");
  const runId=`p4sr_${scope.scopeHash.slice(0,24)}`,runRef=runs.doc(runId),lockRef=scopeLocks.doc(scope.scopeId),leaseMs=Math.min(budget.maxDurationMs+30_000,510_000);let fence=0;
  await db.runTransaction(async tx=>{const [lock,run]=await Promise.all([tx.get(lockRef),tx.get(runRef)]),expires=Number(lock.get("expiresAtMs")||0);if(lock.exists&&expires>Date.now()&&lock.get("owner")!==ctx.uid)throw new P4EngineError("P4_SCOPE_LOCKED","Scope tiene lease activo.");fence=Number(lock.get("fence")||0)+1;
    tx.set(lockRef,{scopeId:scope.scopeId,scopeHash:scope.scopeHash,runId,owner:ctx.uid,fence,acquiredAt:now(),heartbeatAt:now(),expiresAtMs:Date.now()+leaseMs});
    if(!run.exists)tx.create(runRef,{runId,scopeId:scope.scopeId,scopeHash:scope.scopeHash,selectorVersion:P4_SCOPE_SELECTOR_VERSION,manifestId:manifest.manifestId,manifestHash:manifest.manifestHash,rootId:ctx.rootId,status:"RUNNING",fence,completed:0,skipped:0,failed:0,writes:0,attempts:0,startedAt:now(),updatedAt:now(),sideEffects:ZERO_SIDE_EFFECTS});else tx.update(runRef,{status:"RUNNING",fence,updatedAt:now()});});
  const executionMode=clean(data?.executionMode||"SCOPED_FULL",20).toUpperCase();if(!["CANARY","SCOPED_FULL"].includes(executionMode))throw new P4EngineError("P4_SCOPE_EXECUTION_MODE_INVALID","Modo de ejecución acotada inválido.");
  const [progress,verifiedTargets]=await Promise.all([loadActionProgress(runId),loadVerifiedTargets(manifest)]),completedForCanary=new Set([...verifiedTargets,...Object.entries(progress).filter(([,status])=>status==="COMPLETED").map(([id])=>id)]),queue=executionMode==="CANARY"?scopeCanaryQueue(scope,manifest,completedForCanary):scopeQueue(scope,manifest),stateReader=new P4CurrentStateReader(ctx.rootId,IQ_CREDENTIALS_KEY.value());
  let processed=0,completed=0,skipped=0,writes=0,errors=0,recoveredFailures=0;const started=Date.now();
  for(const action of queue){if(processed>=budget.maxActions||writes>=budget.maxWrites||errors>=budget.maxErrors||Date.now()-started>=budget.maxDurationMs)break;if(progress[action.actionId]==="COMPLETED"||verifiedTargets.has(action.actionId)){skipped++;continue;}
    const priorAttempt=await actionDoc(runId,action.actionId).get();if(Number(priorAttempt.get("attempts")||0)>=budget.maxRetries){progress[action.actionId]="FAILED";errors++;continue;}
    const eligibility=actionEligibility(manifest,action,progress,verifiedTargets);if(!eligibility.eligible){skipped++;continue;}processed++;
    try{const wasFailed=priorAttempt.get("status")==="FAILED",result=await executeAction(ctx,runId,manifest,action,true,stateReader,verifiedTargets);progress[action.actionId]=result.progressStatus;if(result.outcome==="COMPLETED"){completed++;writes++;if(wasFailed)recoveredFailures++;}else skipped++;
      await actionDoc(runId,action.actionId).set({scopeId:scope.scopeId,scopeHash:scope.scopeHash,fence,status:result.progressStatus,attempts:FieldValue.increment(1),updatedAt:now()},{merge:true});
    }catch(error){errors++;progress[action.actionId]="FAILED";await actionDoc(runId,action.actionId).set({scopeId:scope.scopeId,scopeHash:scope.scopeHash,fence,status:"FAILED",attempts:FieldValue.increment(1),errorCode:error instanceof P4EngineError?error.code:"P4_INTERNAL",updatedAt:now()},{merge:true});if(errors>=budget.maxErrors)break;}}
  const remaining=queue.filter(action=>progress[action.actionId]!=="COMPLETED"&&!verifiedTargets.has(action.actionId)&&actionEligibility(manifest,action,progress,verifiedTargets).eligible).length,status=errors?"PAUSED_ERROR":remaining?"PAUSED_BUDGET":"COMPLETED";
  await db.runTransaction(async tx=>{const lock=await tx.get(lockRef);if(lock.get("runId")!==runId||lock.get("fence")!==fence)throw new P4EngineError("P4_SCOPE_FENCE_CONFLICT","Lease/fence cambió.");tx.set(runRef,{status,completed:FieldValue.increment(completed),skipped:FieldValue.increment(skipped),failed:FieldValue.increment(errors-recoveredFailures),writes:FieldValue.increment(writes),lastCheckpoint:{scopeId:scope.scopeId,fence,processed,recoveredFailures,at:now()},terminalGuardMetrics:stateReader.metrics,updatedAt:now(),...(status==="COMPLETED"?{finishedAt:now()}:{})},{merge:true});tx.delete(lockRef);});
  return{ok:errors===0,mode,executionMode,status,scopeId:scope.scopeId,scopeHash:scope.scopeHash,manifestId:manifest.manifestId,runId,fence,batch:{processed,completed,skipped,writes,errors,remaining},sideEffects:ZERO_SIDE_EFFECTS};
}

async function statusExecutionScope(ctx:Context,data:any){const scopeId=clean(data?.scopeId,80),approval=await scopeApprovals.doc(scopeId).get();if(!approval.exists||approval.get("rootId")!==ctx.rootId)throw new P4EngineError("P4_SCOPE_NOT_FOUND","Scope no disponible.");const runId=`p4sr_${String(approval.get("scopeHash")).slice(0,24)}`,run=await runs.doc(runId).get(),actions=run.exists?await runs.doc(runId).collection("actions").get():null;return{ok:true,mode:"STATUS_SCOPE",approval:serial(approval),run:run.exists?serial(run):null,actionProgress:actions?actions.docs.map(serial):[],sideEffects:ZERO_SIDE_EFFECTS};}

async function verifyExecutionScope(ctx:Context,data:any){const status=await statusExecutionScope(ctx,data),approval=status.approval as Record<string,any>,scope=approval.scope as P4Scope,{manifest}=await loadManifest(ctx,approval.manifestId),progress=Object.fromEntries((status.actionProgress as Array<Record<string,any>>).map(row=>[row.id,row.status]));const verified=await loadVerifiedTargets(manifest),summary={completed:0,pending:0,failed:0,mismatched:0};for(const action of scopeQueue(scope,manifest)){if(progress[action.actionId]==="FAILED")summary.failed++;else if(progress[action.actionId]==="COMPLETED"||verified.has(action.actionId))summary.completed++;else summary.pending++;}return{ok:summary.failed===0,mode:"VERIFY_SCOPE",scopeId:scope.scopeId,scopeHash:scope.scopeHash,run:status.run,summary,scopeComplete:summary.pending===0&&summary.failed===0,sideEffects:ZERO_SIDE_EFFECTS};}

const FINANCIAL_ISOLATION_FIELDS=new Set(["mode","manifestId","scopeId","runId","confirmation"]);
async function financialIsolationContext(ctx:Context,data:any){
  for(const key of Object.keys(data||{}))if(!FINANCIAL_ISOLATION_FIELDS.has(key))throw new P4EngineError("P4_FINANCIAL_COMPONENT_ISOLATION_CALLER_FIELD_FORBIDDEN",`Campo caller prohibido: ${key}.`);
  const manifestId=clean(data?.manifestId,80),scopeId=clean(data?.scopeId,80),runId=clean(data?.runId,80),approval=await scopeApprovals.doc(scopeId).get();
  if(!approval.exists||approval.get("rootId")!==ctx.rootId||approval.get("manifestId")!==manifestId)throw new P4EngineError("P4_SCOPE_NOT_FOUND","Scope no disponible para isolation.");
  const expectedRunId=`p4sr_${String(approval.get("scopeHash")).slice(0,24)}`;if(runId!==expectedRunId)throw new P4EngineError("P4_RUN_NOT_FOUND","Run no coincide con scope.");
  const [{manifest},run,progress,reviews]=await Promise.all([loadManifest(ctx,manifestId),runs.doc(runId).get(),runs.doc(runId).collection("actions").get(),financialComponentReviews.where("manifestId","==",manifestId).get()]);
  if(!run.exists||run.get("rootId")!==ctx.rootId)throw new P4EngineError("P4_RUN_NOT_FOUND","Run no disponible.");
  const existingReview=reviews.docs.find(doc=>doc.get("sourceRunId")===runId&&doc.get("rootId")===ctx.rootId&&doc.get("status")==="ACTIVE");
  if(existingReview){
    const isolation=existingReview.data() as P4FinancialComponentIsolation,failed=progress.docs.find(doc=>doc.id===isolation.failedActionId);
    if(!failed||failed.get("status")!=="FINANCIAL_RECONCILIATION_REVIEW"||failed.get("financialComponentIsolationHash")!==isolation.isolationHash)throw new P4EngineError("P4_FINANCIAL_COMPONENT_ISOLATION_CONFLICT","Isolation activa no coincide con el checkpoint protegido.");
    const memberProgress=Object.fromEntries(isolation.actionIds.map((id:string)=>{const snap=progress.docs.find(doc=>doc.id===id);return[id,snap?.get("status")||null];}));
    const sourceCompletedActionIds=Array.isArray(existingReview.get("sourceCompletedActionIds"))?existingReview.get("sourceCompletedActionIds").map((id:unknown)=>clean(id,80)).filter(Boolean).sort():[];
    return{manifestId,scopeId,runId,approval,manifest,run,failed,isolation,memberProgress,sourceCompletedActionIds,reviewRef:existingReview.ref,existing:true};
  }
  const failed=progress.docs.filter(doc=>doc.get("status")==="FAILED"&&doc.get("errorCode")==="P4_APPLICATION_ATOMICITY_BLOCKED");
  if(failed.length!==1)throw new P4EngineError("P4_FINANCIAL_COMPONENT_ISOLATION_NOT_ELIGIBLE","Se requiere exactamente un fallo de atomicidad demostrable.");
  const isolation=buildFinancialComponentIsolation({manifest,sourceRunId:runId,failedActionId:failed[0].id,errorCode:failed[0].get("errorCode")});
  const memberProgress=Object.fromEntries(await Promise.all(isolation.actionIds.map(async id=>{const snap=progress.docs.find(doc=>doc.id===id);return[id,snap?.get("status")||null];})));
  const sourceCompletedActionIds=progress.docs.filter(doc=>doc.get("status")==="COMPLETED").map(doc=>doc.id).sort();
  return{manifestId,scopeId,runId,approval,manifest,run,failed:failed[0],isolation,memberProgress,sourceCompletedActionIds,reviewRef:financialComponentReviews.doc(isolation.isolationHash),existing:false};
}
async function previewFinancialComponentIsolation(ctx:Context,data:any){const row=await financialIsolationContext(ctx,data);return{ok:true,mode:"PREVIEW_FINANCIAL_COMPONENT_ISOLATION",readOnly:true,status:row.existing?"NO_CHANGE":"READY",isolation:row.isolation,memberProgress:row.memberProgress,run:{status:row.run.get("status"),completed:row.run.get("completed"),failed:row.run.get("failed"),writes:row.run.get("writes")},expectedBusinessWrites:0,expectedAdministrativeWrites:row.existing?0:3,expectedIqWrites:0,expectedExternalEffects:0};}
async function isolateFinancialComponent(ctx:Context,data:any){const row=await financialIsolationContext(ctx,data),confirmation=`ISOLATE_FINANCIAL_COMPONENT:${row.manifestId}:${row.scopeId}:${row.runId}:${row.isolation.isolationHash}`;if(clean(data?.confirmation,360)!==confirmation)throw new P4EngineError("P4_EXECUTION_AUTHORIZATION_INVALID","Confirmación de isolation inválida.");
  if(row.existing)return{ok:true,mode:"ISOLATE_FINANCIAL_COMPONENT",status:"NO_CHANGE",isolation:row.isolation,businessWrites:0,administrativeWrites:0,sideEffects:ZERO_SIDE_EFFECTS};
  const changed=await db.runTransaction(async tx=>{const [review,run,progress]=await Promise.all([tx.get(row.reviewRef),tx.get(runs.doc(row.runId)),tx.get(actionDoc(row.runId,row.failed.id))]);if(review.exists){if(review.get("isolationHash")!==row.isolation.isolationHash)throw new P4EngineError("P4_FINANCIAL_COMPONENT_ISOLATION_CONFLICT","Isolation previa no coincide.");return false;}if(run.get("failed")!==1||progress.get("status")!=="FAILED"||progress.get("errorCode")!=="P4_APPLICATION_ATOMICITY_BLOCKED")throw new P4EngineError("P4_FINANCIAL_COMPONENT_ISOLATION_TOCTOU_BLOCKED","Evidencia de fallo cambió.");
    tx.create(row.reviewRef,{...row.isolation,sourceCompletedActionIds:row.sourceCompletedActionIds,rootId:ctx.rootId,status:"ACTIVE",classification:"FINANCIAL_RECONCILIATION_REVIEW",businessWrites:0,iqWrites:0,externalEffects:0,isolatedBy:ctx.uid,isolatedAt:now(),updatedAt:now()});
    tx.set(actionDoc(row.runId,row.failed.id),{status:"FINANCIAL_RECONCILIATION_REVIEW",priorStatus:"FAILED",priorErrorCode:"P4_APPLICATION_ATOMICITY_BLOCKED",financialComponentIsolationHash:row.isolation.isolationHash,reviewedAt:now(),updatedAt:now()},{merge:true});
    tx.set(runs.doc(row.runId),{status:"PAUSED_REVIEW",failed:FieldValue.increment(-1),financialReviewCount:FieldValue.increment(1),lastFinancialIsolation:{componentId:row.isolation.componentId,isolationHash:row.isolation.isolationHash,failedActionId:row.failed.id,at:now()},updatedAt:now()},{merge:true});
    tx.create(audit.doc(),{mode:"P4_FINANCIAL_COMPONENT_ISOLATED",manifestId:row.manifestId,scopeId:row.scopeId,runId:row.runId,componentId:row.isolation.componentId,isolationHash:row.isolation.isolationHash,failedActionId:row.failed.id,priorErrorCode:"P4_APPLICATION_ATOMICITY_BLOCKED",result:"FINANCIAL_RECONCILIATION_REVIEW",businessWrites:0,iqWrites:0,externalEffects:0,rootId:ctx.rootId,actorUid:ctx.uid,createdAt:now()});return true;});
  return{ok:true,mode:"ISOLATE_FINANCIAL_COMPONENT",status:changed?"FINANCIAL_RECONCILIATION_REVIEW":"NO_CHANGE",isolation:row.isolation,businessWrites:0,administrativeWrites:changed?3:0,sideEffects:ZERO_SIDE_EFFECTS};}
async function verifyFinancialComponentIsolation(ctx:Context,data:any){const row=await financialIsolationContext(ctx,data).catch(async()=>{const manifestId=clean(data?.manifestId,80),scopeId=clean(data?.scopeId,80),runId=clean(data?.runId,80),reviews=await financialComponentReviews.where("manifestId","==",manifestId).get(),review=reviews.docs.find(doc=>doc.get("sourceRunId")===runId&&doc.get("rootId")===ctx.rootId&&doc.get("status")==="ACTIVE");if(!review)throw new P4EngineError("P4_FINANCIAL_COMPONENT_ISOLATION_NOT_FOUND","Isolation no disponible.");return{manifestId,scopeId,runId,isolation:review.data() as any,reviewRef:review.ref} as any;});const [review,run,progress,audits]=await Promise.all([row.reviewRef.get(),runs.doc(row.runId).get(),actionDoc(row.runId,row.isolation.failedActionId).get(),audit.where("runId","==",row.runId).where("mode","==","P4_FINANCIAL_COMPONENT_ISOLATED").get()]);const verified=review.exists&&review.get("status")==="ACTIVE"&&run.get("failed")===0&&progress.get("status")==="FINANCIAL_RECONCILIATION_REVIEW"&&audits.size===1;return{ok:verified,mode:"VERIFY_FINANCIAL_COMPONENT_ISOLATION",status:verified?"FINANCIAL_RECONCILIATION_REVIEW":"REVIEW_REQUIRED",isolation:row.isolation,run:{status:run.get("status"),completed:run.get("completed"),failed:run.get("failed"),writes:run.get("writes")},actionProgress:{status:progress.get("status"),priorStatus:progress.get("priorStatus"),priorErrorCode:progress.get("priorErrorCode")},auditCount:audits.size,sideEffects:ZERO_SIDE_EFFECTS};}

const PROVENANCE_REPAIR_ALLOWED_FIELDS=new Set(["mode","manifestId","scopeId","runId","confirmation"]);
function validateProvenanceRepairRequest(data:any){const row=(data&&typeof data==="object"?data:{}) as Record<string,unknown>;for(const key of Object.keys(row))if(!PROVENANCE_REPAIR_ALLOWED_FIELDS.has(key))throw new P4EngineError("P4_PROVENANCE_REPAIR_CALLER_FIELD_FORBIDDEN",`Campo caller prohibido: ${key}.`);return{manifestId:clean(row.manifestId,80),scopeId:clean(row.scopeId,80),runId:clean(row.runId,80),confirmation:clean(row.confirmation,280)};}
function presentFields(row:Record<string,any>){return Object.fromEntries(Object.entries(row).filter(([,state])=>state?.present).map(([field,state])=>[field,state.value]));}
async function provenanceRepairContext(ctx:Context,data:any){
  const request=validateProvenanceRepairRequest(data),approval=await scopeApprovals.doc(request.scopeId).get();
  if(!approval.exists||approval.get("rootId")!==ctx.rootId)throw new P4EngineError("P4_SCOPE_NOT_FOUND","Scope de repair no disponible.");
  const scope=approval.get("scope") as P4Scope,expectedRunId=`p4sr_${String(approval.get("scopeHash")).slice(0,24)}`;
  if(request.manifestId!==approval.get("manifestId")||request.runId!==expectedRunId||scope.scopeId!==request.scopeId)throw new P4EngineError("P4_PROVENANCE_REPAIR_SCOPE_MISMATCH","Manifest/scope/run no coinciden.");
  const [{manifest},run]=await Promise.all([loadManifest(ctx,request.manifestId),runs.doc(request.runId).get()]);
  if(!run.exists||run.get("rootId")!==ctx.rootId||run.get("scopeId")!==request.scopeId)throw new P4EngineError("P4_RUN_NOT_FOUND","Run de repair no disponible.");
  const memberIds=new Set([...scope.members,...scope.externalDependencies].map(member=>member.actionId));
  const actions=manifest.actions.filter(action=>memberIds.has(action.actionId)&&action.operation==="RECONCILE");
  return{request,approval,scope,manifest,run,actions,sessionRef:provenanceRepairSessions.doc(deterministicId(request.manifestId,request.scopeId,request.runId))};
}
async function provenanceRepairRows(ctx:Context,data:any){
  const repair=await provenanceRepairContext(ctx,data),executeAudits=await audit.where("runId","==",repair.request.runId).where("mode","==","EXECUTE").get(),repairAudits=await audit.where("runId","==",repair.request.runId).where("mode","==","P4_RECONCILE_PROVENANCE_REPAIR").get();
  const executeCounts=new Map<string,number>(),repairCounts=new Map<string,number>();for(const doc of executeAudits.docs)executeCounts.set(clean(doc.get("actionId"),80),(executeCounts.get(clean(doc.get("actionId"),80))||0)+1);for(const doc of repairAudits.docs)repairCounts.set(clean(doc.get("actionId"),80),(repairCounts.get(clean(doc.get("actionId"),80))||0)+1);
  const rows=[];for(const action of repair.actions){const backupId=deterministicId(repair.request.runId,action.actionId),[progress,target,backup,repairProgress]=await db.getAll(actionDoc(repair.request.runId,action.actionId),db.doc(action.targetPath),backups.doc(backupId),repair.sessionRef.collection("actions").doc(action.actionId));if(progress.get("status")!=="COMPLETED")continue;const certifiedExpected=presentFields((backup.get("intendedAfter")||{}) as Record<string,any>),preview=previewExecutionProvenanceRepair(action,(target.data()||{}) as Record<string,unknown>,repair.request.manifestId,repair.request.runId,certifiedExpected),evidence={actionType:action.operation,checkpoint:progress.get("status")||null,targetExists:target.exists,backupExists:backup.exists,backupId,backupExact:backup.exists&&backup.get("runId")===repair.request.runId&&backup.get("manifestId")===repair.request.manifestId&&backup.get("actionId")===action.actionId&&backup.get("targetPath")===action.targetPath,executeAuditCount:executeCounts.get(action.actionId)||0,repairAuditCount:repairCounts.get(action.actionId)||0,repairStatus:repairProgress.get("status")||null};const evidenceValid=evidence.actionType==="RECONCILE"&&evidence.targetExists&&evidence.backupExact&&evidence.executeAuditCount===1;rows.push({...preview,evidence,eligible:evidenceValid&&preview.classification==="ADMINISTRATIVE_PROVENANCE_REPAIR_REQUIRED",verified:evidenceValid&&preview.classification==="NO_CHANGE"});}
  return{...repair,rows};
}
async function previewReconcileProvenanceRepair(ctx:Context,data:any){const result=await provenanceRepairRows(ctx,data),conflicts=result.rows.filter(row=>!["ADMINISTRATIVE_PROVENANCE_REPAIR_REQUIRED","NO_CHANGE"].includes(row.classification)||(!row.eligible&&!row.verified));return{ok:conflicts.length===0,mode:"PREVIEW_RECONCILE_PROVENANCE_REPAIR",manifestId:result.request.manifestId,scopeId:result.request.scopeId,runId:result.request.runId,candidates:result.rows,eligibleCount:result.rows.filter(row=>row.eligible).length,noChangeCount:result.rows.filter(row=>row.verified).length,conflictCount:conflicts.length,expectedBusinessWrites:0,expectedAdministrativeWrites:result.rows.filter(row=>row.eligible).length,sideEffects:ZERO_SIDE_EFFECTS};}
async function repairReconcileProvenance(ctx:Context,data:any){
  const initial=await provenanceRepairRows(ctx,data),confirmation=`REPAIR_RECONCILE_PROVENANCE:${initial.request.manifestId}:${initial.request.scopeId}:${initial.request.runId}`;if(initial.request.confirmation!==confirmation)throw new P4EngineError("P4_EXECUTION_AUTHORIZATION_INVALID","ConfirmaciÃ³n de repair invÃ¡lida.");
  const conflicts=initial.rows.filter(row=>!["ADMINISTRATIVE_PROVENANCE_REPAIR_REQUIRED","NO_CHANGE"].includes(row.classification)||(!row.eligible&&!row.verified));if(conflicts.length)throw new P4EngineError("P4_PROVENANCE_REPAIR_NOT_ELIGIBLE","Existe evidencia no elegible para repair.");
  const lease=await acquireScopeLease(initial.sessionRef,ctx);let repaired=0,noChange=0;try{for(const row of initial.rows){const action=initial.actions.find(candidate=>candidate.actionId===row.actionId)!;const outcome=await db.runTransaction(async tx=>{const progressRef=actionDoc(initial.request.runId,action.actionId),targetRef=db.doc(action.targetPath),backupRef=backups.doc(deterministicId(initial.request.runId,action.actionId)),repairProgressRef=initial.sessionRef.collection("actions").doc(action.actionId),executeQuery=audit.where("runId","==",initial.request.runId).where("actionId","==",action.actionId).where("mode","==","EXECUTE"),repairQuery=audit.where("runId","==",initial.request.runId).where("actionId","==",action.actionId).where("mode","==","P4_RECONCILE_PROVENANCE_REPAIR"),[session,progress,target,backup,executeAudit,priorRepair]=await Promise.all([tx.get(initial.sessionRef),tx.get(progressRef),tx.get(targetRef),tx.get(backupRef),tx.get(executeQuery),tx.get(repairQuery)]);assertScopeLease(session,lease);if(progress.get("status")!=="COMPLETED"||!target.exists||!backup.exists||backup.get("manifestId")!==initial.request.manifestId||backup.get("targetPath")!==action.targetPath||executeAudit.size!==1)throw new P4EngineError("P4_PROVENANCE_REPAIR_NOT_ELIGIBLE","Evidencia cambiÃ³ durante repair.");const certifiedExpected=presentFields((backup.get("intendedAfter")||{}) as Record<string,any>),fresh=previewExecutionProvenanceRepair(action,(target.data()||{}) as Record<string,unknown>,initial.request.manifestId,initial.request.runId,certifiedExpected);if(fresh.classification==="NO_CHANGE")return"NO_CHANGE" as const;if(fresh.classification!=="ADMINISTRATIVE_PROVENANCE_REPAIR_REQUIRED"||fresh.expectedBusinessFieldMutations!==0||priorRepair.size)throw new P4EngineError("P4_PROVENANCE_REPAIR_TOCTOU_BLOCKED","Target/provenance cambiÃ³ despuÃ©s del preview.");const marker=fresh.administrativePatch[P4_EXECUTION_PROVENANCE_FIELD];tx.update(targetRef,{[P4_EXECUTION_PROVENANCE_FIELD]:marker});tx.set(repairProgressRef,{status:"REPAIRED",actionId:action.actionId,targetPath:action.targetPath,businessFingerprint:(marker as any).businessFingerprint,repairedAt:now(),updatedAt:now()},{merge:true});tx.create(audit.doc(),{mode:"P4_RECONCILE_PROVENANCE_REPAIR",runId:initial.request.runId,manifestId:initial.request.manifestId,scopeId:initial.request.scopeId,actionId:action.actionId,entityType:action.entityType,iqEntityId:action.iqEntityId,targetPath:action.targetPath,backupId:backupRef.id,originalExecuteAuditId:executeAudit.docs[0].id,businessMutationCount:0,administrativeFields:[P4_EXECUTION_PROVENANCE_FIELD],result:"REPAIRED",rootId:ctx.rootId,actorUid:ctx.uid,createdAt:now()});return"REPAIRED" as const;});if(outcome==="REPAIRED")repaired++;else noChange++;}}
  finally{await releaseScopeLease(initial.sessionRef,lease);}
  return{ok:true,mode:"REPAIR_RECONCILE_PROVENANCE",manifestId:initial.request.manifestId,scopeId:initial.request.scopeId,runId:initial.request.runId,repaired,noChange,businessWrites:0,administrativeWrites:repaired,sideEffects:ZERO_SIDE_EFFECTS};
}
async function verifyReconcileProvenanceRepair(ctx:Context,data:any){const result=await provenanceRepairRows(ctx,data),failed=result.rows.filter(row=>!row.verified||row.evidence.checkpoint!=="COMPLETED"||!row.evidence.backupExact||row.evidence.executeAuditCount!==1||(row.evidence.repairStatus==="REPAIRED"&&row.evidence.repairAuditCount!==1));return{ok:failed.length===0,mode:"VERIFY_RECONCILE_PROVENANCE_REPAIR",manifestId:result.request.manifestId,scopeId:result.request.scopeId,runId:result.request.runId,rows:result.rows,failed:failed.map(row=>row.actionId),businessMutations:0,iqWrites:0,externalEffects:0,sideEffects:ZERO_SIDE_EFFECTS};}

async function rollbackExecutionScope(ctx:Context,data:any){
  const scopeId=clean(data?.scopeId,80),approval=await scopeApprovals.doc(scopeId).get();
  if(!approval.exists||approval.get("rootId")!==ctx.rootId)throw new P4EngineError("P4_SCOPE_NOT_FOUND","Scope no disponible.");
  const scopeHash=clean(approval.get("scopeHash"),80),runId=`p4sr_${scopeHash.slice(0,24)}`;
  if(clean(data?.confirmation,260)!==`ROLLBACK_SCOPE:${scopeId}:${scopeHash}`)throw new P4EngineError("P4_ROLLBACK_CONFIRMATION_REQUIRED","Confirmación rollback scope inválida.");
  const result=await rollback(ctx,{runId,confirmation:`ROLLBACK:${runId}:${approval.get("manifestId")}`});
  await approval.ref.set({status:"ROLLED_BACK",rolledBackAt:now(),updatedAt:now()},{merge:true});
  return{...result,mode:"ROLLBACK_SCOPE",scopeId,scopeHash};
}

async function approve(ctx: Context, data: any) {
  const manifestId = clean(data?.manifestId, 80), confirmationHash = clean(data?.manifestHash, 80);
  const { ref, manifest } = await loadManifest(ctx, manifestId);
  if (confirmationHash !== manifest.manifestHash) throw new P4EngineError("P4_MANIFEST_HASH_MISMATCH", "Confirmación incorrecta.");
  await db.runTransaction(async tx => {
    const fresh = await tx.get(ref);
    if(fresh.get("manifestHash")!==manifest.manifestHash)throw new P4EngineError("P4_MANIFEST_HASH_MISMATCH","El manifest cambió.");
    if (!["PLANNED", "APPROVED"].includes(fresh.get("status"))) throw new P4EngineError("P4_MANIFEST_IMMUTABLE", "El manifest ya inició ejecución.");
    tx.update(ref, { status: "APPROVED", approvedBy: ctx.uid, approvedAt: now(), updatedAt: now() });
    tx.create(audit.doc(), { mode: "APPROVE", manifestId, rootId: ctx.rootId, actorUid: ctx.uid, result: "APPROVED", createdAt: now() });
  });
  return { ok: true, mode: "APPROVE", manifestId, status: "APPROVED" };
}

async function hasTombstone(tx: FirebaseFirestore.Transaction, action: P4Action): Promise<boolean> {
  for (const key of action.tombstoneKeys) {
    for (const field of ["entityId", "folio"] as const) {
      const snap = await tx.get(db.collection("iqPurgeTombstones").where(field, "==", key).limit(1));
      if (!snap.empty) return true;
    }
  }
  return false;
}

function beforeFields(row: Record<string, unknown>, fields: string[]) {
  return Object.fromEntries(fields.map(field => [field, Object.prototype.hasOwnProperty.call(row, field) ? { present: true, value: row[field] } : { present: false }]));
}

type ExecutionActionResult = { outcome: "COMPLETED" | "SKIPPED" | "NOOP" | "REVIEW"; progressStatus: "COMPLETED" | "SKIP_PURGED" | Exclude<P4TerminalDecision, "ALLOW_EXECUTE">; guard?: P4TerminalGuardResult };
async function executeAction(ctx: Context, runId: string, manifest: P4Manifest, action: P4Action, phasedBalances = false, stateReader?: P4CurrentStateReader, verifiedTargets?: Set<string>): Promise<ExecutionActionResult> {
  if (["NO_OP", "EXISTING", "SKIP_PURGED", "REVIEW_REQUIRED", "CLIENT_REVIEW_REQUIRED", "FINANCIAL_RECONCILIATION_REVIEW", "HISTORICAL_DATE_REVIEW_REQUIRED"].includes(action.operation)) return { outcome: "SKIPPED", progressStatus: "SKIP_PURGED" };
  let iqEvidence: P4CurrentStateEvidence | null = null;
  if (stateReader) {
    try { iqEvidence = await stateReader.readIq(action); }
    catch { iqEvidence = { source: "IQ", rawStatus: "", normalizedStatus: "", state: "UNKNOWN", found: false }; }
  }
  return db.runTransaction(async tx => {
    const actionRef = actionDoc(runId, action.actionId), existingAction = await tx.get(actionRef);
    if (existingAction.get("status") === "COMPLETED") return { outcome: "NOOP", progressStatus: "COMPLETED" };
    if (await hasTombstone(tx, action)) {
      tx.set(actionRef, { status: "SKIP_PURGED", manifestId: manifest.manifestId, actionId: action.actionId, targetPath: action.targetPath, updatedAt: now() }, { merge: true });
      return { outcome: "SKIPPED", progressStatus: "SKIP_PURGED" };
    }
    for(const dependencyId of action.dependencies||[]){const dependency=manifest.actions.find(candidate=>candidate.actionId===dependencyId);if(!dependency)throw new P4EngineError("P4_CHECKPOINT_CONFLICT",`Dependencia ausente ${dependencyId}.`);if(["RECONCILE","CREATE_HISTORICAL","DEPENDENCY_IMPORT"].includes(dependency.operation)){if(verifiedTargets?.has(dependencyId))continue;const dependencySnap=await tx.get(actionDoc(runId,dependencyId));if(dependencySnap.get("status")!=="COMPLETED")throw new P4EngineError("P4_CHECKPOINT_CONFLICT",`Dependencia incompleta ${dependencyId}.`);}else if(!["NO_OP","EXISTING"].includes(dependency.operation))throw new P4EngineError("P4_CHECKPOINT_CONFLICT",`Dependencia no ejecutable ${dependencyId}.`);}
    const target = db.doc(action.targetPath), snap = await tx.get(target), current = (snap.data() || {}) as Record<string, unknown>;
    if (["CREATE_HISTORICAL", "DEPENDENCY_IMPORT"].includes(action.operation) && snap.exists) {
      if (current.p4ActionId === action.actionId) { tx.set(actionRef, { status: "COMPLETED", manifestId: manifest.manifestId, noOp: true, updatedAt: now() }, { merge: true }); return { outcome: "NOOP", progressStatus: "COMPLETED" }; }
      throw new P4EngineError("P4_DUPLICATE_TARGET", `El target ${action.targetPath} ya existe.`);
    }
    if (action.operation === "RECONCILE" && !snap.exists) throw new P4EngineError("P4_CHECKPOINT_CONFLICT", `Target de reconciliación ausente ${action.targetPath}.`);
    if (stateReader && iqEvidence) {
      stateReader.metrics.currentStateReads++; stateReader.metrics.pay0CurrentStateReads++;
      const guard = evaluateHistoricalExecutionGuard({ action, manifest, iq: iqEvidence, pay0: pay0StateEvidence(action, snap.exists ? current : null) });
      stateReader.count(guard.decision);
      if (guard.decision !== "ALLOW_EXECUTE") {
        const outcome = guard.decision === "SKIPPED_TERMINAL" ? "SKIPPED" : "REVIEW";
        tx.set(actionRef, { status: guard.decision, manifestId: manifest.manifestId, actionId: action.actionId, entityType: action.entityType,
          iqEntityId: action.iqEntityId, targetPath: action.targetPath, terminalGuard: guard, updatedAt: now() }, { merge: true });
        tx.create(audit.doc(), { mode: "P4L_TERMINAL_GUARD", runId, manifestId: manifest.manifestId, actionId: action.actionId,
          entityType: action.entityType, iqEntityId: action.iqEntityId, targetPath: action.targetPath, componentId: action.componentId || null,
          plannedStatus: action.after.status || action.after.rawIqStatus || null, currentStatus: guard.iq.rawStatus || null,
          normalizedStatus: guard.iq.normalizedStatus || null, decision: guard.decision, reason: guard.reason,
          dependencyActionIds: guard.affectedDependencies, result: guard.decision, rootId: ctx.rootId, actorUid: ctx.uid, checkedAt: now(), createdAt: now() });
        return { outcome, progressStatus: guard.decision, guard };
      }
    }
    const canonicalFields = canonicalHistoricalFields(action);
    const bridge=manifest.version>=6&&action.operation==="RECONCILE"&&action.reconciliationOf?assessV5V6Reconciliation(action,current):null;
    if(bridge&&!['SAFE_CANONICAL_RECONCILE','NO_CHANGE'].includes(bridge.classification))throw new P4EngineError("P4P_V5_V6_RECONCILIATION_CONFLICT",bridge.reason);
    if(bridge?.classification==="NO_CHANGE"){
      tx.set(actionRef,{status:"COMPLETED",manifestId:manifest.manifestId,actionId:action.actionId,entityType:action.entityType,iqEntityId:action.iqEntityId,targetPath:action.targetPath,operation:action.operation,noOp:true,completedAt:now()},{merge:true});
      tx.create(audit.doc(),{mode:"EXECUTE",runId,manifestId:manifest.manifestId,actionId:action.actionId,entityType:action.entityType,iqEntityId:action.iqEntityId,targetPath:action.targetPath,group:action.canonicalGroupId,operation:action.operation,result:"NO_CHANGE",rootId:ctx.rootId,actorUid:ctx.uid,createdAt:now()});
      return{outcome:"NOOP",progressStatus:"COMPLETED"};
    }
    let payload = bridge?materializeTemporalFields({ ...action.after, ...canonicalFields, canonicalReconciliation:{manifestId:manifest.manifestId,actionId:action.actionId,contractVersion:manifest.version,reconciledAt:now()},rootId:action.rootId }):materializeTemporalFields({ ...historicalPayload(action, runId, manifest.manifestId, now(), manifest.version), ...canonicalFields });
    if (phasedBalances && action.entityType === "SOLICITUD") payload = { ...payload, totalAbonado: 0, saldoPendiente: Number(action.after.monto || 0) };
    if (phasedBalances && action.entityType === "PAYMENT") payload = { ...payload, totalAplicado: 0, saldoDisponible: Number(action.after.monto || 0) };
    if(bridge)payload={...payload,[P4_EXECUTION_PROVENANCE_FIELD]:executionProvenance(action,manifest.manifestId,runId,payload)};
    const parentMutations: Array<{ action: P4Action; ref: FirebaseFirestore.DocumentReference; snap: FirebaseFirestore.DocumentSnapshot; fields: string[]; patch: Record<string, unknown> }> = [];
    const validatedParents:P4Action[]=[];
    if (phasedBalances && action.entityType === "APPLICATION") {
      for (const dependencyId of action.dependencies || []) {
        const parent = manifest.actions.find(candidate => candidate.actionId === dependencyId && ["SOLICITUD", "PAYMENT"].includes(candidate.entityType));
        if (!parent) continue;
        const ref = db.doc(parent.targetPath), parentSnap = await tx.get(ref);
        if(!parentSnap.exists)throw new P4EngineError("P4_APPLICATION_ATOMICITY_BLOCKED",`Parent ausente para ${action.actionId}.`);
        const assessment=assessApplicationParent({parentAction:parent,applicationAction:action,current:(parentSnap.data()||{}) as Record<string,unknown>,manifest});
        if(!assessment.valid)throw new P4EngineError("P4_APPLICATION_ATOMICITY_BLOCKED",`Parent ${parent.iqEntityId} no verificable: ${assessment.reasons.join(",")}.`);
        validatedParents.push(parent);
        if(!assessment.parentBalanceMutation)continue;
        const fields = parent.entityType === "SOLICITUD" ? ["totalAbonado", "saldoPendiente"] : ["totalAplicado", "saldoDisponible"];
        parentMutations.push({ action: parent, ref, snap: parentSnap, fields, patch: Object.fromEntries(fields.map(field => [field, parent.after[field]])) });
      }
      if (validatedParents.length !== 2||new Set(validatedParents.map(parent=>parent.entityType)).size!==2) throw new P4EngineError("P4_APPLICATION_ATOMICITY_BLOCKED", `Application ${action.actionId} requiere invoice y payment validados.`);
      const duplicateByIq=await tx.get(db.collection("pagoAplicaciones").where("iqApplicationId","==",action.iqEntityId).limit(2));
      const duplicateByOrigin=await tx.get(db.collection("pagoAplicaciones").where("originalIqEntityId","==",action.iqEntityId).limit(2));
      const duplicatePaths=new Set([...duplicateByIq.docs,...duplicateByOrigin.docs].map(doc=>doc.ref.path).filter(path=>path!==action.targetPath));
      if(duplicatePaths.size)throw new P4EngineError("P4_APPLICATION_DUPLICATE_BLOCKED",`Application IQ ${action.iqEntityId} ya existe en ${[...duplicatePaths].join(",")}.`);
    }
    const backupFields=[...new Set([...action.mutableFields,...(bridge?[P4_EXECUTION_PROVENANCE_FIELD]:[])])],backupId = deterministicId(runId, action.actionId), backupRef = backups.doc(backupId);
    tx.create(backupRef, { runId, manifestId: manifest.manifestId, actionId: action.actionId, targetPath: action.targetPath,
      operation: action.operation, didNotExistBefore: !snap.exists, before: beforeFields(current, backupFields),
      intendedAfter: beforeFields(payload, backupFields), rootId: ctx.rootId, createdAt: now() });
    if (["CREATE_HISTORICAL", "DEPENDENCY_IMPORT"].includes(action.operation)) tx.create(target, payload);
    else tx.set(target, payload, { merge: true });
    const parentBackupIds: string[] = [];
    for (const mutation of parentMutations) {
      const parentBackupId = deterministicId(runId, action.actionId, mutation.action.targetPath), parentBackupRef = backups.doc(parentBackupId);
      parentBackupIds.push(parentBackupId);
      tx.create(parentBackupRef, { runId, manifestId: manifest.manifestId, actionId: action.actionId, targetPath: mutation.action.targetPath,
        operation: "APPLICATION_BALANCE_UPDATE", didNotExistBefore: false, before: beforeFields(mutation.snap.data() || {}, mutation.fields),
        intendedAfter: beforeFields(mutation.patch, mutation.fields), expectedCurrentActionId: mutation.action.actionId, rootId: ctx.rootId, createdAt: now() });
      tx.update(mutation.ref, mutation.patch);
    }
    tx.set(actionRef, { status: "COMPLETED", manifestId: manifest.manifestId, actionId: action.actionId, entityType: action.entityType, iqEntityId: action.iqEntityId,
      canonicalGroupId: action.canonicalGroupId, targetPath: action.targetPath, operation: action.operation, backupId, parentBackupIds, completedAt: now() });
    tx.create(audit.doc(), { mode: "EXECUTE", runId, manifestId: manifest.manifestId, actionId: action.actionId, entityType: action.entityType,
      iqEntityId: action.iqEntityId, targetPath: action.targetPath, group: action.canonicalGroupId, operation: action.operation,
      result: "COMPLETED", backupId, rootId: ctx.rootId, actorUid: ctx.uid, historicalEventAt:payload.historicalEventAt||null, createdAt: now() });
    return { outcome: "COMPLETED", progressStatus: "COMPLETED" };
  });
}

async function acquireRun(ctx: Context, manifest: P4Manifest, requestedRunId: string, mode: "EXECUTE" | "RESUME", executionMode: "CANARY" | "FULL") {
  const runId = requestedRunId || `p4r_${deterministicId(manifest.manifestId, ctx.uid, String(Date.now())).slice(0, 24)}`;
  const runRef = runs.doc(runId), lockRef = locks.doc(manifest.manifestId);
  await db.runTransaction(async tx => {
    const [runSnap, lockSnap, manifestSnap] = await Promise.all([tx.get(runRef), tx.get(lockRef), tx.get(manifests.doc(manifest.manifestId))]);
    if(manifestSnap.get("manifestHash")!==manifest.manifestHash)throw new P4EngineError("P4_MANIFEST_HASH_MISMATCH","El manifest cambió.");
    if (mode === "EXECUTE" && manifestSnap.get("status") !== "APPROVED") throw new P4EngineError("P4_MANIFEST_NOT_APPROVED", "Manifest no aprobado.");
    if (lockSnap.exists && lockSnap.get("runId") !== runId) throw new P4EngineError("P4_RUN_ALREADY_ACTIVE", "Ya existe una ejecución para este manifest.");
    if (mode === "RESUME" && !runSnap.exists) throw new P4EngineError("P4_RUN_NOT_FOUND", "Run no disponible para resume.");
    if (!runSnap.exists) tx.create(runRef, { runId, manifestId: manifest.manifestId, manifestHash: manifest.manifestHash, rootId: ctx.rootId,
      status: "RUNNING", mode, executionMode, owner: ctx.uid, cursor: 0, completed: 0, skipped: 0, failed: 0, writes: 0,
      checkpointVersion: 2, phaseInvocationCount: 0, completedCanaryPhases: [], sideEffects: ZERO_SIDE_EFFECTS, startedAt: now(), updatedAt: now(), lastError: null });
    else tx.update(runRef, { status: "RUNNING", mode, executionMode, owner: ctx.uid, updatedAt: now() });
    tx.set(lockRef, { manifestId: manifest.manifestId, runId, owner: ctx.uid, acquiredAt: lockSnap.exists ? lockSnap.get("acquiredAt") : now(), heartbeatAt: now() });
    tx.update(manifests.doc(manifest.manifestId), { status: "EXECUTING", updatedAt: now() });
  });
  return { runId, runRef, lockRef };
}

async function executeLegacy(ctx: Context, data: any, mode: "EXECUTE" | "RESUME") {
  const { manifest } = await loadManifest(ctx, clean(data?.manifestId, 80));
  if (clean(data?.manifestHash, 80) !== manifest.manifestHash) throw new P4EngineError("P4_MANIFEST_HASH_MISMATCH", "Hash requerido para ejecutar.");
  const limits = budget(data?.budget), acquired = await acquireRun(ctx, manifest, clean(data?.runId, 80), mode, "FULL");
  const runBefore = await acquired.runRef.get(); let cursor = Number(runBefore.get("cursor") || 0), completed = 0, skipped = 0, writes = 0, errors = 0, batches = 0;
  const started = Date.now();
  for (; cursor < manifest.actions.length; cursor += 1) {
    if (completed + skipped >= limits.maxEntities || writes >= limits.maxWrites || Date.now() - started >= limits.maxDurationMs || errors >= limits.maxErrors || batches >= limits.maxBatches) break;
    try {
      const result = await executeAction(ctx, acquired.runId, manifest, manifest.actions[cursor]); batches++;
      if (result.outcome === "COMPLETED") { completed++; writes++; } else skipped++;
      await acquired.runRef.set({ cursor: cursor + 1, completed: FieldValue.increment(result.outcome === "COMPLETED" ? 1 : 0),
        skipped: FieldValue.increment(result.outcome === "COMPLETED" ? 0 : 1), writes: FieldValue.increment(result.outcome === "COMPLETED" ? 1 : 0),
        checkpoint: { cursor: cursor + 1, actionId: manifest.actions[cursor].actionId, at: now() }, updatedAt: now() }, { merge: true });
    } catch (error) {
      errors++;
      await acquired.runRef.set({ failed: FieldValue.increment(1), lastError: { code: error instanceof P4EngineError ? error.code : "P4_INTERNAL", message: clean((error as Error)?.message, 300), actionId: manifest.actions[cursor].actionId }, updatedAt: now() }, { merge: true });
      if (errors >= limits.maxErrors) break;
    }
  }
  const done = cursor >= manifest.actions.length;
  await db.runTransaction(async tx => {
    const freshLock = await tx.get(acquired.lockRef);
    if (freshLock.get("runId") !== acquired.runId) throw new P4EngineError("P4_CHECKPOINT_CONFLICT", "Lock cambió durante la ejecución.");
    tx.update(acquired.runRef, { status: done ? "COMPLETED" : "PAUSED_BUDGET", updatedAt: now(), ...(done ? { finishedAt: now() } : {}) });
    tx.delete(acquired.lockRef);
    tx.update(manifests.doc(manifest.manifestId), { status: done ? "COMPLETED" : "APPROVED", updatedAt: now() });
  });
  return { ok: true, mode, manifestId: manifest.manifestId, runId: acquired.runId, status: done ? "COMPLETED" : "PAUSED_BUDGET", cursor,
    batch: { completed, skipped, writes, errors, batches }, sideEffects: ZERO_SIDE_EFFECTS };
}

async function execute(ctx: Context, data: any, mode: "EXECUTE" | "RESUME") {
  const { manifest } = await loadManifest(ctx, clean(data?.manifestId, 80));
  if (manifest.version < 5) return executeLegacy(ctx, data, mode);
  if (clean(data?.manifestHash, 80) !== manifest.manifestHash) throw new P4EngineError("P4_MANIFEST_HASH_MISMATCH", "Hash requerido para ejecutar.");
  if (data?.actionId || data?.cursor || data?.componentId || data?.dependencyOverride) throw new P4EngineError("P4_CANARY_CALLER_SELECTION_FORBIDDEN", "El caller no puede seleccionar action, cursor, component o dependencies.");
  const executionMode = clean(data?.executionMode, 20).toUpperCase() as "CANARY" | "FULL";
  if (!(["CANARY", "FULL"] as string[]).includes(executionMode)) throw new P4EngineError("P4_EXECUTION_MODE_REQUIRED", "executionMode CANARY o FULL es requerido para manifest V5.");
  const requestedPhase = executionMode === "CANARY" ? phase(data?.phase) : undefined;
  if (executionMode === "CANARY" && Number(data?.maxEligibleActions ?? 1) !== 1) throw new P4EngineError("P4_CANARY_LIMIT_INVALID", "CANARY exige maxEligibleActions = 1.");
  const limits = executionMode === "CANARY" ? { ...budget(data?.budget), maxEntities: 1, maxWrites: 1, maxBatches: 1, maxErrors: 1 } : budget(data?.budget);
  if (executionMode === "FULL") {
    const requestedRunId = clean(data?.runId, 80), existingRun = requestedRunId ? await runs.doc(requestedRunId).get() : null;
    const phases = new Set<string>((existingRun?.get("completedCanaryPhases") || []).map((value: unknown) => clean(value, 20)));
    if (!existingRun?.exists || ["CLIENT", "SOLICITUD", "PAYMENT", "APPLICATION"].some(value => !phases.has(value)) || clean(data?.fullAuthorization, 200) !== `FULL:${manifest.manifestId}:${manifest.manifestHash}`)
      throw new P4EngineError("P4_FULL_AUTHORIZATION_REQUIRED", "FULL requiere canary gate completo y autorizacion explicita.");
  }
  const acquired = await acquireRun(ctx, manifest, clean(data?.runId, 80), mode, executionMode);
  const runBefore = await acquired.runRef.get();
  let completed = 0, skipped = 0, writes = 0, errors = 0, batches = 0;
  const started = Date.now(), [progress, verifiedTargets] = await Promise.all([loadActionProgress(acquired.runId), loadVerifiedTargets(manifest)]), preferredComponentId = clean(runBefore.get("canaryComponentId"), 80);
  const stateReader = new P4CurrentStateReader(ctx.rootId, IQ_CREDENTIALS_KEY.value());
  const selectedCanary = requestedPhase ? selectCanaryAction({ manifest, phase: requestedPhase, progress, verifiedTargets, preferredComponentId }) : null;
  if (requestedPhase && !selectedCanary?.selected) {
    const completedPhases = new Set<string>((runBefore.get("completedCanaryPhases") || []).map((value: unknown) => clean(value, 20)));
    const chain = financialCanaryChains(manifest).find(row => row.componentId === preferredComponentId) || financialCanaryChains(manifest)[0];
    const recoveryAction = requestedPhase === "CLIENT" ? manifest.actions.filter(action => action.entityType === "CLIENT" && action.operation === "CREATE_HISTORICAL" && progress[action.actionId] === "COMPLETED").sort((a,b)=>a.actionId.localeCompare(b.actionId))[0]
      : requestedPhase === "SOLICITUD" ? chain?.solicitud : requestedPhase === "PAYMENT" ? chain?.payment : chain?.application;
    if (!completedPhases.has(requestedPhase) && recoveryAction && progress[recoveryAction.actionId] === "COMPLETED") {
      await db.runTransaction(async tx => {
        const freshLock=await tx.get(acquired.lockRef); if(freshLock.get("runId")!==acquired.runId)throw new P4EngineError("P4_CHECKPOINT_CONFLICT","Lock change during canary recovery.");
        tx.update(acquired.runRef,{status:"PAUSED_CANARY",lastPhase:requestedPhase,phaseInvocationCount:FieldValue.increment(1),completedCanaryPhases:FieldValue.arrayUnion(requestedPhase),canaryComponentId:requestedPhase==="CLIENT"?preferredComponentId||null:chain?.componentId||null,recoveredAfterCommittedWrite:true,updatedAt:now()});
        tx.delete(acquired.lockRef);tx.update(manifests.doc(manifest.manifestId),{status:"APPROVED",updatedAt:now()});
        tx.create(audit.doc(),{mode:"P4_CANARY_PHASE_COMPLETED",phase:requestedPhase,runId:acquired.runId,manifestId:manifest.manifestId,actionId:recoveryAction.actionId,componentId:recoveryAction.componentId||null,result:"RECOVERED_AFTER_COMMIT",rootId:ctx.rootId,actorUid:ctx.uid,createdAt:now()});
      });
      return {ok:true,mode,executionMode,phase:requestedPhase,manifestId:manifest.manifestId,runId:acquired.runId,status:"PAUSED_CANARY",selectedActionId:recoveryAction.actionId,recoveredAfterCommittedWrite:true,batch:{completed:0,skipped:1,writes:0,errors:0,batches:0},sideEffects:ZERO_SIDE_EFFECTS};
    }
    await acquired.runRef.set({ status: "PAUSED_CANARY", lastPhase: requestedPhase, phaseInvocationCount: FieldValue.increment(1), lastSelection: { selectedCount: 0, eligibleCount: selectedCanary?.eligible.length || 0, blockedDependencyCount: selectedCanary?.blocked.length || 0, reviewExcludedCount: manifest.actions.filter(isReviewAction).length }, updatedAt: now() }, { merge: true });
    await acquired.lockRef.delete(); await manifests.doc(manifest.manifestId).set({ status: "APPROVED", updatedAt: now() }, { merge: true });
    return { ok: false, mode, executionMode, phase: requestedPhase, manifestId: manifest.manifestId, runId: acquired.runId, status: "PAUSED_CANARY", p4Code: "P4_CANARY_NO_ELIGIBLE_ACTION", selected: null, sideEffects: ZERO_SIDE_EFFECTS };
  }
  const candidateQueue = requestedPhase ? [selectedCanary!.selected!] : manifest.actions;
  for (const action of candidateQueue) {
    if (completed + skipped >= limits.maxEntities || writes >= limits.maxWrites || Date.now() - started >= limits.maxDurationMs || errors >= limits.maxErrors || batches >= limits.maxBatches) break;
    const eligibility = actionEligibility(manifest, action, progress, verifiedTargets);
    if (!eligibility.eligible) { if (!requestedPhase) continue; throw new P4EngineError("P4_CANARY_ELIGIBILITY_CHANGED", `Eligibility cambio para ${action.actionId}.`); }
    try {
      const result = await executeAction(ctx, acquired.runId, manifest, action, true, stateReader); batches++;
      if (result.outcome === "COMPLETED") { completed++; writes++; } else skipped++;
      progress[action.actionId] = result.progressStatus;
      await acquired.runRef.set({ completed: FieldValue.increment(result.outcome === "COMPLETED" ? 1 : 0), skipped: FieldValue.increment(result.outcome === "COMPLETED" ? 0 : 1), writes: FieldValue.increment(result.outcome === "COMPLETED" ? 1 : 0), checkpoint: { version: 2, actionId: action.actionId, status: progress[action.actionId], at: now() }, terminalGuardMetrics: stateReader.metrics, updatedAt: now() }, { merge: true });
    } catch (error) {
      errors++; progress[action.actionId] = "FAILED";
      await actionDoc(acquired.runId, action.actionId).set({ status: "FAILED", manifestId: manifest.manifestId, actionId: action.actionId, entityType: action.entityType, iqEntityId: action.iqEntityId, operation: action.operation, failedAt: now(), errorCode: error instanceof P4EngineError ? error.code : "P4_INTERNAL" }, { merge: true });
      await acquired.runRef.set({ failed: FieldValue.increment(1), lastError: { code: error instanceof P4EngineError ? error.code : "P4_INTERNAL", message: clean((error as Error)?.message, 300), actionId: action.actionId }, updatedAt: now() }, { merge: true });
      if (errors >= limits.maxErrors) break;
    }
  }
  const progressSummary = summarizeActionProgress(manifest, progress, verifiedTargets);
  const done = executionMode === "FULL" && progressSummary.pending === 0 && progressSummary.blocked === 0 && progressSummary.failed === 0;
  const finalStatus = errors ? "PAUSED_ERROR" : executionMode === "CANARY" ? "PAUSED_CANARY" : done ? "COMPLETED" : "PAUSED_BUDGET";
  await db.runTransaction(async tx => {
    const freshLock = await tx.get(acquired.lockRef);
    if (freshLock.get("runId") !== acquired.runId) throw new P4EngineError("P4_CHECKPOINT_CONFLICT", "Lock cambio durante la ejecucion.");
    tx.update(acquired.runRef, { status: finalStatus, lastPhase: requestedPhase || null, phaseInvocationCount: FieldValue.increment(executionMode === "CANARY" ? 1 : 0), ...(executionMode === "CANARY" && !errors && writes === 1 ? { completedCanaryPhases: FieldValue.arrayUnion(requestedPhase), canaryComponentId: requestedPhase === "CLIENT" ? preferredComponentId || null : selectedCanary?.componentId || preferredComponentId || null } : {}), actionProgress: progressSummary, updatedAt: now(), ...(done ? { finishedAt: now() } : {}) });
    tx.delete(acquired.lockRef);
    tx.update(manifests.doc(manifest.manifestId), { status: done ? "COMPLETED" : "APPROVED", updatedAt: now() });
    if(executionMode==="CANARY"&&!errors&&writes===1&&selectedCanary?.selected)tx.create(audit.doc(),{mode:"P4_CANARY_PHASE_COMPLETED",phase:requestedPhase,runId:acquired.runId,manifestId:manifest.manifestId,actionId:selectedCanary.selected.actionId,componentId:selectedCanary.selected.componentId||null,result:"COMPLETED",rootId:ctx.rootId,actorUid:ctx.uid,createdAt:now()});
  });
  return { ok: !errors, mode, executionMode, phase: requestedPhase || null, manifestId: manifest.manifestId, runId: acquired.runId, status: finalStatus, selectedActionId: selectedCanary?.selected?.actionId || null, actionProgress: progressSummary, terminalGuardMetrics: stateReader.metrics, batch: { completed, skipped, writes, errors, batches }, sideEffects: ZERO_SIDE_EFFECTS };
}

async function status(ctx: Context, data: any) {
  const manifestId = clean(data?.manifestId, 80), runId = clean(data?.runId, 80);
  if (runId) { const snap = await runs.doc(runId).get(); if (!snap.exists || snap.get("rootId") !== ctx.rootId) throw new P4EngineError("P4_RUN_NOT_FOUND", "Run no disponible."); return { ok: true, mode: "STATUS", run: serial(snap) }; }
  const { manifest } = await loadManifest(ctx, manifestId); return { ok: true, mode: "STATUS", manifest };
}

async function previewCanonicalReconciliation(ctx: Context, data: any) {
  const manifestId = clean(data?.manifestId, 80), runId = clean(data?.runId, 80);
  const { manifest } = await loadManifest(ctx, manifestId);
  if (!runId) throw new P4EngineError("P4_RUN_NOT_FOUND", "runId requerido.");
  const runSnap = await runs.doc(runId).get();
  if (!runSnap.exists || runSnap.get("rootId") !== ctx.rootId || runSnap.get("manifestId") !== manifest.manifestId) throw new P4EngineError("P4_RUN_NOT_FOUND", "Run no corresponde al manifest/root.");
  const rows: Array<Record<string, unknown>> = [];
  for (const action of manifest.actions) {
    const progress = await actionDoc(runId, action.actionId).get();
    if (progress.get("status") !== "COMPLETED") continue;
    const snap = await db.doc(action.targetPath).get();
    const current = (snap.data() || {}) as Record<string, unknown>;
    const provenanceExact = snap.exists && current.source === "IQ_IMPORT" && current.importManifestId === manifest.manifestId && current.importRunId === runId &&
      current.p4ActionId === action.actionId && action.targetPath === snap.ref.path;
    const assessment = provenanceExact ? assessCanonicalReconciliation(action, current) : { classification: "CURRENT_STATE_CONFLICT", patch: {}, missingFields: [], reason: "Wrong provenance, missing target, or target mismatch" };
    rows.push({ entityType: action.entityType, iqEntityId: action.iqEntityId, actionId: action.actionId, targetPath: action.targetPath,
      classification: assessment.classification, missingFields: assessment.missingFields, reason: assessment.reason,
      changedFields: Object.keys(assessment.patch).sort(), canonicalPatch: assessment.patch,
      protectedFieldsPreserved: ["createdAt","fechaPago","reportDateAt","appliedAt","importedAt","canonicalIqGroupId","originalIqEntityId","financialComponentId","importManifestId","importRunId","p4ActionId"],
      expectedSideEffects: 0, backupRequiredBeforeWrite: assessment.classification === "SAFE_CANONICAL_RECONCILE" });
  }
  const rowByActionId = new Map(rows.map(row => [String(row.actionId), row]));
  for (const row of rows.filter(item => item.entityType === "APPLICATION")) {
    const action = manifest.actions.find(item => item.actionId === row.actionId);
    const blockedParents = (action?.dependencies || []).map(id => rowByActionId.get(id)).filter(parent => parent && ["CANONICAL_FIELD_REVIEW_REQUIRED", "CURRENT_STATE_CONFLICT"].includes(String(parent.classification)));
    if (blockedParents.length) {
      row.classification = "CANONICAL_FIELD_REVIEW_REQUIRED";
      row.canonicalPatch = {};
      row.changedFields = [];
      row.missingFields = ["canonicalParents"];
      row.reason = `Application parents are not canonically reconcilable: ${blockedParents.map(parent => parent!.iqEntityId).join(", ")}`;
      row.backupRequiredBeforeWrite = false;
    }
  }
  const counts = rows.reduce<Record<string, number>>((out, row) => { const key=String(row.classification);out[key]=(out[key]||0)+1;return out; }, {});
  return { ok: true, mode: "PREVIEW_CANONICAL_RECONCILIATION", manifestId, runId, total: rows.length, counts, rows, sideEffects: ZERO_SIDE_EFFECTS };
}

async function canonicalReconciliationContext(ctx:Context,data:any){
  const request=validateReconciliationRequest(data);if(!request.sourceManifestId||!request.evidenceManifestId||!request.evidenceManifestHash)throw new P4EngineError("P4_CANONICAL_RECONCILIATION_CONTRACT_INVALID","Manifest IDs/hash requeridos.");
  const [{manifest:evidence},sourceSnap]=await Promise.all([loadManifest(ctx,request.evidenceManifestId),manifests.doc(request.sourceManifestId).get()]);
  if(evidence.version!==6||evidence.status!=="PLANNED"||evidence.manifestHash!==request.evidenceManifestHash)throw new P4EngineError("P4_CANONICAL_RECONCILIATION_EVIDENCE_INVALID","V6 debe ser server-generated, válido y PLANNED.");
  if(!sourceSnap.exists||sourceSnap.get("rootId")!==ctx.rootId||Number(sourceSnap.get("version"))!==5)throw new P4EngineError("P4_CANONICAL_RECONCILIATION_PROVENANCE_CONFLICT","V5 original no verificable.");const source=manifestFromRow(sourceSnap.data()||{});assertManifestHash(source);validateManifest(source);
  const action=selectScopedAction(evidence,request.phase);if(action.reconciliationOf?.manifestId!==request.sourceManifestId)throw new P4EngineError("P4_CANONICAL_RECONCILIATION_PROVENANCE_CONFLICT","Action V6 no apunta al V5 solicitado.");
  return{request,evidence,action,reconciliationId:reconciliationId(ctx.rootId,request.sourceManifestId,request.evidenceManifestId)};
}

async function previewCanonicalReconciliationR1(ctx:Context,data:any){
  const scope=await canonicalReconciliationContext(ctx,data),snap=await db.doc(scope.action.targetPath).get();if(!snap.exists)throw new P4EngineError("P4_CANONICAL_RECONCILIATION_TARGET_UNAVAILABLE","Target histórico ausente.");
  const preview=buildCanonicalReconciliationPreview(scope.action,snap.data()||{});if(!["SAFE_CANONICAL_RECONCILE","NO_CHANGE"].includes(preview.assessment.classification))throw new P4EngineError("P4_CANONICAL_RECONCILIATION_PROVENANCE_CONFLICT",preview.assessment.reason);
  return{ok:true,mode:"PREVIEW_CANONICAL_RECONCILIATION_R1",scopeId:"P4O_R1_CANARY_2026_10",reconciliationId:scope.reconciliationId,phase:scope.request.phase,targetPath:scope.action.targetPath,entityType:scope.action.entityType,iqEntityId:scope.action.iqEntityId,
    sourceProvenance:scope.action.reconciliationOf,evidence:{manifestId:scope.evidence.manifestId,manifestHash:scope.evidence.manifestHash,actionId:scope.action.actionId,canonicalEvidence:scope.action.canonicalEvidence},classification:preview.assessment.classification,
    changedFields:preview.changedFields,preservedFields:preview.preservedFields,canonicalPatch:preview.patch,beforeFingerprint:preview.beforeFingerprint,afterFingerprint:preview.afterFingerprint,previewHash:preview.previewHash,
    backupFootprint:{collection:"p4CanonicalReconciliationBackups",affectedFields:[...preview.changedFields,"canonicalReconciliation"]},expectedQueryEligible:preview.queryEligible,expectedSideEffects:ZERO_SIDE_EFFECTS};
}

async function reconcileCanonical(ctx:Context,data:any){
  const scope=await canonicalReconciliationContext(ctx,data);if(!scope.request.previewHash)throw new P4EngineError("P4_CANONICAL_RECONCILIATION_PREVIEW_REQUIRED","previewHash requerido.");
  const sessionRef=reconciliationSessions.doc(scope.reconciliationId),target=db.doc(scope.action.targetPath),backupRef=reconciliationBackups.doc(deterministicId(scope.reconciliationId,scope.action.actionId));
  return db.runTransaction(async tx=>{const [targetSnap,sessionSnap,backupSnap,evidenceSnap]=await Promise.all([tx.get(target),tx.get(sessionRef),tx.get(backupRef),tx.get(manifests.doc(scope.evidence.manifestId))]);if(!targetSnap.exists)throw new P4EngineError("P4_CANONICAL_RECONCILIATION_TARGET_UNAVAILABLE","Target histórico ausente.");if(!evidenceSnap.exists||evidenceSnap.get("manifestHash")!==scope.evidence.manifestHash||evidenceSnap.get("status")!=="PLANNED")throw new P4EngineError("P4_RECONCILIATION_TARGET_DRIFT","Evidencia V6 cambió después del preview.");
    const current=(targetSnap.data()||{}) as Record<string,unknown>,preview=buildCanonicalReconciliationPreview(scope.action,current),completed:string[]=sessionSnap.get("completedPhases")||[];
    if(priorPhases(scope.request.phase).some(phase=>!completed.includes(phase)))throw new P4EngineError("P4_CANONICAL_RECONCILIATION_PHASE_GATE","Fase previa no verificada.");
    const existingMarker=(current.canonicalReconciliation||{}) as Record<string,unknown>;
    if(preview.changedFields.length===0&&backupSnap.exists&&existingMarker.manifestId===scope.evidence.manifestId&&existingMarker.actionId===scope.action.actionId&&existingMarker.previewHash===scope.request.previewHash){const sessionStatus=reconciliationSessionStatus({authorizedPhases:P4O_R1_PHASES,completedPhases:completed,failedPhases:sessionSnap.get("failedPhases")||[],completedPhase:scope.request.phase,currentStatus:sessionSnap.get("status")});if(sessionStatus!==sessionSnap.get("status"))tx.set(sessionRef,{authorizedPhases:P4O_R1_PHASES,status:sessionStatus,completedAt:sessionStatus==="COMPLETED"?now():sessionSnap.get("completedAt")||null,updatedAt:now()},{merge:true});return{ok:true,mode:"RECONCILE_CANONICAL",status:"NO_CHANGE_ALREADY_RECONCILED",reconciliationId:scope.reconciliationId,phase:scope.request.phase,targetPath:scope.action.targetPath,changedFields:[],backupId:backupRef.id,sessionStatus,sideEffects:ZERO_SIDE_EFFECTS};}
    if(preview.previewHash!==scope.request.previewHash)throw new P4EngineError("P4_RECONCILIATION_TARGET_DRIFT","Target o evidencia cambió después del preview.");
    if(!["SAFE_CANONICAL_RECONCILE","NO_CHANGE"].includes(preview.assessment.classification))throw new P4EngineError("P4_CANONICAL_RECONCILIATION_PROVENANCE_CONFLICT",preview.assessment.reason);
    if(backupSnap.exists)throw new P4EngineError("P4_CANONICAL_RECONCILIATION_BACKUP_CONFLICT","Backup existente no corresponde a estado idempotente.");
    const affected=[...preview.changedFields,"canonicalReconciliation"],before=beforeFields(current,affected),marker={reconciliationId:scope.reconciliationId,manifestId:scope.evidence.manifestId,actionId:scope.action.actionId,sourceManifestId:scope.request.sourceManifestId,previewHash:preview.previewHash,previous:existingMarker.reconciliationId?existingMarker:null,reconciledAt:now()};
    tx.create(backupRef,{reconciliationId:scope.reconciliationId,scopeId:"P4O_R1_CANARY_2026_10",phase:scope.request.phase,targetPath:scope.action.targetPath,entityType:scope.action.entityType,iqEntityId:scope.action.iqEntityId,sourceProvenance:scope.action.reconciliationOf,evidenceManifestId:scope.evidence.manifestId,evidenceActionId:scope.action.actionId,affectedFields:affected,before,intendedPatch:preview.patch,beforeFingerprint:preview.beforeFingerprint,afterFingerprint:preview.afterFingerprint,previewHash:preview.previewHash,rootId:ctx.rootId,createdAt:now()});
    const sessionStatus=reconciliationSessionStatus({authorizedPhases:P4O_R1_PHASES,completedPhases:completed,failedPhases:sessionSnap.get("failedPhases")||[],completedPhase:scope.request.phase,currentStatus:sessionSnap.get("status")});
    tx.set(target,{...preview.patch,canonicalReconciliation:marker},{merge:true});tx.set(sessionRef,{reconciliationId:scope.reconciliationId,scopeId:"P4O_R1_CANARY_2026_10",authorizedPhases:P4O_R1_PHASES,sourceManifestId:scope.request.sourceManifestId,evidenceManifestId:scope.evidence.manifestId,evidenceManifestHash:scope.evidence.manifestHash,rootId:ctx.rootId,actorUid:ctx.uid,status:sessionStatus,completedPhases:FieldValue.arrayUnion(scope.request.phase),targets:{[scope.request.phase]:{actionId:scope.action.actionId,targetPath:scope.action.targetPath,backupId:backupRef.id,previewHash:preview.previewHash,status:"RECONCILED"}},createdAt:sessionSnap.exists?sessionSnap.get("createdAt"):now(),completedAt:sessionStatus==="COMPLETED"?now():sessionSnap.get("completedAt")||null,updatedAt:now()},{merge:true});
    tx.create(audit.doc(),{mode:"P4_CANONICAL_RECONCILIATION",reconciliationId:scope.reconciliationId,phase:scope.request.phase,targetPath:scope.action.targetPath,entityType:scope.action.entityType,iqEntityId:scope.action.iqEntityId,sourceProvenance:scope.action.reconciliationOf,evidenceManifestId:scope.evidence.manifestId,evidenceActionId:scope.action.actionId,changedFields:preview.changedFields,previewHash:preview.previewHash,beforeFingerprint:preview.beforeFingerprint,afterFingerprint:preview.afterFingerprint,backupId:backupRef.id,rootId:ctx.rootId,actorUid:ctx.uid,createdAt:now()});
    return{ok:true,mode:"RECONCILE_CANONICAL",status:"RECONCILED",reconciliationId:scope.reconciliationId,phase:scope.request.phase,targetPath:scope.action.targetPath,changedFields:preview.changedFields,backupId:backupRef.id,sessionStatus,sideEffects:ZERO_SIDE_EFFECTS};});
}

async function verifyCanonicalReconciliation(ctx:Context,data:any){
  const scope=await canonicalReconciliationContext(ctx,data),session=await reconciliationSessions.doc(scope.reconciliationId).get(),snap=await db.doc(scope.action.targetPath).get(),backup=await reconciliationBackups.doc(deterministicId(scope.reconciliationId,scope.action.actionId)).get();
  const current=(snap.data()||{}) as Record<string,unknown>,preview=snap.exists?buildCanonicalReconciliationPreview(scope.action,current):null,marker=(current.canonicalReconciliation||{}) as Record<string,unknown>,reconciled=marker.manifestId===scope.evidence.manifestId&&marker.actionId===scope.action.actionId;
  return{ok:!!(snap.exists&&reconciled&&preview?.assessment.classification==="NO_CHANGE"&&queryEligible(scope.action,current)&&backup.exists),mode:"VERIFY_CANONICAL_RECONCILIATION",reconciliationId:scope.reconciliationId,phase:scope.request.phase,status:reconciled?"RECONCILED":"PENDING",canonicalPayloadValid:preview?.assessment.classification==="NO_CHANGE",queryEligible:queryEligible(scope.action,current),backupReady:backup.exists,mismatched:preview?.changedFields||[],failed:[],sessionStatus:session.get("status")||null,sideEffects:ZERO_SIDE_EFFECTS};
}

async function canonicalScopeContext(ctx:Context,data:any){
  const request=validateScopeRequest(data);
  if(!request.sourceManifestId||!request.evidenceManifestId||!request.evidenceManifestHash)throw new P4EngineError("P4_CANONICAL_RECONCILIATION_CONTRACT_INVALID","Manifest IDs/hash requeridos.");
  const [{manifest:evidence},sourceSnap]=await Promise.all([loadManifest(ctx,request.evidenceManifestId),manifests.doc(request.sourceManifestId).get()]);
  const expectedEvidenceVersion=request.scope.startsWith("R3_")?7:6;
  if(evidence.version!==expectedEvidenceVersion||evidence.status!=="PLANNED"||evidence.manifestHash!==request.evidenceManifestHash)throw new P4EngineError("P4_CANONICAL_EVIDENCE_STALE",`Evidencia V${expectedEvidenceVersion} inválida, mutable o no PLANNED.`);
  if(!sourceSnap.exists||sourceSnap.get("rootId")!==ctx.rootId||Number(sourceSnap.get("version"))!==5)throw new P4EngineError("P4_CANONICAL_RECONCILIATION_PROVENANCE_CONFLICT","V5 original no verificable.");
  const source=manifestFromRow(sourceSnap.data()||{});assertManifestHash(source);validateManifest(source);
  const actions=selectScopeActions(evidence,request.scope,request.phase,request.sourceManifestId);
  if(!actions.length)throw new P4EngineError("P4_CANONICAL_RECONCILIATION_SCOPE_INVALID","Scope no resolvió acciones exactas.");
  if(request.scope==="CERTIFICATION_WINDOW_REMAINING"&&request.phase!=="CLIENT"){
    const pending=evidence.actions.some(action=>action.entityType===request.phase&&action.operation==="CANONICAL_DEPENDENCY_PENDING");
    if(pending)throw new P4EngineError("P4_CANONICAL_EVIDENCE_STALE","La fase financiera requiere PLAN post-CLIENT determinista.");
  }
  const sessionId=scopeSessionId(ctx.rootId,request.sourceManifestId,request.evidenceManifestId,request.scope,request.phase);
  if(request.scope==="CERTIFICATION_WINDOW_REMAINING"&&["PAYMENT","APPLICATION"].includes(request.phase)){
    const required=request.phase==="PAYMENT"?["SOLICITUD"]:["SOLICITUD","PAYMENT"];
    const prior=await db.getAll(...required.map(phase=>reconciliationSessions.doc(scopeSessionId(ctx.rootId,request.sourceManifestId,request.evidenceManifestId,request.scope,phase as P4CanonicalReconciliationPhase))));
    if(prior.some(snap=>snap.get("status")!=="COMPLETED"))throw new P4EngineError("P4_CLIENT_DEPENDENCY_PENDING","Fase financiera previa no está completada y verificada.");
  }
  return{request,evidence,actions,sessionId,sessionRef:reconciliationSessions.doc(sessionId)};
}

async function scopePreviewData(ctx:Context,data:any){
  const scope=await canonicalScopeContext(ctx,data);
  const [targetSnaps,progressSnaps]=await Promise.all([
    db.getAll(...scope.actions.map(action=>db.doc(action.targetPath))),
    db.getAll(...scope.actions.map(action=>scope.sessionRef.collection("actions").doc(scopeActionProgressId(action)))),
  ]);
  const currentByPath=new Map<string,Record<string,unknown>|null>();targetSnaps.forEach(snap=>currentByPath.set(snap.ref.path,snap.exists?(snap.data()||{}) as Record<string,unknown>:null));
  const progressByActionId=new Map<string,P4ScopeActionState>();progressSnaps.forEach((snap,index)=>{if(snap.exists)progressByActionId.set(scope.actions[index].actionId,snap.get("status") as P4ScopeActionState);});
  const preview=buildScopePreview({manifest:scope.evidence,scope:scope.request.scope,phase:scope.request.phase,sourceManifestId:scope.request.sourceManifestId,currentByPath,progressByActionId});
  return{scope,preview};
}

async function previewCanonicalReconciliationScope(ctx:Context,data:any){
  const {scope,preview}=await scopePreviewData(ctx,data);
  return{ok:true,mode:"PREVIEW_CANONICAL_RECONCILIATION_SCOPE",scope:scope.request.scope,sessionId:scope.sessionId,phase:scope.request.phase,sourceManifestId:scope.request.sourceManifestId,evidenceManifestId:scope.evidence.manifestId,evidenceManifestHash:scope.evidence.manifestHash,requiresPostClientPlan:requiresPostClientPlan(scope.request.scope,scope.request.phase),...preview,sideEffects:ZERO_SIDE_EFFECTS};
}

const R3_SCOPE_LEASE_MS=5*60*1000;
export async function acquireScopeLease(sessionRef:FirebaseFirestore.DocumentReference,ctx:Context){
  const token=randomUUID(),nowMs=Date.now();
  return db.runTransaction(async tx=>{
    const snap=await tx.get(sessionRef),lease=(snap.get("lease")||{}) as Record<string,unknown>,expiresAt=lease.expiresAt as {toMillis?:()=>number}|undefined;
    if(String(lease.token||"")&&Number(expiresAt?.toMillis?.()||0)>nowMs)throw new P4EngineError("P4_RECONCILIATION_LEASE_HELD","Otra ejecución conserva el lease activo.");
    const fence=Math.max(0,Number(snap.get("fence")||0))+1;
    tx.set(sessionRef,{fence,lease:{token,fence,holderUid:ctx.uid,acquiredAt:now(),expiresAt:admin.firestore.Timestamp.fromMillis(nowMs+R3_SCOPE_LEASE_MS)},updatedAt:now()},{merge:true});
    return{token,fence};
  });
}
export function assertScopeLease(session:FirebaseFirestore.DocumentSnapshot,lease:{token:string;fence:number}){
  const current=(session.get("lease")||{}) as Record<string,unknown>,expiresAt=current.expiresAt as {toMillis?:()=>number}|undefined;
  if(current.token!==lease.token||Number(current.fence)!==lease.fence||Number(session.get("fence"))!==lease.fence||Number(expiresAt?.toMillis?.()||0)<=Date.now())throw new P4EngineError("P4_RECONCILIATION_LEASE_LOST","Lease/fencing de reconciliación inválido o vencido.");
}
export async function releaseScopeLease(sessionRef:FirebaseFirestore.DocumentReference,lease:{token:string;fence:number}){
  await db.runTransaction(async tx=>{const snap=await tx.get(sessionRef),current=(snap.get("lease")||{}) as Record<string,unknown>;if(current.token===lease.token&&Number(current.fence)===lease.fence)tx.set(sessionRef,{lease:FieldValue.delete(),updatedAt:now()},{merge:true});});
}

async function reconcileCanonicalScope(ctx:Context,data:any){
  const started=Date.now(),{scope,preview}=await scopePreviewData(ctx,data),request=scope.request;
  if(!request.scopeFingerprint||request.scopeFingerprint!==preview.scopeFingerprint)throw new P4EngineError("P4_RECONCILIATION_SCOPE_DRIFT","Scope fingerprint cambió después del preview.");
  if(request.scope.startsWith("R3_")&&request.executionAuthorization!==`RECONCILE_R3:${request.evidenceManifestId}:${request.evidenceManifestHash}:${request.scopeFingerprint}:${request.phase}`)throw new P4EngineError("P4_EXECUTION_AUTHORIZATION_INVALID","Autorización explícita R3 inválida.");
  const allActions=scope.actions,previewById=new Map(preview.actions.map(row=>[row.actionId,row])),progressByActionId=new Map(preview.actions.map(row=>[row.actionId,row.progress as P4ScopeActionState])),ordered=pendingScopeActions(allActions,progressByActionId);let processed=0,writes=0,reconciled=0,noChange=0,review=0,failed=0,budgetStop=false;
  await scope.sessionRef.set({sessionId:scope.sessionId,scopeId:P4O_R4_SCOPE_ID,scope:request.scope,phase:request.phase,sourceManifestId:request.sourceManifestId,evidenceManifestId:request.evidenceManifestId,evidenceManifestHash:request.evidenceManifestHash,scopeFingerprint:preview.scopeFingerprint,selectedActionIds:allActions.map(action=>action.actionId),rootId:ctx.rootId,actorUid:ctx.uid,status:"IN_PROGRESS",createdAt:now(),updatedAt:now()},{merge:true});
  const lease=await acquireScopeLease(scope.sessionRef,ctx);
  for(const action of ordered){
    if(processed>=request.budget.maxActions||writes>=request.budget.maxWrites||Date.now()-started>=request.budget.maxDurationMs){budgetStop=true;break;}
    const progressRef=scope.sessionRef.collection("actions").doc(scopeActionProgressId(action)),targetRef=db.doc(action.targetPath),backupRef=reconciliationBackups.doc(scopeBackupId(scope.sessionId,action)),expected=previewById.get(action.actionId)!;
    try{
      const outcome=await db.runTransaction(async tx=>{
        const [progressSnap,targetSnap,backupSnap,evidenceSnap,sessionSnap]=await Promise.all([tx.get(progressRef),tx.get(targetRef),tx.get(backupRef),tx.get(manifests.doc(scope.evidence.manifestId)),tx.get(scope.sessionRef)]);assertScopeLease(sessionSnap,lease);
        const prior=progressSnap.get("status") as P4ScopeActionState|undefined;if(prior&&["RECONCILED","NO_CHANGE","REVIEW"].includes(prior))return prior;
        if(Number(progressSnap.get("attempts")||0)>=request.budget.maxRetries){tx.set(progressRef,{actionId:action.actionId,status:"REVIEW",reason:"MAX_RETRIES_EXHAUSTED",targetPath:action.targetPath,updatedAt:now()},{merge:true});return"REVIEW" as P4ScopeActionState;}
        if(!evidenceSnap.exists||evidenceSnap.get("manifestHash")!==scope.evidence.manifestHash||evidenceSnap.get("status")!=="PLANNED")throw new P4EngineError("P4_CANONICAL_EVIDENCE_STALE","Evidencia cambió durante la ejecución.");
        if(!targetSnap.exists){tx.set(progressRef,{actionId:action.actionId,status:"REVIEW",reason:"MISSING_DOCUMENT",targetPath:action.targetPath,updatedAt:now()},{merge:true});return"REVIEW" as P4ScopeActionState;}
        const current=(targetSnap.data()||{}) as Record<string,unknown>,fresh=buildCanonicalReconciliationPreview(action,current),classification=fresh.assessment.classification;
        if(clean(current.rootId,128)&&clean(current.rootId,128)!==action.rootId){tx.set(progressRef,{actionId:action.actionId,status:"REVIEW",reason:"CLIENT_ROOT_CONFLICT",targetPath:action.targetPath,updatedAt:now()},{merge:true});return"REVIEW" as P4ScopeActionState;}
        if(fresh.previewHash!==expected.previewHash)throw new P4EngineError("P4_RECONCILIATION_TARGET_DRIFT",`Target cambió: ${action.actionId}`);
        if(!["SAFE_CANONICAL_RECONCILE","NO_CHANGE"].includes(classification)){tx.set(progressRef,{actionId:action.actionId,status:"REVIEW",reason:fresh.assessment.reason||classification,targetPath:action.targetPath,updatedAt:now()},{merge:true});return"REVIEW" as P4ScopeActionState;}
        if(classification==="NO_CHANGE") {tx.set(progressRef,{actionId:action.actionId,status:"NO_CHANGE",targetPath:action.targetPath,previewHash:fresh.previewHash,verified:true,updatedAt:now()},{merge:true});tx.create(audit.doc(),{mode:"P4_CANONICAL_RECONCILIATION_NO_CHANGE",scopeId:P4O_R4_SCOPE_ID,scope:request.scope,sessionId:scope.sessionId,phase:request.phase,targetPath:action.targetPath,entityType:action.entityType,iqEntityId:action.iqEntityId,actionId:action.actionId,previewHash:fresh.previewHash,rootId:ctx.rootId,actorUid:ctx.uid,createdAt:now()});return"NO_CHANGE" as P4ScopeActionState;}
        assertPatchContract(action,fresh.changedFields);if(backupSnap.exists)throw new P4EngineError("P4_CANONICAL_RECONCILIATION_BACKUP_FAILED","Backup determinista ya existe sin progreso terminal.");
        const marker={reconciliationId:scope.sessionId,scopeId:P4O_R4_SCOPE_ID,manifestId:scope.evidence.manifestId,actionId:action.actionId,sourceManifestId:request.sourceManifestId,previewHash:fresh.previewHash,previous:(current.canonicalReconciliation as Record<string,unknown>)?.reconciliationId?current.canonicalReconciliation:null,reconciledAt:now()};
        const affected=[...fresh.changedFields,"canonicalReconciliation"],before=beforeFields(current,affected);
        tx.create(backupRef,{reconciliationId:scope.sessionId,scopeId:P4O_R4_SCOPE_ID,scope:request.scope,phase:request.phase,targetPath:action.targetPath,entityType:action.entityType,iqEntityId:action.iqEntityId,actionId:action.actionId,affectedFields:affected,before,intendedPatch:fresh.patch,beforeFingerprint:fresh.beforeFingerprint,afterFingerprint:fresh.afterFingerprint,previewHash:fresh.previewHash,rootId:ctx.rootId,createdAt:now()});
        tx.set(targetRef,{...fresh.patch,canonicalReconciliation:marker},{merge:true});
        tx.set(progressRef,{actionId:action.actionId,status:"RECONCILED",targetPath:action.targetPath,changedFields:fresh.changedFields,backupId:backupRef.id,previewHash:fresh.previewHash,verified:false,updatedAt:now()},{merge:true});
        tx.create(audit.doc(),{mode:"P4_CANONICAL_RECONCILIATION",scopeId:P4O_R4_SCOPE_ID,scope:request.scope,sessionId:scope.sessionId,phase:request.phase,targetPath:action.targetPath,entityType:action.entityType,iqEntityId:action.iqEntityId,actionId:action.actionId,changedFields:fresh.changedFields,previewHash:fresh.previewHash,backupId:backupRef.id,rootId:ctx.rootId,actorUid:ctx.uid,createdAt:now()});return"RECONCILED" as P4ScopeActionState;
      });
      processed++;if(outcome==="RECONCILED"){reconciled++;writes++;}else if(outcome==="NO_CHANGE")noChange++;else if(outcome==="REVIEW")review++;
    }catch(error){failed++;await progressRef.set({actionId:action.actionId,status:"FAILED",targetPath:action.targetPath,attempts:FieldValue.increment(1),errorCode:clean((error as {code?:unknown})?.code||"P4_PATCH_FAILED",80),updatedAt:now()},{merge:true});if(failed>=request.budget.maxErrors)break;}
  }
  const progressSnaps=await db.getAll(...allActions.map(action=>scope.sessionRef.collection("actions").doc(scopeActionProgressId(action))));
  const states=progressSnaps.map(snap=>(snap.get("status")||"PENDING") as P4ScopeActionState),baseStatus=phaseStatus(states),status=baseStatus==="COMPLETED"&&requiresPostClientPlan(request.scope,request.phase)?"AWAITING_POST_CLIENT_PLAN":baseStatus==="IN_PROGRESS"&&budgetStop?"PAUSED_BUDGET":baseStatus;
  const counts=states.reduce<Record<string,number>>((out,state)=>{out[state]=(out[state]||0)+1;return out;},{});
  await scope.sessionRef.set({status,counts,budgetStop,updatedAt:now(),...(status==="AWAITING_POST_CLIENT_PLAN"||status==="COMPLETED"?{phaseCompletedAt:now()}: {})},{merge:true});
  await releaseScopeLease(scope.sessionRef,lease);
  return{ok:failed===0,mode:"RECONCILE_CANONICAL_SCOPE",scope:request.scope,scopeId:P4O_R4_SCOPE_ID,sessionId:scope.sessionId,phase:request.phase,status,scopeFingerprint:preview.scopeFingerprint,selected:allActions.length,processed,reconciled,noChange,review,failed,remaining:states.filter(state=>state==="PENDING").length,budgetStop,durationMs:Date.now()-started,requiresPostClientPlan:status==="AWAITING_POST_CLIENT_PLAN",sideEffects:ZERO_SIDE_EFFECTS};
}

async function verifyCanonicalReconciliationScope(ctx:Context,data:any){
  const {scope,preview}=await scopePreviewData(ctx,data),progressSnaps=await db.getAll(...scope.actions.map(action=>scope.sessionRef.collection("actions").doc(scopeActionProgressId(action))));
  const rows=preview.actions.map((row,index)=>{const status=(progressSnaps[index].get("status")||"PENDING") as P4ScopeActionState;return{actionId:row.actionId,entityType:row.entityType,iqEntityId:row.iqEntityId,status,canonicalPayloadValid:status==="RECONCILED"||status==="NO_CHANGE"?row.classification==="NO_CHANGE":status==="REVIEW",queryEligible:status==="RECONCILED"||status==="NO_CHANGE"?row.queryEligible:false,mismatched:status==="RECONCILED"&&row.classification!=="NO_CHANGE"?row.changedFields:[],failed:status==="FAILED"};});
  const unresolved=rows.filter(row=>["PENDING","FAILED"].includes(row.status)),mismatched=rows.filter(row=>row.status==="RECONCILED"&&(!row.canonicalPayloadValid||!row.queryEligible||row.mismatched.length));
  const session=await scope.sessionRef.get();return{ok:unresolved.length===0&&mismatched.length===0,mode:"VERIFY_CANONICAL_RECONCILIATION_SCOPE",scope:scope.request.scope,scopeId:P4O_R4_SCOPE_ID,sessionId:scope.sessionId,phase:scope.request.phase,sessionStatus:session.get("status")||null,selected:rows.length,rows,unresolved:unresolved.map(row=>row.actionId),mismatched:mismatched.map(row=>row.actionId),requiresPostClientPlan:requiresPostClientPlan(scope.request.scope,scope.request.phase),sideEffects:ZERO_SIDE_EFFECTS};
}

async function rollbackCanonicalReconciliationScope(ctx:Context,data:any){
  const scope=await canonicalScopeContext(ctx,data),confirmation=clean(data?.confirmation,240);
  if(confirmation!==`ROLLBACK_CANONICAL_SCOPE:${scope.sessionId}:${scope.request.phase}`)throw new P4EngineError("P4_ROLLBACK_CONFIRMATION_REQUIRED","Confirmación de rollback R4 inválida.");
  let rolledBack=0;
  for(const action of [...scope.actions].reverse()){
    const progressRef=scope.sessionRef.collection("actions").doc(scopeActionProgressId(action)),targetRef=db.doc(action.targetPath),backupRef=reconciliationBackups.doc(scopeBackupId(scope.sessionId,action));
    const progress=await progressRef.get();if(progress.get("status")!=="RECONCILED")continue;
    await db.runTransaction(async tx=>{const [target,backup,freshProgress]=await Promise.all([tx.get(targetRef),tx.get(backupRef),tx.get(progressRef)]);if(freshProgress.get("status")!=="RECONCILED")return;if(!target.exists||!backup.exists)throw new P4EngineError("P4_CANONICAL_RECONCILIATION_BACKUP_FAILED","Target o backup R4 ausente.");
      const current=(target.data()||{}) as Record<string,unknown>,marker=(current.canonicalReconciliation||{}) as Record<string,unknown>;if(marker.reconciliationId!==scope.sessionId||marker.actionId!==action.actionId)throw new P4EngineError("P4_RECONCILIATION_TARGET_DRIFT","Target cambió después de reconciliar.");
      const withoutMarker={...current};delete withoutMarker.canonicalReconciliation;if(fingerprint(withoutMarker)!==backup.get("afterFingerprint"))throw new P4EngineError("P4_RECONCILIATION_TARGET_DRIFT","Payload cambió después de reconciliar.");
      const before=backup.get("before")||{},restore:Record<string,unknown>={};for(const field of backup.get("affectedFields")||[]){const value=before[field];restore[field]=value?.present?value.value:FieldValue.delete();}
      tx.update(targetRef,restore);tx.set(progressRef,{status:"ROLLED_BACK",rolledBackAt:now(),updatedAt:now()},{merge:true});tx.create(audit.doc(),{mode:"P4_CANONICAL_RECONCILIATION_SCOPE_ROLLBACK",scopeId:P4O_R4_SCOPE_ID,scope:scope.request.scope,sessionId:scope.sessionId,phase:scope.request.phase,actionId:action.actionId,targetPath:action.targetPath,backupId:backupRef.id,rootId:ctx.rootId,actorUid:ctx.uid,createdAt:now()});});rolledBack++;
  }
  await scope.sessionRef.set({status:"ROLLED_BACK",rolledBack,rolledBackAt:now(),updatedAt:now()},{merge:true});return{ok:true,mode:"ROLLBACK_CANONICAL_RECONCILIATION_SCOPE",scope:scope.request.scope,scopeId:P4O_R4_SCOPE_ID,sessionId:scope.sessionId,phase:scope.request.phase,status:"ROLLED_BACK",rolledBack,targetPreserved:true,sideEffects:ZERO_SIDE_EFFECTS};
}

async function rollbackCanonicalReconciliation(ctx:Context,data:any){
  const scope=await canonicalReconciliationContext(ctx,data),confirmation=clean(data?.confirmation,240);if(confirmation!==`ROLLBACK_CANONICAL:${scope.reconciliationId}:${scope.request.phase}`)throw new P4EngineError("P4_ROLLBACK_CONFIRMATION_REQUIRED","Confirmación de rollback canónico inválida.");
  const sessionRef=reconciliationSessions.doc(scope.reconciliationId),target=db.doc(scope.action.targetPath),backupRef=reconciliationBackups.doc(deterministicId(scope.reconciliationId,scope.action.actionId));
  return db.runTransaction(async tx=>{const [snap,backup]=await Promise.all([tx.get(target),tx.get(backupRef)]);if(!snap.exists||!backup.exists)throw new P4EngineError("P4_CANONICAL_RECONCILIATION_BACKUP_NOT_FOUND","Backup canónico ausente.");const current=(snap.data()||{}) as Record<string,unknown>,marker=(current.canonicalReconciliation||{}) as Record<string,unknown>;if(marker.reconciliationId!==scope.reconciliationId||marker.actionId!==scope.action.actionId)throw new P4EngineError("P4_RECONCILIATION_TARGET_DRIFT","Target cambió después de reconciliar.");
    const currentWithoutMarker={...current};delete currentWithoutMarker.canonicalReconciliation;if(buildCanonicalReconciliationPreview(scope.action,currentWithoutMarker).afterFingerprint!==backup.get("afterFingerprint"))throw new P4EngineError("P4_RECONCILIATION_TARGET_DRIFT","Target cambió después de reconciliar.");const before=backup.get("before")||{},restore:Record<string,unknown>={};for(const field of backup.get("affectedFields")||[]){const value=before[field];restore[field]=value?.present?value.value:FieldValue.delete();}tx.update(target,restore);tx.set(sessionRef,{status:"ROLLED_BACK",rolledBackPhases:FieldValue.arrayUnion(scope.request.phase),updatedAt:now()},{merge:true});tx.create(audit.doc(),{mode:"P4_CANONICAL_RECONCILIATION_ROLLBACK",reconciliationId:scope.reconciliationId,phase:scope.request.phase,targetPath:scope.action.targetPath,backupId:backupRef.id,rootId:ctx.rootId,actorUid:ctx.uid,createdAt:now()});return{ok:true,mode:"ROLLBACK_CANONICAL_RECONCILIATION",status:"ROLLED_BACK",reconciliationId:scope.reconciliationId,phase:scope.request.phase,targetPreserved:true,sideEffects:ZERO_SIDE_EFFECTS};});
}

async function previewR3OperationalPolicy(ctx:Context){
  if(ctx.rootId!==R3_OPERATIONAL_POLICY.rootId)throw new P4EngineError("P4_ROOT_REVIEW_REQUIRED","Root fuera de la política R3 certificada.");
  const pointerRef=db.doc(`iqOperationalAssignmentPolicies/${ctx.rootId}`),versionRef=pointerRef.collection("versions").doc(R3_OPERATIONAL_POLICY.policyVersion),userIds=[...new Set(Object.values(R3_OPERATIONAL_POLICY.mappings).map(row=>row.adminId))];
  const [pointer,version,...users]=await db.getAll(pointerRef,versionRef,...userIds.map(id=>db.doc(`users/${id}`)));
  const userEvidence=users.map((snap,index)=>({uid:userIds[index],exists:snap.exists,rootId:String(snap.get("rootId")||snap.id),active:snap.exists&&snap.get("active")!==false&&snap.get("isActive")!==false&&snap.get("disabled")!==true&&snap.get("deleted")!==true}));
  const usersValid=userEvidence.every(row=>row.exists&&row.rootId===ctx.rootId&&row.active),sameVersion=version.exists&&version.get("policyHash")===R3_OPERATIONAL_POLICY_HASH&&version.get("status")==="ACTIVE",pointerActive=pointer.get("activeVersion")===R3_OPERATIONAL_POLICY.policyVersion;
  return{ok:usersValid,mode:"PREVIEW_R3_OPERATIONAL_POLICY",classification:sameVersion&&pointerActive?"NO_CHANGE":version.exists&&!sameVersion?"CONFLICT":"ACTIVATE",policyVersion:R3_OPERATIONAL_POLICY.policyVersion,policyHash:R3_OPERATIONAL_POLICY_HASH,rootId:ctx.rootId,mappings:R3_OPERATIONAL_POLICY.mappings,userEvidence,currentActiveVersion:pointer.get("activeVersion")||null,expectedWrites:sameVersion&&pointerActive?0:2,sideEffects:ZERO_SIDE_EFFECTS};
}

async function activateR3OperationalPolicy(ctx:Context,data:any){
  const preview=await previewR3OperationalPolicy(ctx),confirmation=clean(data?.confirmation,240);
  if(!preview.ok||preview.classification==="CONFLICT")throw new P4EngineError("P4_RESPONSIBLE_USER_REVIEW_REQUIRED","Política o usuarios R3 requieren revisión.");
  if(confirmation!==`ACTIVATE_R3_POLICY:${R3_OPERATIONAL_POLICY.policyVersion}:${R3_OPERATIONAL_POLICY_HASH}`)throw new P4EngineError("P4_EXECUTION_AUTHORIZATION_INVALID","Autorización de política R3 inválida.");
  if(preview.classification==="NO_CHANGE")return{...preview,mode:"ACTIVATE_R3_OPERATIONAL_POLICY",status:"NO_CHANGE"};
  const pointerRef=db.doc(`iqOperationalAssignmentPolicies/${ctx.rootId}`),versionRef=pointerRef.collection("versions").doc(R3_OPERATIONAL_POLICY.policyVersion),backupRef=r3PolicyBackups.doc(R3_OPERATIONAL_POLICY_BACKUP_ID);
  await db.runTransaction(async tx=>{const [pointer,version,backup]=await Promise.all([tx.get(pointerRef),tx.get(versionRef),tx.get(backupRef)]);if(version.exists)throw new P4EngineError("P4_RECONCILIATION_TARGET_DRIFT","La versión R3 apareció después del preview.");if(backup.exists)throw new P4EngineError("P4_CANONICAL_RECONCILIATION_BACKUP_FAILED","Backup de política ya existe sin activación idempotente.");tx.create(backupRef,{backupId:backupRef.id,rootId:ctx.rootId,policyVersion:R3_OPERATIONAL_POLICY.policyVersion,policyHash:R3_OPERATIONAL_POLICY_HASH,pointerBefore:{present:pointer.exists,data:pointer.data()||null},versionBefore:{present:false,data:null},actorUid:ctx.uid,createdAt:now()});tx.create(versionRef,{...R3_OPERATIONAL_POLICY,status:"ACTIVE",policyHash:R3_OPERATIONAL_POLICY_HASH,activatedBy:ctx.uid,activatedAt:now()});tx.set(pointerRef,{activeVersion:R3_OPERATIONAL_POLICY.policyVersion,activePolicyHash:R3_OPERATIONAL_POLICY_HASH,updatedBy:ctx.uid,updatedAt:now()},{merge:true});tx.create(audit.doc(),{mode:"P4_R3_POLICY_ACTIVATE",rootId:ctx.rootId,policyVersion:R3_OPERATIONAL_POLICY.policyVersion,policyHash:R3_OPERATIONAL_POLICY_HASH,backupId:backupRef.id,actorUid:ctx.uid,createdAt:now()});});
  return{ok:true,mode:"ACTIVATE_R3_OPERATIONAL_POLICY",status:"ACTIVE",policyVersion:R3_OPERATIONAL_POLICY.policyVersion,policyHash:R3_OPERATIONAL_POLICY_HASH,backupId:backupRef.id,writes:2,sideEffects:ZERO_SIDE_EFFECTS};
}

async function verifyR3OperationalPolicy(ctx:Context){const preview=await previewR3OperationalPolicy(ctx);return{...preview,mode:"VERIFY_R3_OPERATIONAL_POLICY",verified:preview.ok&&preview.classification==="NO_CHANGE"};}

async function rollbackR3OperationalPolicy(ctx:Context,data:any){
  const confirmation=clean(data?.confirmation,240);if(confirmation!==`ROLLBACK_R3_POLICY:${R3_OPERATIONAL_POLICY.policyVersion}:${R3_OPERATIONAL_POLICY_HASH}`)throw new P4EngineError("P4_ROLLBACK_CONFIRMATION_REQUIRED","Confirmación de rollback R3 inválida.");
  const pointerRef=db.doc(`iqOperationalAssignmentPolicies/${ctx.rootId}`),versionRef=pointerRef.collection("versions").doc(R3_OPERATIONAL_POLICY.policyVersion),backupRef=r3PolicyBackups.doc(R3_OPERATIONAL_POLICY_BACKUP_ID);
  await db.runTransaction(async tx=>{const [pointer,version,backup]=await Promise.all([tx.get(pointerRef),tx.get(versionRef),tx.get(backupRef)]);if(!backup.exists||!version.exists||version.get("policyHash")!==R3_OPERATIONAL_POLICY_HASH||pointer.get("activeVersion")!==R3_OPERATIONAL_POLICY.policyVersion)throw new P4EngineError("P4_RECONCILIATION_TARGET_DRIFT","Política R3 no coincide con el backup.");const prior=backup.get("pointerBefore")||{};if(prior.present)tx.set(pointerRef,prior.data);else tx.delete(pointerRef);tx.delete(versionRef);tx.set(backupRef,{rolledBackBy:ctx.uid,rolledBackAt:now()},{merge:true});tx.create(audit.doc(),{mode:"P4_R3_POLICY_ROLLBACK",rootId:ctx.rootId,policyVersion:R3_OPERATIONAL_POLICY.policyVersion,policyHash:R3_OPERATIONAL_POLICY_HASH,backupId:backupRef.id,actorUid:ctx.uid,createdAt:now()});});return{ok:true,mode:"ROLLBACK_R3_OPERATIONAL_POLICY",status:"ROLLED_BACK",policyVersion:R3_OPERATIONAL_POLICY.policyVersion,policyHash:R3_OPERATIONAL_POLICY_HASH,sideEffects:ZERO_SIDE_EFFECTS};
}

async function verifyLegacy(ctx: Context, data: any) {
  const { manifest } = await loadManifest(ctx, clean(data?.manifestId, 80)); const missing: string[] = [], mismatched: string[] = [], unexpected: string[] = [];
  for (const action of manifest.actions.filter(item => ["RECONCILE", "CREATE_HISTORICAL", "DEPENDENCY_IMPORT"].includes(item.operation))) {
    const snap = await db.doc(action.targetPath).get();
    if (!snap.exists) missing.push(action.actionId);
    else {const temporalMismatch=[...P4_TEMPORAL_TIMESTAMP_FIELDS].some(field=>{if(!(field in action.after))return false;const actual=snap.get(field),expected=action.after[field],actualMs=actual?.toMillis?.()??(typeof actual==="string"?Date.parse(actual):NaN),expectedMs=typeof expected==="string"?Date.parse(expected):NaN;return !Number.isFinite(actualMs)||!Number.isFinite(expectedMs)||actualMs!==expectedMs;});if(snap.get("p4ActionId") !== action.actionId || snap.get("importManifestId") !== manifest.manifestId || snap.get("source") !== "IQ_IMPORT"||temporalMismatch)mismatched.push(action.actionId);}
  }
  const duplicateSnap = await db.collectionGroup("actions").where("manifestId", "==", manifest.manifestId).limit(501).get().catch(() => null);
  if (duplicateSnap) { const seen = new Set<string>(); for (const doc of duplicateSnap.docs) { const id = clean(doc.get("actionId")); if (seen.has(id)) unexpected.push(id); seen.add(id); } }
  return { ok: true, mode: "VERIFY", manifestId: manifest.manifestId, missing, mismatched, unexpected, verified: !missing.length && !mismatched.length && !unexpected.length, sideEffects: ZERO_SIDE_EFFECTS };
}

async function verify(ctx: Context, data: any) {
  const { manifest } = await loadManifest(ctx, clean(data?.manifestId, 80));
  if (manifest.version < 5) return verifyLegacy(ctx, data);
  const runId = clean(data?.runId, 80), [progress, verifiedTargets] = await Promise.all([loadActionProgress(runId), loadVerifiedTargets(manifest)]);
  const completed: string[] = [], pending: string[] = [], failed: string[] = [], blocked: string[] = [], review: string[] = [], noOp: string[] = [], mismatched: string[] = [];
  const skippedTerminal: string[] = [], terminalDependencyReview: string[] = [], terminalStateConflict: string[] = [], terminalGuardUnavailable: string[] = [];
  for (const action of manifest.actions) {
    if (isReviewAction(action)) { review.push(action.actionId); continue; }
    if (!isWriteAction(action)) { noOp.push(action.actionId); continue; }
    const state = progress[action.actionId];
    if (state === "FAILED") { failed.push(action.actionId); continue; }
    if (state === "SKIPPED_TERMINAL") { skippedTerminal.push(action.actionId); continue; }
    if (state === "BLOCKED_TERMINAL_DEPENDENCY") { terminalDependencyReview.push(action.actionId); continue; }
    if (state === "BLOCKED_TERMINAL_CONFLICT") { terminalStateConflict.push(action.actionId); continue; }
    if (state === "BLOCKED_TERMINAL_UNAVAILABLE") { terminalGuardUnavailable.push(action.actionId); continue; }
    if (state !== "COMPLETED" && !verifiedTargets.has(action.actionId)) {
      (actionEligibility(manifest, action, progress, verifiedTargets).eligible ? pending : blocked).push(action.actionId); continue;
    }
    const snap = await db.doc(action.targetPath).get();
    const expectedAfter = expectedAfterForProgress(manifest, action, progress, verifiedTargets);
    if (!snap.exists || snap.get("p4ActionId") !== action.actionId || snap.get("importManifestId") !== manifest.manifestId || snap.get("source") !== "IQ_IMPORT" || !targetFieldsMatch(snap, action, expectedAfter)) mismatched.push(action.actionId);
    else completed.push(action.actionId);
  }
  const actionDocs = runId ? await runs.doc(runId).collection("actions").get() : null;
  const unexpected = actionDocs ? actionDocs.docs.filter(doc => !manifest.actions.some(action => action.actionId === doc.id)).map(doc => doc.id) : [];
  return { ok: !mismatched.length && !unexpected.length, mode: "VERIFY", manifestId: manifest.manifestId, runId: runId || null,
    completed, pending, failed, blocked, review, noOp, skippedTerminal, terminalDependencyReview, terminalStateConflict, terminalGuardUnavailable, mismatched, unexpected,
    partialVerified: !mismatched.length && !unexpected.length, manifestComplete: !pending.length && !failed.length && !blocked.length && !mismatched.length,
    sideEffects: ZERO_SIDE_EFFECTS };
}

async function rollback(ctx: Context, data: any) {
  const runId = clean(data?.runId, 80), confirmation = clean(data?.confirmation, 120), runRef = runs.doc(runId), runSnap = await runRef.get();
  if (!runSnap.exists || runSnap.get("rootId") !== ctx.rootId) throw new P4EngineError("P4_RUN_NOT_FOUND", "Run no disponible.");
  if (confirmation !== `ROLLBACK:${runId}:${runSnap.get("manifestId")}`) throw new P4EngineError("P4_ROLLBACK_CONFIRMATION_REQUIRED", "Confirmación de rollback inválida.");
  const deltas = await backups.where("runId", "==", runId).orderBy(FieldPath.documentId()).get(), conflicts: string[] = [], restored: string[] = [];
  for (const delta of deltas.docs.reverse()) {
    await db.runTransaction(async tx => {
      const row = delta.data(), target = db.doc(row.targetPath), snap = await tx.get(target), current = snap.data() || {};
      const intendedChanged = Object.entries(row.intendedAfter || {}).some(([field, state]: [string, any]) =>
        state.present ? canonicalJson(current[field]) !== canonicalJson(state.value) : Object.prototype.hasOwnProperty.call(current, field));
      if (!snap.exists || current.importRunId !== runId || current.p4ActionId !== (row.expectedCurrentActionId || row.actionId) || intendedChanged) { conflicts.push(row.targetPath); return; }
      if (row.didNotExistBefore) tx.delete(target);
      else {
        const patch: Record<string, unknown> = {};
        for (const [field, state] of Object.entries(row.before || {}) as Array<[string, any]>) patch[field] = state.present ? state.value : FieldValue.delete();
        for (const field of ["source", "importRunId", "importVersion", "importManifestId", "canonicalIqProfileId", "canonicalIqGroupId", "observedThroughProfileIds", "originalIqEntityId", "financialComponentId", "p4ActionId", "importedAt", "originalIqTimestamp", "historicalEventAt", "historicalEventDate", "historicalTimeSourceField", "historicalTimeSourceTimezone", "historicalTimeSemanticType", "historicalDateAvailability"]) if (!(field in (row.before || {}))) patch[field] = FieldValue.delete();
        tx.update(target, patch);
      }
      tx.update(delta.ref, { rolledBackAt: now(), rolledBackBy: ctx.uid }); restored.push(row.targetPath);
      tx.create(audit.doc(), { mode: "ROLLBACK", runId, manifestId: row.manifestId, actionId: row.actionId, targetPath: row.targetPath, result: "ROLLED_BACK", rootId: ctx.rootId, actorUid: ctx.uid, createdAt: now() });
    });
  }
  await runRef.set({ status: conflicts.length ? "ROLLBACK_CONFLICT" : "ROLLED_BACK", rollbackConflicts: conflicts, rolledBackAt: now(), updatedAt: now() }, { merge: true });
  return { ok: !conflicts.length, mode: "ROLLBACK", runId, status: conflicts.length ? "ROLLBACK_CONFLICT" : "ROLLED_BACK", restored, conflicts, sideEffects: ZERO_SIDE_EFFECTS };
}

export const manageP4HistoricalIqImport = onCall({ region: "us-central1", timeoutSeconds: 540, memory: "1GiB", maxInstances: 1, concurrency: 1, secrets: [IQ_CREDENTIALS_KEY] }, async request => {
  try {
    const ctx = await context(request), mode = clean(request.data?.mode, 64).toUpperCase() as Mode;
    if (mode === "PLAN") return await plan(ctx, request.data);
    if (mode === "APPROVE") return await approve(ctx, request.data);
    if (mode === "PREVIEW_PHASE") return await previewPhase(ctx, request.data);
    if (mode === "PREVIEW_SCOPE") return await previewExecutionScope(ctx, request.data);
    if (mode === "APPROVE_SCOPE") return await approveExecutionScope(ctx, request.data);
    if (mode === "EXECUTE_SCOPE" || mode === "RESUME_SCOPE") return await executeExecutionScope(ctx, request.data, mode);
    if (mode === "STATUS_SCOPE") return await statusExecutionScope(ctx, request.data);
    if (mode === "VERIFY_SCOPE") return await verifyExecutionScope(ctx, request.data);
    if (mode === "ROLLBACK_SCOPE") return await rollbackExecutionScope(ctx, request.data);
    if (mode === "PREVIEW_FINANCIAL_COMPONENT_ISOLATION") return await previewFinancialComponentIsolation(ctx,request.data);
    if (mode === "ISOLATE_FINANCIAL_COMPONENT") return await isolateFinancialComponent(ctx,request.data);
    if (mode === "VERIFY_FINANCIAL_COMPONENT_ISOLATION") return await verifyFinancialComponentIsolation(ctx,request.data);
    if (mode === "PREVIEW_RECONCILE_PROVENANCE_REPAIR") return await previewReconcileProvenanceRepair(ctx,request.data);
    if (mode === "REPAIR_RECONCILE_PROVENANCE") return await repairReconcileProvenance(ctx,request.data);
    if (mode === "VERIFY_RECONCILE_PROVENANCE_REPAIR") return await verifyReconcileProvenanceRepair(ctx,request.data);
    if (mode === "EXECUTE" || mode === "RESUME") return await execute(ctx, request.data, mode);
    if (mode === "STATUS") return await status(ctx, request.data);
    if (mode === "PREVIEW_CANONICAL_RECONCILIATION") return await previewCanonicalReconciliation(ctx, request.data);
    if (mode === "PREVIEW_CANONICAL_RECONCILIATION_R1") return await previewCanonicalReconciliationR1(ctx, request.data);
    if (mode === "PREVIEW_CANONICAL_RECONCILIATION_SCOPE") return await previewCanonicalReconciliationScope(ctx, request.data);
    if (mode === "RECONCILE_CANONICAL") return await reconcileCanonical(ctx, request.data);
    if (mode === "RECONCILE_CANONICAL_SCOPE") return await reconcileCanonicalScope(ctx, request.data);
    if (mode === "VERIFY_CANONICAL_RECONCILIATION") return await verifyCanonicalReconciliation(ctx, request.data);
    if (mode === "VERIFY_CANONICAL_RECONCILIATION_SCOPE") return await verifyCanonicalReconciliationScope(ctx, request.data);
    if (mode === "ROLLBACK_CANONICAL_RECONCILIATION") return await rollbackCanonicalReconciliation(ctx, request.data);
    if (mode === "ROLLBACK_CANONICAL_RECONCILIATION_SCOPE") return await rollbackCanonicalReconciliationScope(ctx, request.data);
    if (mode === "PREVIEW_R3_OPERATIONAL_POLICY") return await previewR3OperationalPolicy(ctx);
    if (mode === "ACTIVATE_R3_OPERATIONAL_POLICY") return await activateR3OperationalPolicy(ctx,request.data);
    if (mode === "VERIFY_R3_OPERATIONAL_POLICY") return await verifyR3OperationalPolicy(ctx);
    if (mode === "ROLLBACK_R3_OPERATIONAL_POLICY") return await rollbackR3OperationalPolicy(ctx,request.data);
    if (mode === "VERIFY") return await verify(ctx, request.data);
    if (mode === "ROLLBACK") return await rollback(ctx, request.data);
    throw new P4EngineError("P4_MODE_INVALID", "Modo P4D no soportado.");
  } catch (error) { return publicError(error); }
});
