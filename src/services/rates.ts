import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebaseClient";

export interface CreateOperationTypeInput {
  key: string;
  name: string;
  category?: "OPERACION" | "DISPERSION";
  calculationBaseType: "TOTAL" | "SUBTOTAL";
  pricingMode?: "PERCENT" | "FIXED";
  active?: boolean;
  requiresConciliation?: boolean;
  generatesClientBalance?: boolean;
  generatesUserEarnings?: boolean;
  allowsDispersion?: boolean;
  allowsReturn?: boolean;
  notes?: string;
}

export interface SetDespachoOperationCostInput {
  despachoId?: string;
  operationTypeKey: string;
  baseCost: number;
  active?: boolean;
  notes?: string;
}

export interface SetUserOperationCostInput {
  userId: string;
  despachoId?: string;
  operationTypeKey: string;
  assignedCost: number;
  calculationBaseType?: "TOTAL" | "SUBTOTAL";
  active?: boolean;
  notes?: string;
}

export async function createOperationType(input: CreateOperationTypeInput) {
  const callable = httpsCallable<CreateOperationTypeInput, any>(functions, "createOperationType");
  const result = await callable(input);
  return result.data;
}

export async function setDespachoOperationCost(input: SetDespachoOperationCostInput) {
  const callable = httpsCallable<SetDespachoOperationCostInput, any>(functions, "setDespachoOperationCost");
  const result = await callable(input);
  return result.data;
}

export async function setUserOperationCost(input: SetUserOperationCostInput) {
  const callable = httpsCallable<SetUserOperationCostInput, any>(functions, "setUserOperationCost");
  const result = await callable(input);
  return result.data;
}
export interface SetClientOperationCostInput {
  clientId: string;
  despachoId: string;
  operationTypeKey: string;
  assignedCost: number;
  active?: boolean;
  notes?: string;
  calculationBaseType?: "TOTAL" | "SUBTOTAL";
}

export async function setClientOperationCost(input: SetClientOperationCostInput) {
  const callable = httpsCallable<SetClientOperationCostInput, any>(
    functions,
    "setClientOperationCost"
  );
  const result = await callable(input);
  return result.data;
}
