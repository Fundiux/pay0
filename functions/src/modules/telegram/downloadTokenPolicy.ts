export const DOWNLOAD_LEASE_MS = 70_000;
export const DOWNLOAD_STREAM_MS = 55_000;
export const DOWNLOAD_MAX_ATTEMPTS = 3;
export const DOWNLOAD_APP_ORIGIN = "https://pay-0-system.web.app";
export const DOWNLOAD_PAGE_PATH = "/descarga/documento";
export const DOWNLOAD_LEGACY_WINDOW_MS = 60 * 60_000;
type DownloadIssuance = { transportVersion: 1 | 2; expiresAt: number; legacyBridgeStartedAt?: number; legacyBridgeDeadline?: number };
/** Server configuration only. A fixed UTC window cannot extend itself on cold starts. */
export function downloadIssuance(env: Record<string, string | undefined>, now: number, ttlMinutes: number): DownloadIssuance {
  downloadTtlMinutes(ttlMinutes);
  const mode = env.TELEGRAM_DOWNLOAD_TRANSPORT_MODE || "POST_FRAGMENT";
  if (mode === "POST_FRAGMENT") return { transportVersion: 2, expiresAt: now + ttlMinutes * 60_000 };
  if (mode !== "LEGACY_BRIDGE") throw new DownloadTokenError(503);
  const parse = (value: string | undefined) => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return NaN;
    const millis = Date.parse(value);
    return Number.isFinite(millis) && new Date(millis).toISOString() === value ? millis : NaN;
  };
  const start = parse(env.TELEGRAM_DOWNLOAD_LEGACY_STARTED_AT);
  const deadline = parse(env.TELEGRAM_DOWNLOAD_LEGACY_DEADLINE);
  if (!Number.isFinite(start) || !Number.isFinite(deadline) || deadline <= start ||
      deadline - start > DOWNLOAD_LEGACY_WINDOW_MS || now < start || now >= deadline) throw new DownloadTokenError(503);
  return { transportVersion: 1, expiresAt: Math.min(now + ttlMinutes * 60_000, deadline),
    legacyBridgeStartedAt: start, legacyBridgeDeadline: deadline };
}
export function downloadTokenFromRequest(method: string, query: any, body: any): string {
  const value = method === "POST" ? body?.token : query?.token;
  if (method === "POST" && (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).some(key => key !== "token") || Object.keys(query || {}).length)) throw new DownloadTokenError(400);
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value)) throw new DownloadTokenError(400);
  return value;
}
export function assertDownloadTransport(row: any, method: string, now: number): void {
  if (method === "POST") return;
  // v2 never uses GET. Only explicitly bounded bridge issuance may opt into v1.
  if (row?.transportVersion === 1) {
    const start = timestampMillis(row.legacyBridgeStartedAt);
    const deadline = timestampMillis(row.legacyBridgeDeadline);
    const issued = timestampMillis(row.createdAt);
    if (start <= 0 || deadline <= start || deadline - start > DOWNLOAD_LEGACY_WINDOW_MS ||
        issued < start || issued >= deadline || now >= deadline || timestampMillis(row.expiresAt) > deadline) throw new DownloadTokenError(410);
  } else if (row?.transportVersion !== undefined) throw new DownloadTokenError(410);
  const createdAt = timestampMillis(row?.createdAt);
  const expiresAt = timestampMillis(row?.expiresAt);
  if (createdAt <= 0 || createdAt > now ||
      expiresAt <= createdAt || expiresAt - createdAt > 900000 || now - createdAt >= 900000) throw new DownloadTokenError(410);
}
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
