/**
 * Pure, side-effect-free calculator for client-specific commission payout instructions.
 * This does not authorize a transfer or replace the legacy financial engine.
 * Rates are integer basis points: 20 = 0.20 points or 0.20% of earnings.
 */
export type ClientCommissionInstruction = {
  accountId: string;
  pointsBps?: number | null;
  earningsPercentBps?: number | null;
};
export type ClientCommissionCalculationInput = {
  earnedMinor: number;
  operationBaseMinor: number | null;
  contractRateBps: number | null;
  instructions: ClientCommissionInstruction[];
};
export type CalculatedClientCommissionInstruction = ClientCommissionInstruction & { amountMinor: number };
type CalculatedRowWithResidue = CalculatedClientCommissionInstruction & { residue: bigint };

function safeNonnegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${field} debe ser entero no negativo.`);
  return Number(value);
}
function exactMinor(value: number, rateBps: number) {
  const numerator = BigInt(value) * BigInt(rateBps);
  return { floor: Number(numerator / BigInt(10000)), residue: numerator % BigInt(10000) };
}
export function calculateClientCommissionInstructions(input: ClientCommissionCalculationInput) {
  const earnedMinor = safeNonnegativeInteger(input.earnedMinor, "earnedMinor");
  if (!Array.isArray(input.instructions) || input.instructions.length > 50) throw new Error("Se admiten hasta 50 instrucciones.");
  const accounts = new Set<string>();
  const rows: CalculatedRowWithResidue[] = input.instructions.map((row, index) => {
    const accountId = String(row.accountId || "").trim();
    if (!accountId) throw new Error(`Instrucción ${index + 1}: selecciona una cuenta.`);
    const points = row.pointsBps != null;
    const percent = row.earningsPercentBps != null;
    if (points === percent) throw new Error("Cada fila debe utilizar Puntos o % de comisión, no ambos.");
    const rate = safeNonnegativeInteger(points ? row.pointsBps : row.earningsPercentBps, "Tasa");
    if (rate <= 0 || rate > 10000) throw new Error("La tasa debe ser mayor que cero y no exceder 100%.");
    if (points) {
      if (input.operationBaseMinor == null || input.contractRateBps == null) throw new Error("No hay base contractual comparable para calcular puntos.");
      safeNonnegativeInteger(input.operationBaseMinor, "operationBaseMinor");
      const contractRate = safeNonnegativeInteger(input.contractRateBps, "contractRateBps");
      if (contractRate <= 0 || rate > contractRate) throw new Error("Los puntos exceden la tasa contractual.");
    }
    // Same account may have one row in each modality; duplicate same-modality rows are rejected.
    const key = `${accountId}:${points ? "points" : "earnings"}`;
    if (accounts.has(key)) throw new Error("Cuenta y modalidad duplicadas.");
    accounts.add(key);
    const exact = exactMinor(points ? input.operationBaseMinor! : earnedMinor, rate);
    return { accountId, ...(points ? { pointsBps: rate } : { earningsPercentBps: rate }), amountMinor: exact.floor, residue: exact.residue };
  });
  const pointsTotal = rows.reduce((sum, row) => sum + (row.pointsBps || 0), 0);
  if (pointsTotal > 0 && (input.contractRateBps == null || pointsTotal > input.contractRateBps)) throw new Error("La suma de puntos supera la tasa contractual.");
  const exactTotal = rows.reduce((sum, row) => sum + BigInt(row.amountMinor) * BigInt(10000) + row.residue, 0n);
  const target = Number((exactTotal + BigInt(5000)) / BigInt(10000));
  if (!Number.isSafeInteger(target) || target > earnedMinor) throw new Error("La distribución supera la comisión ganada.");
  let remainingCents = target - rows.reduce((sum, row) => sum + row.amountMinor, 0);
  const ranked = rows.map((row, index) => ({ index, residue: row.residue })).sort((a, b) => a.residue === b.residue ? a.index - b.index : a.residue > b.residue ? -1 : 1);
  for (const row of ranked) { if (remainingCents <= 0) break; rows[row.index].amountMinor += 1; remainingCents -= 1; }
  const instructions = rows.map(({ residue, ...row }) => row);
  return { earnedMinor, distributedMinor: target, remainingMinor: earnedMinor - target, instructions };
}
