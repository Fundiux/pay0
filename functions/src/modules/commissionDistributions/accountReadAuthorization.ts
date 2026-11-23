/**
 * Authorization boundary for reading personal commission accounts.
 * The caller identity MUST be established by Firebase Auth and server-side user document.
 * Never trust a rootId or role supplied in the request body.
 */
export type CommissionAccountPrincipal = {
  uid: string;
  rootId: string;
  role: "superadmin" | "admin" | "operador";
  active: boolean;
};
export type CommissionAccountOwner = {
  uid: string;
  rootId: string;
  active: boolean;
};
export function authorizeCommissionAccountRead(
  principal: CommissionAccountPrincipal,
  owner: CommissionAccountOwner,
  purpose: "SELF_PROFILE" | "CLIENT_COSTS",
) {
  if (!principal.uid || !principal.rootId || !owner.uid || !owner.rootId || !principal.active || !owner.active) {
    throw new Error("Usuario inactivo o identidad incompleta.");
  }
  if (principal.rootId !== owner.rootId) throw new Error("Organización no autorizada.");
  if (purpose === "SELF_PROFILE") {
    if (principal.uid !== owner.uid) throw new Error("Solo el titular puede consultar su perfil bancario.");
  } else if (purpose === "CLIENT_COSTS") {
    if (principal.uid !== owner.uid && principal.role !== "superadmin") {
      throw new Error("No tienes autorización para consultar cuentas de este participante.");
    }
  } else {
    throw new Error("Propósito de consulta inválido.");
  }
  return { rootId: owner.rootId, ownerUid: owner.uid };
}
