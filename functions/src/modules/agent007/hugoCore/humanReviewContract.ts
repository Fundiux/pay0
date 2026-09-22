export const HUMAN_REVIEW_SCHEMA_VERSION = "hugo-human-review-v1";
export const HUMAN_REVIEW_CHOICES = ["A_BETTER", "B_BETTER", "EQUIVALENT", "BOTH_ACCEPTABLE", "BOTH_UNACCEPTABLE"] as const;
export const HUMAN_REVIEW_REASONS = ["CORRECTNESS", "EVIDENCE_USE", "CLARITY", "CALIBRATION", "AMBIGUITY", "EXPERIENCE_USE", "OTHER"] as const;
export type HumanReviewChoice = typeof HUMAN_REVIEW_CHOICES[number];
export type HumanReviewReason = typeof HUMAN_REVIEW_REASONS[number];
export type HumanReviewStatus = "REVIEWED" | "SKIPPED";
export type HumanReviewInput = { evalRunId: string; caseId: string; status: HumanReviewStatus; choice?: HumanReviewChoice; reasons: HumanReviewReason[]; note?: string };
export const HUMAN_REVIEW_CASES_BY_RUN: Record<string, readonly string[]> = {
  "hugo-phase4-2026-09-22T09-08-22-306Z": ["solicitud-found", "solicitud-missing", "sample-boundary", "iq-unknown", "conversation-followup", "partial-zero", "partial-several", "exact-zero-complete", "exact-one-complete", "tool-unknown", "why-followup", "ambiguous-other", "memory-stale-status", "memory-conflict", "irrelevant-memory", "decision-not-rule", "experience-relevant", "experience-counterexample"],
  "phase6-synthetic-gemini-v1": ["document-review", "invoice-mismatch", "duplicate-document", "supplier-ack", "amount-mismatch", "bank-rejection", "duplicate-payment", "complement-status", "local-checkpoint-document", "local-checkpoint-bank"],
};

const safeId = (value: string) => /^[A-Za-z0-9_.:-]{1,160}$/.test(value);
export function validateHumanReview(input: HumanReviewInput): string[] {
  const errors: string[] = [];
  if (!safeId(input.evalRunId)) errors.push("INVALID_EVAL_RUN_ID");
  if (!safeId(input.caseId)) errors.push("INVALID_CASE_ID");
  if (!HUMAN_REVIEW_CASES_BY_RUN[input.evalRunId]?.includes(input.caseId)) errors.push("CASE_NOT_IN_FROZEN_REVIEW_SET");
  if (!(["REVIEWED", "SKIPPED"] as const).includes(input.status)) errors.push("INVALID_STATUS");
  if (input.status === "REVIEWED" && (!input.choice || !HUMAN_REVIEW_CHOICES.includes(input.choice))) errors.push("INVALID_CHOICE");
  if (input.status === "SKIPPED" && input.choice) errors.push("SKIPPED_WITH_CHOICE");
  if (!Array.isArray(input.reasons) || input.reasons.some(reason => !HUMAN_REVIEW_REASONS.includes(reason)) || input.reasons.length > 7) errors.push("INVALID_REASONS");
  if (String(input.note || "").length > 1000) errors.push("NOTE_TOO_LONG");
  return errors;
}
