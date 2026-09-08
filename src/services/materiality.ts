import { httpsCallable } from "firebase/functions";

import { CALLABLES } from "@/lib/callableNames";
import { functions } from "@/lib/firebaseClient";

export type MaterialityOperationStatus =
  | "OPEN"
  | "COMPLETE"
  | "INCOMPLETE"
  | "CANCELLED";

export type MaterialityClientCompanyFolder = {
  id: string;
  rootId?: string | null;
  clienteId?: string | null;
  clienteNombre?: string | null;
  companyId?: string | null;
  companyName?: string | null;
  status?: string | null;
  publicEnabled?: boolean | null;
  primaryContractId?: string | null;
  createdAt?: any;
  updatedAt?: any;
};

export type MaterialityOperation = {
  id: string;
  rootId?: string | null;
  clienteId?: string | null;
  clienteNombre?: string | null;
  companyId?: string | null;
  companyName?: string | null;
  materialityClientCompanyId?: string | null;
  solicitudId?: string | null;
  solicitudFolio?: string | null;
  monto?: number;
  moneda?: string | null;
  concepto?: string | null;
  solicitudStatus?: string | null;
  status?: MaterialityOperationStatus | string | null;
  contractId?: string | null;
  ordenCompraUploadId?: string | null;
  presupuestoUploadId?: string | null;
  facturaXmlUploadId?: string | null;
  facturaPdfUploadId?: string | null;
  comprobantePagoUploadId?: string | null;
  comprobantePagoSourceEntityType?: string | null;
  comprobantePagoSourcePagoId?: string | null;
  evidenciaUploadIds?: string[];
  requiredTypes?: string[];
  completedTypes?: string[];
  missingTypes?: string[];
  missingTypeLabels?: string[];
  publicTokenId?: string | null;
  createdAt?: any;
  updatedAt?: any;
};

export type MaterialityContract = {
  id: string;
  rootId?: string | null;
  clienteId?: string | null;
  companyId?: string | null;
  materialityClientCompanyId?: string | null;
  uploadId?: string | null;
  storagePath?: string | null;
  documentType?: string | null;
  status?: string | null;
  version?: number | null;
  sha256?: string | null;
  integritySealVersion?: string | null;
  integritySealStatus?: string | null;
  validFrom?: any;
  validTo?: any;
  signedAt?: any;
  createdAt?: any;
  updatedAt?: any;
};

export type MaterialityDashboardFolder = {
  id: string;
  materialityClientCompanyId: string;
  rootId?: string | null;
  clienteId?: string | null;
  clienteNombre?: string | null;
  companyId?: string | null;
  companyName?: string | null;
  status?: "INCOMPLETE" | "COMPLETE" | "NO_OPERATIONS" | string;
  alertLevel?: "HIGH" | "LOW" | "OK" | string;
  alertCount?: number;
  operationCount?: number;
  activeOperationCount?: number;
  incompleteOperationCount?: number;
  completeOperationCount?: number;
  cancelledOperationCount?: number;
  totalAmount?: number;
  missingTypes?: string[];
  missingTypeLabels?: string[];
  latestOperationAt?: any;
  updatedAt?: any;
  primaryContractId?: string | null;
  hasPrimaryContract?: boolean;
  operations?: MaterialityOperation[];
};

export type MaterialityDashboardStats = {
  folderCount: number;
  operationCount: number;
  activeOperationCount: number;
  incompleteFolderCount: number;
  completeFolderCount: number;
  noOperationFolderCount: number;
  alertCount: number;
  totalAmount: number;
};

export type GetMaterialityDashboardInput = {
  status?: "ALL" | "INCOMPLETE" | "COMPLETE" | "NO_OPERATIONS" | "ALERTS" | string;
  search?: string;
  limit?: number;
};

export type GetMaterialityDashboardResult = {
  ok: boolean;
  generatedAt?: any;
  stats: MaterialityDashboardStats;
  folders: MaterialityDashboardFolder[];
  alerts: MaterialityDashboardFolder[];
};

export type EnsureMaterialityClientCompanyInput = {
  clienteId: string;
  companyId: string;
};

export type EnsureMaterialityClientCompanyResult = {
  ok: boolean;
  materialityClientCompanyId: string;
  clienteId: string;
  clienteNombre?: string | null;
  companyId: string;
  companyName?: string | null;
};

export type LinkSolicitudToMaterialityOperationInput = {
  solicitudId: string;
};

export type LinkSolicitudToMaterialityOperationResult = {
  ok: boolean;
  materialityOperationId: string;
  materialityClientCompanyId: string;
  status: MaterialityOperationStatus | string;
  completedTypes: string[];
  missingTypes: string[];
};

export type GetMaterialityOperationInput = {
  materialityOperationId?: string;
  solicitudId?: string;
};

export type GetMaterialityOperationResult = {
  ok: boolean;
  exists: boolean;
  operation: MaterialityOperation | null;
};

export type GetMaterialityClientCompanyOverviewInput = {
  materialityClientCompanyId?: string;
  folderId?: string;
  id?: string;
  clienteId?: string;
  clientId?: string;
  companyId?: string;
};

export type MaterialityClientCompanyOverviewSummary = {
  operationCount?: number;
  activeOperationCount?: number;
  contractCount?: number;
  totalAmount?: number;
  requiredTypes?: string[];
  completedTypes?: string[];
  missingTypes?: string[];
  missingTypeLabels?: string[];
  status?: string;
  updatedAt?: any;
};

export type GetMaterialityClientCompanyOverviewResult = {
  ok: boolean;
  exists: boolean;
  materialityClientCompanyId: string;
  folder: MaterialityClientCompanyFolder | null;
  operations: MaterialityOperation[];
  contracts: MaterialityContract[];
  summary?: MaterialityClientCompanyOverviewSummary;
};

export async function ensureMaterialityClientCompany(
  input: EnsureMaterialityClientCompanyInput
): Promise<EnsureMaterialityClientCompanyResult> {
  const callable = httpsCallable<
    EnsureMaterialityClientCompanyInput,
    EnsureMaterialityClientCompanyResult
  >(functions, CALLABLES.ensureMaterialityClientCompany);

  const response = await callable(input);
  return response.data;
}

export async function linkSolicitudToMaterialityOperation(
  input: LinkSolicitudToMaterialityOperationInput
): Promise<LinkSolicitudToMaterialityOperationResult> {
  const callable = httpsCallable<
    LinkSolicitudToMaterialityOperationInput,
    LinkSolicitudToMaterialityOperationResult
  >(functions, CALLABLES.linkSolicitudToMaterialityOperation);

  const response = await callable(input);
  return response.data;
}

export async function getMaterialityOperation(
  input: GetMaterialityOperationInput
): Promise<GetMaterialityOperationResult> {
  const callable = httpsCallable<
    GetMaterialityOperationInput,
    GetMaterialityOperationResult
  >(functions, CALLABLES.getMaterialityOperation);

  const response = await callable(input);
  return response.data;
}

export async function getMaterialityClientCompanyOverview(
  input: GetMaterialityClientCompanyOverviewInput
): Promise<GetMaterialityClientCompanyOverviewResult> {
  const callable = httpsCallable<
    GetMaterialityClientCompanyOverviewInput,
    GetMaterialityClientCompanyOverviewResult
  >(functions, CALLABLES.getMaterialityClientCompanyOverview);

  const response = await callable(input);
  return response.data;
}

export async function getMaterialityDashboard(
  input: GetMaterialityDashboardInput = {}
): Promise<GetMaterialityDashboardResult> {
  const callable = httpsCallable<
    GetMaterialityDashboardInput,
    GetMaterialityDashboardResult
  >(functions, CALLABLES.getMaterialityDashboard);

  const response = await callable(input);
  return response.data;
}

export const readMaterialityOperation = getMaterialityOperation;
export const readMaterialityClientCompanyOverview = getMaterialityClientCompanyOverview;
export const readMaterialityDashboard = getMaterialityDashboard;