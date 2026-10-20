import { LearningExperience, trainingEligibility } from "./learningContract";

export function internalTrainingAuthorization(record: LearningExperience): { approved: boolean; reason: string } {
  // Eligibility is derived from the current revision, not a persisted approval.
  // Invalidation, protected splits and supersession must revoke stale grants.
  if (!record.trainingEligibility.eligible || !trainingEligibility(record).eligible) return { approved: false, reason: "QUALITY_INELIGIBLE" };
  if (record.governance?.use !== "TRAINING_ELIGIBLE_INTERNAL" || !record.governance.reviewedBy || !record.governance.reviewedAt)
    return { approved: false, reason: "HUMAN_GOVERNANCE_REVIEW_REQUIRED" };
  return { approved: true, reason: "INTERNAL_ONLY" };
}
export function externalProviderAuthorization(record: LearningExperience): { approved: boolean; reason: string } {
  const internal = internalTrainingAuthorization(record);
  if (!internal.approved) return internal;
  if (record.governance?.externalProvider !== "APPROVED") return { approved: false, reason: "EXTERNAL_PROVIDER_NOT_APPROVED" };
  return { approved: true, reason: "EXTERNAL_REVIEWED" };
}
