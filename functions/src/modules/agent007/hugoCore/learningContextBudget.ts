import { LearningExperience } from "./learningContract";

export const HUGO_CONTEXT_CHAR_LIMIT = 10_000;
export const HUGO_OUTPUT_TOKEN_RESERVE = 1_200;
export function compactLearningExperience(row: LearningExperience) {
  return { id: row.experienceId, scope: { rootId: row.rootId, domain: row.domain, taskType: row.taskType, entityType: row.entityReferences[0]?.entityType || null },
    situation: row.features, expectedBehavior: row.expectedBehavior,
    correction: row.correction ? { originalBehavior: row.correction.originalBehavior, correctedBehavior: row.correction.correctedBehavior, reasonCode: row.correction.reasonCode } : null,
    outcome: row.outcome ? { type: row.outcome.type, verified: row.outcome.verified, occurredAt: row.outcome.occurredAt } : null,
    quality: row.quality, historical: true };
}

export type HugoBudgetReport = { limitChars: number; outputReserveTokens: number; totalChars: number; approximateInputTokens: number;
  currentFactsChars: number; memoryChars: number; experienceChars: number; historyDropped: number; memoriesDropped: number; experiencesDropped: number; exceeded: boolean };
export function applyHugoContextBudget(context: any, limitChars = HUGO_CONTEXT_CHAR_LIMIT): HugoBudgetReport {
  let historyDropped = 0, memoriesDropped = 0, experiencesDropped = 0;
  const size = () => JSON.stringify(context).length;
  while (size() > limitChars && context.observacionesHistoricasNoVerificadas?.length) { context.observacionesHistoricasNoVerificadas.pop(); historyDropped++; }
  while (size() > limitChars && context.memoriasHistoricas?.length) { context.memoriasHistoricas.pop(); memoriesDropped++; }
  while (size() > limitChars && context.learningExperiences?.length) { context.learningExperiences.pop(); experiencesDropped++; }
  const totalChars = size();
  return { limitChars, outputReserveTokens: HUGO_OUTPUT_TOKEN_RESERVE, totalChars, approximateInputTokens: Math.ceil(totalChars / 4),
    currentFactsChars: JSON.stringify({ solicitudes: context.solicitudes || [], pagos: context.pagos || [], evidenceBoundaries: context.evidenceBoundaries || {}, activeEntity: context.activeEntity || null }).length,
    memoryChars: JSON.stringify(context.memoriasHistoricas || []).length, experienceChars: JSON.stringify(context.learningExperiences || []).length,
    historyDropped, memoriesDropped, experiencesDropped, exceeded: totalChars > limitChars };
}
