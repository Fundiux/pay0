import { HttpsError } from "firebase-functions/v2/https";

// Revalidate the destination immediately before preparing an external operation.
// A locally valid reservation does not authorize a subsequently changed account.
export function assertDispersionDestination(input: {
  rootId: string; clientId: string; beneficiaryId: string; dispersionId: string;
  client: Record<string, any>; beneficiary: Record<string, any>; method: Record<string, any>;
  legs: Record<string, any>[];
}) {
  const { rootId, clientId, beneficiaryId, dispersionId, client, beneficiary, method, legs } = input;
  const clientOf = (row: any) => String(row.clientId || row.clienteId || "");
  if ([client, beneficiary, method].some(row => row.rootId !== rootId)) {
    throw new HttpsError("permission-denied", "Cliente o destino de dispersión fuera de alcance.");
  }
  if ([client, beneficiary, method].some(row => row.active === false || row.isDeleted === true)) {
    throw new HttpsError("failed-precondition", "Cliente, beneficiario o cuenta inactivos. No se enviará la dispersión.");
  }
  if (clientOf(beneficiary) !== clientId || clientOf(method) !== clientId || String(method.beneficiaryId || method.beneficiarioId || "") !== beneficiaryId) {
    throw new HttpsError("failed-precondition", "El destino ya no corresponde al cliente y beneficiario de la reserva.");
  }
  if (legs.some(row => row.rootId !== rootId || row.principalDispersionId !== dispersionId || clientOf(row) !== clientId)) {
    throw new HttpsError("permission-denied", "Los tramos de la dispersión no pertenecen a esta operación.");
  }
}
