import type { AssetPosition } from "@/services/assets";

export const money = (minor = 0) => (minor / 100).toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 2 });
export const assetKindLabel = (kind: string) => kind === "VEHICLE" ? "Vehículo" : kind === "LOAN" ? "Préstamo" : "Posición";
export const assetStatusLabel = (status: string, kind?: string) => status === "ACTIVE" ? "Activo" : status === "LIQUIDATED" ? "Vendido" : status === "PAID" ? "Pagado" : status === "CANCELLED" ? "Cancelado" : status === "CLOSED" ? "Cerrado" : "En revisión";
export const isTerminalAssetPosition = (position: Pick<AssetPosition, "kind" | "status">) =>
  position.kind === "VEHICLE"
    ? ["LIQUIDATED", "CANCELLED"].includes(position.status)
    : ["PAID", "CANCELLED"].includes(position.status);
export const movementLabel = (type: string) => ({
  VEHICLE_INVESTMENT: "Inversión en vehículo",
  VEHICLE_PRINCIPAL_RETURN: "Capital recuperado",
  VEHICLE_PROFIT: "Utilidad",
  LOAN_ORIGINATED: "Préstamo otorgado",
  INTEREST_ACCRUED: "Interés generado",
  INTEREST_CAPITALIZED: "Interés capitalizado",
  INTEREST_PAYMENT: "Interés cobrado",
  PRINCIPAL_PAYMENT: "Abono a capital",
}[type] || "Movimiento");
export const sourceLabel = (source: string) => ({ MANUAL: "Registro manual", PAY0: "PAY0", CASH: "Efectivo", EXTERNAL_TRANSFER: "Transferencia externa", DOCUMENT_IMPORT: "Documento", OTHER: "Otro" }[source] || "Otro");
export const displayPositionName = (position: AssetPosition) => {
  if (position.counterpartyName !== "U-PRO") return position.name;
  return ({ Duster: "Duster Intens TM 2025", Kwid: "Kwid Iconic TM 2025", Arkana: "Arkana Esprit Alpine 2025" } as Record<string, string>)[position.name] || position.name;
};
export const displayCounterpartyName = (position: AssetPosition) => {
  const metadata = position.metadata || {};
  const named = String(metadata.businessPartnerName || metadata.platformName || "").trim();
  if (named) return named;
  if (position.kind === "VEHICLE" && /highlander|duster zen/i.test(position.name)) return "U-PRO";
  return position.counterpartyName || (position.kind === "VEHICLE" ? "U-PRO" : "Sin contraparte");
};
export const interestLabel = (position: AssetPosition) => position.kind === "LOAN" && Number(position.rateBasisPoints || 0) > 0 ? `${(Number(position.rateBasisPoints) / 100).toLocaleString("es-MX")}% mensual` : position.kind === "LOAN" ? "Sin interés" : "U-PRO";
export const movementIsInflow = (type: string) => ["VEHICLE_PRINCIPAL_RETURN", "VEHICLE_PROFIT", "INTEREST_PAYMENT", "PRINCIPAL_PAYMENT"].includes(type);
export const dateLabel = (value: string) => {
  if (!value) return "Sin fecha";
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
};
