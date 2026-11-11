// A dispersion that stops before IQ because the beneficiary or the account is not there gets its own
// reason, so a person (and later the daily summary) sees why instead of a generic pre-POST failure.
export const IQ_BENEFICIARY_MISSING_CODE = "BENEFICIARY_OR_ACCOUNT_MISSING_IN_IQ";
export const IQ_BENEFICIARY_MISSING_MESSAGE = "El beneficiario o la cuenta no existen en IQ.";

const MISSING = new Set(["IQ_BENEFICIARY_NOT_FOUND", "IQ_BENEFICIARY_ACCOUNT_NOT_FOUND"]);

export function dispersionFailureReason(errors: readonly unknown[]): { code: string; message: string } | null {
  return errors.some(error => MISSING.has(String(error ?? "").trim())) ? { code: IQ_BENEFICIARY_MISSING_CODE, message: IQ_BENEFICIARY_MISSING_MESSAGE } : null;
}

// Picks the row IQ returned with the id PAY0 stored for this account; zero or several rows mean "no hint".
export function selectStoredIqBeneficiary<T>(rows: readonly T[], storedBeneficiaryId: string | undefined, idOf: (row: T) => unknown): T | null {
  if (!storedBeneficiaryId) return null;
  const hits = rows.filter(row => String(idOf(row) ?? "") === storedBeneficiaryId);
  return hits.length === 1 ? hits[0] : null;
}
