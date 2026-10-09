import type { ObservationResult } from "./publisher";

export type DenialProfile = { uid: string; exists: boolean; rootId: unknown };
type DenialPort = { authorizationDenied(context: unknown): Promise<ObservationResult> };
const identifier = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);

/** This rollout cannot be enabled with an environment flag. Logging labels and
 * push OIDC do not authenticate the original producer. Real activation requires
 * additional producer authentication (or reviewed equivalent evidence), exact
 * deployed revision/cohort, a finite window, quotas and rollback review.
 * No profile lookup, financial write, restriction writer or client report port. */
const disabledPort: DenialPort = { authorizationDenied: async () => "DISABLED" };

export function createObservedAuthorization(port: DenialPort = disabledPort, budgetMs = 1000) {
  if (!Number.isSafeInteger(budgetMs) || budgetMs < 1 || budgetMs > 1000) throw Error("INVALID_OBSERVATION_BUDGET");
  return async function authorize<T>(decide: () => T, profile: DenialProfile): Promise<T> {
    try { return decide(); }
    catch (denial: unknown) {
      // Only a denial from the exact guarded decision is observed. No catch-all
      // logging of subsequent query/provider errors or browser route reports.
      if ((denial as { code?: unknown })?.code === "permission-denied" && profile.exists &&
          identifier(profile.uid) && identifier(profile.rootId)) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            Promise.resolve().then(() => port.authorizationDenied({ actorUid: profile.uid, rootId: profile.rootId })),
            new Promise<void>(resolve => { timer = setTimeout(resolve, budgetMs); }),
          ]);
        } catch { /* Observation never changes the original denial. */ }
        finally { if (timer) clearTimeout(timer); }
      }
      throw denial;
    }
  };
}

// Shared synchronous authGuard remains unchanged; only listUsers opts into this
// async boundary. Default port performs zero I/O, even with hostile env values.
export const authorizeListUsersObserved = createObservedAuthorization();
