export interface AdvanceLiquidationPlan {
  advanceId: string;
  amountToApply: number;
}

export interface AdvanceAutoLiquidationResult {
  appliedAmount: number;
  remainingDepositAmount: number;
  updatedAdvanceIds: string[];
}
