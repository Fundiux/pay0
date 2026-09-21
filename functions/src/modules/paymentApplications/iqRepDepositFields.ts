export type IqRepField<T> = { present: boolean; value: T | null; type: "boolean" | "null" | "absent" | "other" };
export type IqRepDepositFields = {
  depositId: string;
  operationStatus: string;
  conciliationStatus: string;
  rep: IqRepField<boolean>;
  canRequestRep: IqRepField<boolean>;
};

function booleanField(row: Record<string, unknown>, key: "rep" | "can_request_rep?"): IqRepField<boolean> {
  if (!Object.prototype.hasOwnProperty.call(row, key)) return { present: false, value: null, type: "absent" };
  const value = row[key];
  if (value === null) return { present: true, value: null, type: "null" };
  if (typeof value === "boolean") return { present: true, value, type: "boolean" };
  return { present: true, value: null, type: "other" };
}

// IQ's observed wire key includes the question mark. No undocumented alias.
export function readIqRepDepositFields(input: unknown): IqRepDepositFields {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw Error("IQ_REP_DEPOSIT_ROW_INVALID");
  const row = input as Record<string, unknown>;
  return {
    depositId: String(row.id ?? "").trim(),
    operationStatus: typeof row.operation_status === "string" ? row.operation_status : "",
    conciliationStatus: typeof row.conciliation_status === "string" ? row.conciliation_status : "",
    rep: booleanField(row, "rep"),
    canRequestRep: booleanField(row, "can_request_rep?"),
  };
}
