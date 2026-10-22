import type { P4Action, P4EntityType, P4Manifest } from "./domain";

export type P4CanaryPhase = "CLIENT" | "SOLICITUD" | "PAYMENT" | "APPLICATION";
export type P4ActionProgressStatus = "PENDING" | "ATTEMPTING" | "COMPLETED" | "FAILED" | "BLOCKED" | "SKIP_PURGED" |
  "SKIPPED_TERMINAL" | "BLOCKED_TERMINAL_DEPENDENCY" | "BLOCKED_TERMINAL_CONFLICT" | "BLOCKED_TERMINAL_UNAVAILABLE" | "FINANCIAL_RECONCILIATION_REVIEW";
export type P4ActionProgress = Record<string, P4ActionProgressStatus>;

export const P4_WRITE_OPERATIONS = new Set(["RECONCILE", "CREATE_HISTORICAL", "DEPENDENCY_IMPORT"]);
export const P4_REVIEW_OPERATIONS = new Set(["CANONICAL_DEPENDENCY_PENDING", "REVIEW_REQUIRED", "CLIENT_REVIEW_REQUIRED", "FINANCIAL_RECONCILIATION_REVIEW", "HISTORICAL_DATE_REVIEW_REQUIRED", "SKIP_PURGED"]);
export const P4_PROTECTED_REVIEW_IQ_IDS = new Set(["7565", "186637", "225628", "162839", "162841", "162842"]);

export function isWriteAction(action: P4Action): boolean {
  return P4_WRITE_OPERATIONS.has(action.operation);
}

export function isReviewAction(action: P4Action): boolean {
  return P4_REVIEW_OPERATIONS.has(action.operation) || P4_PROTECTED_REVIEW_IQ_IDS.has(action.iqEntityId);
}

function dependencySatisfied(manifest: P4Manifest, dependencyId: string, progress: P4ActionProgress, verifiedTargets: Set<string>): boolean {
  const dependency = manifest.actions.find(action => action.actionId === dependencyId);
  if (!dependency || isReviewAction(dependency)) return false;
  if (["NO_OP", "EXISTING"].includes(dependency.operation)) return true;
  return progress[dependencyId] === "COMPLETED" || verifiedTargets.has(dependencyId);
}

export function actionEligibility(manifest: P4Manifest, action: P4Action, progress: P4ActionProgress, verifiedTargets = new Set<string>()) {
  if (isReviewAction(action)) return { eligible: false, reason: "REVIEW_EXCLUDED" } as const;
  if (!isWriteAction(action)) return { eligible: false, reason: "NON_WRITING_ACTION" } as const;
  if (progress[action.actionId] === "COMPLETED" || verifiedTargets.has(action.actionId)) return { eligible: false, reason: "ALREADY_COMPLETED" } as const;
  if (progress[action.actionId] === "ATTEMPTING") return { eligible: false, reason: "ATTEMPT_IN_PROGRESS" } as const;
  if (progress[action.actionId] === "SKIPPED_TERMINAL") return { eligible: false, reason: "TERMINAL_SKIPPED" } as const;
  if (progress[action.actionId] === "FINANCIAL_RECONCILIATION_REVIEW") return { eligible: false, reason: "FINANCIAL_COMPONENT_REVIEW" } as const;
  if (["BLOCKED_TERMINAL_DEPENDENCY", "BLOCKED_TERMINAL_CONFLICT", "BLOCKED_TERMINAL_UNAVAILABLE"].includes(progress[action.actionId] || ""))
    return { eligible: false, reason: "TERMINAL_REVIEW" } as const;
  const blocked = (action.dependencies || []).filter(id => !dependencySatisfied(manifest, id, progress, verifiedTargets));
  return blocked.length ? { eligible: false, reason: "DEPENDENCY_BLOCKED", blockedDependencies: blocked } as const : { eligible: true, reason: "ELIGIBLE", blockedDependencies: [] } as const;
}

function actionByType(manifest: P4Manifest, ids: string[], type: P4EntityType): P4Action | undefined {
  return ids.map(id => manifest.actions.find(action => action.actionId === id)).find(action => action?.entityType === type);
}

export type P4FinancialCanaryChain = {
  componentId: string;
  solicitud: P4Action;
  payment: P4Action;
  application: P4Action;
  clientActionIds: string[];
  score: number;
};

export function financialCanaryChains(manifest: P4Manifest): P4FinancialCanaryChain[] {
  const components = new Map<string, P4Action[]>();
  for (const action of manifest.actions.filter(row => row.componentId)) {
    const rows = components.get(action.componentId!) || [];
    rows.push(action); components.set(action.componentId!, rows);
  }
  const chains: P4FinancialCanaryChain[] = [];
  for (const [componentId, actions] of components) {
    const applications = actions.filter(action => action.entityType === "APPLICATION" && isWriteAction(action));
    if (applications.length !== 1) continue;
    const application = applications[0];
    const solicitud = actionByType(manifest, application.dependencies || [], "SOLICITUD");
    const payment = actionByType(manifest, application.dependencies || [], "PAYMENT");
    if (!solicitud || !payment || !isWriteAction(solicitud) || !isWriteAction(payment)) continue;
    if ([solicitud, payment, application].some(isReviewAction)) continue;
    const clientIds = [...new Set([...solicitud.dependencies || [], ...payment.dependencies || [], ...application.dependencies || []]
      .filter(id => manifest.actions.find(action => action.actionId === id)?.entityType === "CLIENT"))];
    const clientPenalty = clientIds.reduce((sum, id) => {
      const action = manifest.actions.find(row => row.actionId === id);
      return sum + (action?.operation === "NO_OP" || action?.operation === "EXISTING" ? 0 : 100);
    }, 0);
    const componentSize = actions.filter(action => action.entityType !== "CLIENT").length;
    const operationPenalty = [solicitud, payment].filter(action => action.operation === "DEPENDENCY_IMPORT").length * 5;
    chains.push({ componentId, solicitud, payment, application, clientActionIds: clientIds, score: clientPenalty + componentSize + operationPenalty });
  }
  return chains.sort((left, right) => left.score - right.score || left.componentId.localeCompare(right.componentId));
}

export function selectCanaryAction(input: {
  manifest: P4Manifest;
  phase: P4CanaryPhase;
  progress: P4ActionProgress;
  verifiedTargets?: Set<string>;
  preferredComponentId?: string;
}) {
  const { manifest, phase, progress } = input;
  const verifiedTargets = input.verifiedTargets || new Set<string>();
  let candidates: P4Action[];
  let componentId = "";
  if (phase === "CLIENT") {
    candidates = manifest.actions.filter(action => action.entityType === "CLIENT" && action.operation === "CREATE_HISTORICAL");
  } else {
    const chains = financialCanaryChains(manifest);
    const chain = (input.preferredComponentId ? chains.find(row => row.componentId === input.preferredComponentId) : undefined) || chains[0];
    if (!chain) return { selected: null, eligible: [], blocked: [], componentId: "", reason: "NO_SAFE_FINANCIAL_CHAIN" };
    componentId = chain.componentId;
    candidates = [phase === "SOLICITUD" ? chain.solicitud : phase === "PAYMENT" ? chain.payment : chain.application];
  }
  const evaluated = candidates.map(action => ({ action, eligibility: actionEligibility(manifest, action, progress, verifiedTargets) }));
  const dependentCount = (action: P4Action) => manifest.actions.filter(candidate => (candidate.dependencies || []).includes(action.actionId)).length;
  const eligible = evaluated.filter(row => row.eligibility.eligible).map(row => row.action).sort((a, b) =>
    phase === "CLIENT" ? dependentCount(a) - dependentCount(b) || a.actionId.localeCompare(b.actionId) : a.actionId.localeCompare(b.actionId));
  const blocked = evaluated.filter(row => !row.eligibility.eligible).map(row => ({ actionId: row.action.actionId, reason: row.eligibility.reason, blockedDependencies: "blockedDependencies" in row.eligibility ? row.eligibility.blockedDependencies : [] }));
  return { selected: eligible[0] || null, eligible, blocked, componentId, reason: eligible.length ? "SELECTED" : "NO_ELIGIBLE_ACTION" };
}

export function simulateCanarySequence(manifest: P4Manifest, initial: P4ActionProgress = {}, verifiedTargets = new Set<string>()) {
  const progress = { ...initial };
  const client = selectCanaryAction({ manifest, phase: "CLIENT", progress, verifiedTargets });
  if (client.selected) progress[client.selected.actionId] = "COMPLETED";
  const solicitud = selectCanaryAction({ manifest, phase: "SOLICITUD", progress, verifiedTargets });
  if (solicitud.selected) progress[solicitud.selected.actionId] = "COMPLETED";
  const payment = selectCanaryAction({ manifest, phase: "PAYMENT", progress, verifiedTargets, preferredComponentId: solicitud.componentId });
  if (payment.selected) progress[payment.selected.actionId] = "COMPLETED";
  const application = selectCanaryAction({ manifest, phase: "APPLICATION", progress, verifiedTargets, preferredComponentId: solicitud.componentId });
  if (application.selected) progress[application.selected.actionId] = "COMPLETED";
  return { client, solicitud, payment, application, progress };
}

export function summarizeActionProgress(manifest: P4Manifest, progress: P4ActionProgress, verifiedTargets = new Set<string>()) {
  const summary = { completed: 0, pending: 0, failed: 0, blocked: 0, review: 0, noOp: 0, skippedTerminal: 0, terminalDependencyReview: 0, terminalStateConflict: 0, terminalGuardUnavailable: 0 };
  for (const action of manifest.actions) {
    if (isReviewAction(action)) { summary.review++; continue; }
    if (!isWriteAction(action)) { summary.noOp++; continue; }
    if (progress[action.actionId] === "COMPLETED" || verifiedTargets.has(action.actionId)) summary.completed++;
    else if (progress[action.actionId] === "FAILED") summary.failed++;
    else if (progress[action.actionId] === "SKIPPED_TERMINAL") summary.skippedTerminal++;
    else if (progress[action.actionId] === "BLOCKED_TERMINAL_DEPENDENCY") { summary.terminalDependencyReview++; summary.review++; }
    else if (progress[action.actionId] === "BLOCKED_TERMINAL_CONFLICT") { summary.terminalStateConflict++; summary.review++; }
    else if (progress[action.actionId] === "BLOCKED_TERMINAL_UNAVAILABLE") { summary.terminalGuardUnavailable++; summary.review++; }
    else if (actionEligibility(manifest, action, progress, verifiedTargets).eligible) summary.pending++;
    else summary.blocked++;
  }
  return summary;
}
