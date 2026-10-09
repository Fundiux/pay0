type UiTimer = ReturnType<typeof setTimeout> | number;
export type MyRestrictionStatus = {
  state: "NONE" | "ACTIVE" | "EXPIRED" | "REVOKED" | "INVALID";
  restricted: boolean;
  expiresAtMs: number | null;
  recovery: "CONTACT_SUPPORT";
};
export type RestrictionUiState = { phase: "CHECKING" | "CLEAR" | "RESTRICTED" | "ERROR" };
export function hasTrustedRestriction(profile: unknown): boolean {
  return !!profile && typeof profile === "object" && Object.prototype.hasOwnProperty.call(profile, "trustedRestrictionV1");
}
export function parseMyRestrictionStatus(value: unknown): MyRestrictionStatus {
  const row = value as MyRestrictionStatus;
  if (!row || !["NONE", "ACTIVE", "EXPIRED", "REVOKED", "INVALID"].includes(row.state) ||
      row.recovery !== "CONTACT_SUPPORT" || typeof row.restricted !== "boolean" ||
      row.restricted !== ["ACTIVE", "INVALID"].includes(row.state) ||
      (["NONE", "INVALID"].includes(row.state) ? row.expiresAtMs !== null :
        !Number.isSafeInteger(row.expiresAtMs) || Number(row.expiresAtMs) < 0 || Number(row.expiresAtMs) > 253402300799999)) {
    throw new Error("Estado de acceso no disponible.");
  }
  return row;
}
/** A timer only asks the server again; local expiry never authorizes a user. */
export function createRestrictionSession(input: {
  query: () => Promise<unknown>;
  changed: (state: RestrictionUiState) => void;
  now?: () => number;
  schedule?: (callback: () => void, delay: number) => UiTimer;
  cancel?: (timer: UiTimer) => void;
}) {
  const now = input.now || Date.now, schedule = input.schedule || setTimeout, cancel = input.cancel || clearTimeout;
  let disposed = false, generation = 0;
  let timer: UiTimer | undefined;
  const stopTimer = () => { if (timer !== undefined) cancel(timer); timer = undefined; };
  async function refresh() {
    if (disposed) return;
    stopTimer();
    const attempt = ++generation;
    input.changed({ phase: "CHECKING" });
    timer = schedule(() => {
      if (!disposed && attempt === generation) { generation++; input.changed({ phase: "ERROR" }); }
    }, 15_000);
    try {
      const result = parseMyRestrictionStatus(await input.query());
      if (disposed || attempt !== generation) return;
      stopTimer();
      input.changed({ phase: result.restricted ? "RESTRICTED" : "CLEAR" });
      if (result.state === "ACTIVE") timer = schedule(() => { void refresh(); },
        Math.max(1000, Math.min(60_000, Number(result.expiresAtMs) - now())));
    } catch {
      if (disposed || attempt !== generation) return;
      stopTimer(); input.changed({ phase: "ERROR" });
    }
  }
  return { refresh, dispose: () => { disposed = true; generation++; stopTimer(); } };
}
