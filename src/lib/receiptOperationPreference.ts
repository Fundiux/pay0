export function receiptOperationPreferenceKey(rootId: string, uid: string): string {
  return rootId && uid ? `pay0:receipt-operation:v1:${encodeURIComponent(rootId)}:${encodeURIComponent(uid)}` : "";
}

/** A local convenience only. The receipt server validates this key on every request. */
export function receiptOperationChoices(rows: any[], rootId: string): Array<{ key: string; name: string }> {
  if (!rootId) return [];
  const eligible = rows.filter(row => row?.active !== false && String(row?.category || "OPERACION").toUpperCase() === "OPERACION" &&
    (!row.rootId || row.rootId === rootId)).map(row => ({ key: String(row.key || row.id || ""), name: String(row.name || row.key || "Operación sin nombre") })).filter(row => row.key);
  return eligible.filter(row => eligible.filter(other => other.key === row.key).length === 1);
}

export function validReceiptOperationPreference(value: unknown, choices: Array<{ key: string }>): string {
  return typeof value === "string" && choices.some(row => row.key === value) ? value : "";
}

export type ReceiptActorContext = { scope: string; uid: string; epoch: number };
export function assertReceiptActorContext(expected: ReceiptActorContext | undefined, current: ReceiptActorContext, authenticatedUid: string | undefined): void {
  if (!expected || !expected.scope || !expected.uid || expected.scope !== current.scope || expected.uid !== current.uid || expected.epoch !== current.epoch || authenticatedUid !== expected.uid)
    throw new Error("La sesión cambió. Vuelve a cargar el comprobante en la sesión actual.");
}
