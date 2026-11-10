import { normalizeClientRfc, requiresUniqueClientRfc } from "./domain";

const clean = (value: unknown) => String(value ?? "").trim();

// A duplicate that was merged keeps its document and its history. Only its new operations are redirected:
// nothing already posted is moved, reversed or re-posted.
export const mergedIntoOf = (client: unknown): string => clean((client as Record<string, unknown> | null | undefined)?.mergedInto);
export const isMergedClient = (client: unknown): boolean => mergedIntoOf(client) !== "";

// Permissions that start or change an operation. Viewing history stays allowed on a merged duplicate.
export const NEW_OPERATION_PERMISSIONS = new Set(["operate", "operateSolicitudes", "operatePagos", "operateBeneficiarios", "operateDispersiones"]);
export const mergedClientBlocksPermission = (client: unknown, permission: string) => isMergedClient(client) && NEW_OPERATION_PERMISSIONS.has(permission);

export const mergedClientMessage = (client: unknown) => `Este cliente fue fusionado en ${mergedIntoOf(client)}. Las operaciones nuevas se hacen en el cliente vigente; su historial se conserva.`;

export type MergeRefusal =
  | "SAME_CLIENT" | "CANONICAL_MISSING" | "DUPLICATE_MISSING" | "OUT_OF_ROOT" | "RFC_MISSING" | "RFC_DIFFERENT"
  | "DUPLICATE_ALREADY_MERGED" | "CANONICAL_IS_MERGED" | "CANONICAL_INACTIVE";

export type MergePlan = { ok: true; rootId: string; rfc: string } | { ok: false; refusal: MergeRefusal };

// Both clients must be in the caller's root with the same unique RFC. A merge is one hop: a client that was
// already merged cannot become canonical, so no chain or cycle can form.
export function planClientMerge(input: { rootId: string; canonicalId: string; duplicateId: string; canonical: Record<string, any> | null; duplicate: Record<string, any> | null }): MergePlan {
  const rootId = clean(input.rootId);
  if (!input.canonicalId || !input.duplicateId || input.canonicalId === input.duplicateId) return { ok: false, refusal: "SAME_CLIENT" };
  if (!input.canonical) return { ok: false, refusal: "CANONICAL_MISSING" };
  if (!input.duplicate) return { ok: false, refusal: "DUPLICATE_MISSING" };
  if (clean(input.canonical.rootId) !== rootId || clean(input.duplicate.rootId) !== rootId) return { ok: false, refusal: "OUT_OF_ROOT" };
  const rfc = normalizeClientRfc(input.canonical.rfc);
  if (!requiresUniqueClientRfc(rfc)) return { ok: false, refusal: "RFC_MISSING" };
  if (normalizeClientRfc(input.duplicate.rfc) !== rfc) return { ok: false, refusal: "RFC_DIFFERENT" };
  if (isMergedClient(input.duplicate)) return { ok: false, refusal: "DUPLICATE_ALREADY_MERGED" };
  if (isMergedClient(input.canonical)) return { ok: false, refusal: "CANONICAL_IS_MERGED" };
  if (input.canonical.active === false) return { ok: false, refusal: "CANONICAL_INACTIVE" };
  return { ok: true, rootId, rfc };
}

export const MERGE_REFUSAL_MESSAGES: Record<MergeRefusal, string> = {
  SAME_CLIENT: "El cliente vigente y el duplicado deben ser distintos.",
  CANONICAL_MISSING: "El cliente vigente no existe.",
  DUPLICATE_MISSING: "El cliente duplicado no existe.",
  OUT_OF_ROOT: "Los dos clientes deben pertenecer a tu root.",
  RFC_MISSING: "Solo se fusionan clientes con un RFC único.",
  RFC_DIFFERENT: "Los dos clientes deben tener el mismo RFC.",
  DUPLICATE_ALREADY_MERGED: "El duplicado ya está fusionado.",
  CANONICAL_IS_MERGED: "El cliente vigente ya está fusionado en otro cliente.",
  CANONICAL_INACTIVE: "El cliente vigente está inactivo.",
};

// Resolves the client a new operation must use. A single hop, by construction of planClientMerge.
export const resolveCanonicalClientId = (clientId: string, client: unknown): string => mergedIntoOf(client) || clean(clientId);
