import { HUGO_CAPABILITIES } from "./hugoCore/runtimeContract";

const systems = [
  { id: "PAY0", module: "dashboard" },
  { id: "ASSETS", module: "assets" },
  { id: "HUGO", module: "hugo" },
  { id: "TTT", module: "ttt" },
] as const;

export const HUGO_SYSTEM_CATALOG = systems.map(system => ({ ...system,
  status: HUGO_CAPABILITIES.some(capability => capability.system === system.id && ["AVAILABLE", "GATED"].includes(capability.status)) ? "CONNECTED" as const : "NOT_CONNECTED" as const,
}));

export function publicHugoSystemCatalog() {
  return HUGO_SYSTEM_CATALOG.map(({ id, status }) => ({ id, status }));
}
