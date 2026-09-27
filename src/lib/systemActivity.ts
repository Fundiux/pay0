export type EcosystemSystem = "PAY0" | "ASSETS" | "TTT" | "HUGO" | "CANONICAL";

export const SYSTEM_ACTIVITY_COLLECTIONS: Record<EcosystemSystem, string> = {
  PAY0: "pay0ActivityLog",
  ASSETS: "assetsActivityLog",
  TTT: "tttActivityLog",
  HUGO: "hugoActivityLog",
  CANONICAL: "canonicalActivityLog",
};

export function inferLegacyActivitySystem(row: Record<string, unknown>): EcosystemSystem {
  const explicit = String(row.sourceSystem || "").trim().toUpperCase();
  if (["PAY0", "ASSETS", "TTT", "HUGO", "CANONICAL"].includes(explicit)) {
    return explicit as EcosystemSystem;
  }

  const event = String(row.event || row.type || row.eventType || "").trim().toUpperCase();
  if (event.startsWith("ASSET_")) return "ASSETS";
  if (event.startsWith("TTT_")) return "TTT";
  if (event.startsWith("AGENTE_007_") || event.startsWith("HUGO_")) return "HUGO";
  if (event.startsWith("CANONICAL_")) return "CANONICAL";
  return "PAY0";
}

export function activityEventBelongsToSystem(event: unknown, system: EcosystemSystem): boolean {
  return inferLegacyActivitySystem({ event }) === system;
}

export function belongsToSystem(row: Record<string, unknown>, system: EcosystemSystem): boolean {
  return inferLegacyActivitySystem(row) === system;
}
