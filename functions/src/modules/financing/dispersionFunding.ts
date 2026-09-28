import { HttpsError } from "firebase-functions/v2/https";
import type { Pay0Role } from "../shared/domain";

/** Additional ownership boundary for personal earnings; legacy CLIENT authorization stays at each caller. */
export function assertDispersionFundingOwner(input: { rootId: string; uid: string; role: string; dispersion: any }) {
  const source = input.dispersion?.fundingSource;
  if (source?.holderType !== "USER") return;
  const clientId = String(input.dispersion.clientId || input.dispersion.clienteId || "").trim();
  if (!clientId || String(input.dispersion.rootId || "") !== input.rootId || source.sourceClientId !== clientId || !source.ownerUid || input.dispersion.ownerUid !== source.ownerUid || (input.role !== "superadmin" && source.ownerUid !== input.uid)) {
    throw new HttpsError("permission-denied", "Retiro de utilidad fuera del alcance del titular.");
  }
}

export type DispersionFundingSource = { holderType: "CLIENT" } | { holderType: "USER"; ownerUid: string; sourceClientId: string; holderName: string; holderRole: Pay0Role; commissionDistributionId: string; commissionLegId: string };
export function resolveDispersionFunding(clientId: string, source?: DispersionFundingSource) {
  if (!source || source.holderType === "CLIENT") return { holderType: "CLIENT" as const, holderId: clientId, sourceClientId: null, holderName: "", holderRole: null, snapshot: { holderType: "CLIENT" } as DispersionFundingSource };
  if (source.holderType !== "USER" || !source.ownerUid || source.ownerUid.includes("/") || source.sourceClientId !== clientId || !source.commissionDistributionId || !source.commissionLegId || !["superadmin", "admin", "operador"].includes(source.holderRole)) throw new HttpsError("failed-precondition", "Origen de utilidad inválido para la dispersión.");
  return { holderType: "USER" as const, holderId: source.ownerUid, sourceClientId: clientId, holderName: source.holderName || source.ownerUid, holderRole: source.holderRole, snapshot: source };
}

export function assertUserDispersionCanRelease(principal: any, legs: any[]) {
  if (principal.fundingSource?.holderType !== "USER") return;
  const uncertain = (row: any) => row.iqFolio || row.iqId || row.iqOperationId || row.iqDispersionId || row.iqDispersionFolio || row.postAccepted || row.iqPostAccepted || row.iqCreationPostAccepted || row.iqCreationRetryBlocked || row.retryBlocked || [row.commissionExecutionStatus, row.iqCreationStatus, row.iqGenerationStatus, row.iqStatus, row.status].some(value => ["PREPARING", "PROCESSING", "CREATING", "CREATED", "CREATED_PENDING_FOLIO", "IQ_CREATED", "IQ_GENERADA", "IQ_REQUIERE_REVISION", "CONFIRMED", "COMPLETED", "OUTCOME_UNKNOWN", "UNCERTAIN"].includes(String(value || "").toUpperCase()));
  if (uncertain(principal) || legs.some(uncertain)) throw new HttpsError("failed-precondition", "Una dispersión enviada, en proceso o incierta requiere conciliación; su utilidad no puede liberarse automáticamente.");
}
