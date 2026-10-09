export const DOWNLOAD_LEASE_MS = 70_000;
export const DOWNLOAD_STREAM_MS = 55_000;
export const DOWNLOAD_MAX_ATTEMPTS = 3;
export class DownloadTokenError extends Error {
  constructor(public readonly status: number) { super("Descarga no disponible."); }
}
export function downloadTtlMinutes(value: unknown): number {
  if (value === undefined) return 15;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1 || value > 15) throw new DownloadTokenError(400);
  return value;
}
export function timestampMillis(value: any): number {
  const n = value && typeof value.toMillis === "function" ? value.toMillis() : 0;
  return Number.isFinite(n) ? n : 0;
}
export function assertDownloadAvailable(row: any, now: number): void {
  if (!row || row.status !== "ACTIVE" || row.revokedAt || row.actionType !== "DOWNLOAD_DOCUMENT") throw new DownloadTokenError(403);
  if (timestampMillis(row.expiresAt) <= now) throw new DownloadTokenError(410);
  if (!/^\d+$/.test(String(row.storageGeneration || ""))) throw new DownloadTokenError(403);
  if (timestampMillis(row.leaseUntil) > now) throw new DownloadTokenError(409);
  if (!Number.isInteger(row.attempts ?? 0) || (row.attempts ?? 0) < 0 || (row.attempts ?? 0) >= DOWNLOAD_MAX_ATTEMPTS) throw new DownloadTokenError(410);
}
export function ownsDownloadEntity(uid: string, rootId: string, role: string, entity: any): boolean {
  if (!entity || entity.rootId !== rootId || entity.isDeleted || entity.deletedAt || entity.status === "ELIMINADA") return false;
  return role === "superadmin" || (role === "admin" && entity.adminId === uid) || (role === "operador" && entity.createdBy === uid);
}
