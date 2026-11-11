import { normalizeClientWhatsapp } from "../clients/domain";

// Pure rules for the per-user directory of customer-service numbers. Numbers only, never names.
export const MAX_OPERATOR_NUMBERS = 20;

export type NormalizedOperatorNumbers = { numbers: string[]; invalid: number; duplicates: number };

export function normalizeOperatorNumbers(input: unknown): NormalizedOperatorNumbers {
  const raw = Array.isArray(input) ? input : [];
  const seen = new Set<string>();
  let invalid = 0, duplicates = 0;
  for (const value of raw) {
    const number = normalizeClientWhatsapp(value);
    if (!/^52\d{10}$/.test(number)) { invalid++; continue; }
    if (seen.has(number)) { duplicates++; continue; }
    seen.add(number);
  }
  return { numbers: [...seen], invalid, duplicates };
}

// A number can belong to one user only, otherwise Hugo could not tell whose operator wrote.
export function countNumberConflicts(numbers: string[], others: { userUid: string; numbers: string[] }[], selfUid: string): number {
  const taken = new Set(others.filter(row => row.userUid !== selfUid).flatMap(row => row.numbers));
  return numbers.filter(number => taken.has(number)).length;
}

// Who wrote in a group: a registered operator of a user, or anybody else (a client).
export function classifyGroupSender(rawSender: unknown, directory: { userUid: string; numbers: string[] }[]): { kind: "OPERATOR"; userUid: string } | { kind: "CLIENT" } {
  const sender = normalizeClientWhatsapp(String(rawSender ?? "").split("@")[0]);
  const owner = sender ? directory.find(row => row.numbers.includes(sender)) : undefined;
  return owner ? { kind: "OPERATOR", userUid: owner.userUid } : { kind: "CLIENT" };
}
