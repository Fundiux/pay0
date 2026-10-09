import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebaseClient";

export type UnauthorizedRouteAttemptInput = {
  path: string;
  matchedRuleHref?: string | null;
  requiredModule?: string | null;
  requiredAction?: string | null;
  superadminOnly?: boolean;
};

export async function reportUnauthorizedRouteAttempt(input: UnauthorizedRouteAttemptInput) {
  const fn = httpsCallable(functions, "logUnauthorizedRouteAttempt");

  const res: any = await fn({
    path: input.path,
    matchedRuleHref: input.matchedRuleHref ?? null,
    requiredModule: input.requiredModule ?? null,
    requiredAction: input.requiredAction ?? null,
    superadminOnly: input.superadminOnly === true,
  });

  return res?.data;
}

export async function redeemMySecurityUnlockCode(code: string) {
  const fn = httpsCallable(functions, "redeemMySecurityUnlockCode");
  const res: any = await fn({ code });
  return res?.data;
}

// Own state only. This callable never issues/revokes restrictions or returns a bypass token.
export async function getMyRestrictionStatus() {
  const fn = httpsCallable(functions, "getMyRestrictionStatus");
  const result = await fn({});
  return result.data;
}
