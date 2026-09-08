import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebaseClient";

export interface DiagnosePagoFinancialContextInput {
  pagoId: string;
  operationTypeKey: string;
}

export async function diagnosePagoFinancialContext(
  input: DiagnosePagoFinancialContextInput
) {
  const callable = httpsCallable<
    DiagnosePagoFinancialContextInput,
    any
  >(functions, "diagnosePagoFinancialContext");

  const result = await callable(input);
  return result.data;
}

export interface PreparePagoFinancialPostingInput {
  pagoId: string;
  operationTypeKey: string;
  postNow?: boolean;
}

export async function preparePagoFinancialPosting(
  input: PreparePagoFinancialPostingInput
) {
  const callable = httpsCallable<
    PreparePagoFinancialPostingInput,
    any
  >(functions, "preparePagoFinancialPosting");

  const result = await callable(input);
  return result.data;
}