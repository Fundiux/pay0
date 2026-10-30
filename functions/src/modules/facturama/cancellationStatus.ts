export function isConfirmedFacturamaCancellation(value: unknown): boolean {
  return String(value ?? "").trim().toUpperCase() === "CANCELED";
}
