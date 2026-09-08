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
    ...input,
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
    referrer: typeof document !== "undefined" ? document.referrer : "",
    locationHref: typeof window !== "undefined" ? window.location.href : "",
  });

  return res?.data;
}

export async function redeemMySecurityUnlockCode(code: string) {
  const fn = httpsCallable(functions, "redeemMySecurityUnlockCode");
  const res: any = await fn({ code });
  return res?.data;
}
