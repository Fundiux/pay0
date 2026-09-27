export const ACTIVITY_SYSTEMS = ["PAY0", "ASSETS", "TTT", "HUGO", "CANONICAL"] as const;

export type ActivitySystem = (typeof ACTIVITY_SYSTEMS)[number];

const activityCollections: Record<ActivitySystem, string> = {
  PAY0: "pay0ActivityLog",
  ASSETS: "assetsActivityLog",
  TTT: "tttActivityLog",
  HUGO: "hugoActivityLog",
  CANONICAL: "canonicalActivityLog",
};

export function inferActivitySystem(event: unknown, requested?: unknown): ActivitySystem {
  const explicit = String(requested || "").trim().toUpperCase();
  if (ACTIVITY_SYSTEMS.includes(explicit as ActivitySystem)) return explicit as ActivitySystem;

  const key = String(event || "").trim().toUpperCase();
  if (key.startsWith("ASSET_")) return "ASSETS";
  if (key.startsWith("TTT_")) return "TTT";
  if (key.startsWith("AGENTE_007_") || key.startsWith("HUGO_")) return "HUGO";
  if (key.startsWith("CANONICAL_")) return "CANONICAL";
  return "PAY0";
}

export function activityCollectionForSystem(system: ActivitySystem): string {
  return activityCollections[system];
}
