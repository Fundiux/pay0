export interface OperationTypeDoc {
  key: string;
  name: string;
  active: boolean;
  calculationBaseType: "TOTAL" | "SUBTOTAL";
  requiresConciliation: boolean;
  generatesClientBalance: boolean;
  generatesUserEarnings: boolean;
  allowsDispersion: boolean;
  allowsReturn: boolean;
  pricingMode: "PERCENT" | "FIXED";
  notes?: string | null;
  createdBy: string;
  actorUsername: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface DespachoOperationCostDoc {
  rootId: string;
  despachoId: string;
  operationTypeKey: string;
  operationTypeName: string;
  calculationBaseType: "TOTAL" | "SUBTOTAL";
  pricingMode: "PERCENT" | "FIXED";
  active: boolean;
  baseCost: number;
  notes?: string | null;
  createdBy: string;
  actorUsername: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface UserOperationCostDoc {
  rootId: string;
  userId: string;
  costId: string;
  despachoId?: string | null;
  inheritedFromUserId?: string | null;
  inheritedFromType?: "user" | "despacho";
  sourceDespachoId?: string | null;
  operationTypeKey: string;
  operationTypeName: string;
  calculationBaseType: "TOTAL" | "SUBTOTAL";
  pricingMode: "PERCENT" | "FIXED";
  active: boolean;
  baseInheritedCost: number;
  assignedCost: number;
  notes?: string | null;
  createdBy: string;
  actorUsername: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ClientOperationCostDoc {
  rootId: string;
  clientId: string;
  costId: string;
  despachoId?: string | null;
  inheritedFromUserId?: string | null;
  inheritedFromType?: "user" | "despacho";
  sourceDespachoId?: string | null;
  operationTypeKey: string;
  operationTypeName: string;
  calculationBaseType: "TOTAL" | "SUBTOTAL";
  pricingMode: "PERCENT" | "FIXED";
  active: boolean;
  baseInheritedCost: number;
  assignedCost: number;
  notes?: string | null;
  createdBy: string;
  actorUsername: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}
