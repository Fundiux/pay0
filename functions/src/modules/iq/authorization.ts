import { assertAuthorized } from "../../utils/authGuard";
import { getMyUser, requireAuth } from "../sharedCallables/helpers";

type IqAuthorizationRequirement = {
  allowedRoles?: Array<"superadmin" | "admin" | "operador">;
  requiredModule?: string;
  requiredAction?: string;
};

export async function assertIqAuthorized(
  request: any,
  requirement: IqAuthorizationRequirement,
): Promise<Record<string, unknown>> {
  const uid = requireAuth(request);
  const profile = await getMyUser(uid);
  assertAuthorized(request.auth, profile, requirement);
  return profile as Record<string, unknown>;
}
