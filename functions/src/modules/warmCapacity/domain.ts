/**
 * Warm-capacity window: decides which Cloud Run services should keep one warm instance
 * and which should scale to zero. Pure; the Run Admin API calls live in service.ts.
 */

export type WarmService = { name: string; kind: "function" | "appHosting" };

export type WarmCapacityConfig = {
  version: number;
  project: string;
  region: string;
  timeZone: string;
  windowStart: string;
  windowEnd: string;
  warmMinInstances: number;
  coldMinInstances: number;
  services: WarmService[];
};

/** Mirror of config/warm-capacity.json (checked by qa/scripts/warm-capacity.test.cjs). */
export const WARM_CAPACITY_CONFIG: WarmCapacityConfig = {
  version: 1,
  project: "pay-0-system",
  region: "us-central1",
  timeZone: "America/Mexico_City",
  windowStart: "08:45",
  windowEnd: "21:00",
  warmMinInstances: 1,
  coldMinInstances: 0,
  // Functions managed by Cloud Functions reject service-level scaling (fixed revision name, 409), so the hot
  // callables keep minInstances: 1 in code; only App Hosting follows this window.
  services: [
    { name: "pay0-next16", kind: "appHosting" },
  ],
};

/** Cloud Run service id: gen2 functions are lowercase, App Hosting keeps its backend id. */
export function runServiceId(service: WarmService): string {
  return service.kind === "function" ? service.name.toLowerCase() : service.name;
}

const minutesOf = (hhmm: string): number => {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!match) throw new Error("WARM_CAPACITY_TIME_INVALID");
  return Number(match[1]) * 60 + Number(match[2]);
};

export function localMinutes(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value) % 24;
  return hour * 60 + Number(parts.find((part) => part.type === "minute")?.value);
}

/** Warm from windowStart (inclusive) until windowEnd (exclusive), every day. */
export function desiredMinInstances(now: Date, config: WarmCapacityConfig): number {
  const minutes = localMinutes(now, config.timeZone);
  const inWindow = minutes >= minutesOf(config.windowStart) && minutes < minutesOf(config.windowEnd);
  return inWindow ? config.warmMinInstances : config.coldMinInstances;
}

export type ServiceState = { service: WarmService; current: number | null; error?: string };

/** Only services whose value drifted need a PATCH; unreadable ones are reported, never guessed. */
export function planScalingChanges(states: ServiceState[], desired: number) {
  return {
    patch: states.filter((state) => state.current !== null && !state.error && state.current !== desired),
    unchanged: states.filter((state) => !state.error && state.current === desired),
    unreadable: states.filter((state) => state.current === null || state.error),
  };
}
