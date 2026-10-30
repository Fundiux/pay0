import { createHash } from "crypto";

export type IqReceiptFetch = (url: URL, init: RequestInit) => Promise<Response>;
export type IqReceiptResult =
  | { status: "NOT_AVAILABLE" }
  | { status: "AVAILABLE"; bytes: Buffer; contentType: string; filename: string; sha256: string };

const MAX_BYTES = 1024 * 1024;

function allowedFileUrl(url: URL, iqOrigin: URL): boolean {
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  if (url.origin === iqOrigin.origin) return true;
  if (host === "storage.googleapis.com" || host.endsWith(".storage.googleapis.com")) return true;
  if (/^(?:[a-z0-9-]+\.)?s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/.test(host)) return true;
  if (host.endsWith(".blob.vercel-storage.com")) return true;
  if (host.endsWith(".cloudinary.com")) return true;
  return false;
}

async function readBounded(response: Response): Promise<Buffer> {
  const statedSize = Number(response.headers.get("content-length") || 0);
  if (statedSize > MAX_BYTES) throw new Error("IQ_RECEIPT_TOO_LARGE");
  if (!response.body) throw new Error("IQ_RECEIPT_EMPTY");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) throw new Error("IQ_RECEIPT_TOO_LARGE");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  if (total === 0) throw new Error("IQ_RECEIPT_EMPTY");
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
}

function identifyFile(bytes: Buffer): { contentType: string; extension: string } {
  if (bytes.subarray(0, 5).toString("ascii") === "%PDF-") return { contentType: "application/pdf", extension: "pdf" };
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { contentType: "image/png", extension: "png" };
  if (bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return { contentType: "image/jpeg", extension: "jpg" };
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return { contentType: "image/webp", extension: "webp" };
  throw new Error("IQ_RECEIPT_FILE_TYPE_UNSUPPORTED");
}

export async function fetchIqDispersionReceipt(input: {
  apiOrigin: string;
  username: string;
  password: string;
  folio: string;
  fetcher: IqReceiptFetch;
}): Promise<IqReceiptResult> {
  if (!/^[1-9][0-9]{0,15}$/.test(input.folio)) throw new Error("IQ_RECEIPT_FOLIO_INVALID");
  const origin = new URL(input.apiOrigin);
  if (origin.protocol !== "https:" || origin.username || origin.password) throw new Error("IQ_RECEIPT_ORIGIN_INVALID");
  const login = await input.fetcher(new URL("/users/sessions", origin), {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ user: { username: input.username, password: input.password } }),
  });
  if (login.status !== 201) throw new Error("IQ_RECEIPT_AUTH_FAILED");
  const loginJson = await login.json() as { access_token?: unknown };
  const token = String(loginJson.access_token || "").trim();
  if (!token) throw new Error("IQ_RECEIPT_AUTH_FAILED");

  const lookup = await input.fetcher(new URL(`/dispersions/voucher/${input.folio}`, origin), {
    method: "GET",
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    redirect: "manual",
  });
  if (lookup.status === 404 || lookup.status === 204) return { status: "NOT_AVAILABLE" };
  if (!lookup.ok) throw new Error(`IQ_RECEIPT_LOOKUP_HTTP_${lookup.status}`);
  const payload = await lookup.json() as { url?: unknown };
  const rawUrl = typeof payload.url === "string" ? payload.url.trim() : "";
  if (!rawUrl) return { status: "NOT_AVAILABLE" };
  const fileUrl = new URL(rawUrl, origin);
  if (!allowedFileUrl(fileUrl, origin)) throw new Error("IQ_RECEIPT_HOST_UNVERIFIED");

  let current = fileUrl;
  let response: Response | null = null;
  for (let redirects = 0; redirects <= 2; redirects++) {
    response = await input.fetcher(current, {
      method: "GET",
      headers: current.origin === origin.origin ? { Authorization: `Bearer ${token}` } : {},
      redirect: "manual",
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get("location");
    if (!location) throw new Error("IQ_RECEIPT_REDIRECT_INVALID");
    const next = new URL(location, current);
    if (!allowedFileUrl(next, origin)) throw new Error("IQ_RECEIPT_HOST_UNVERIFIED");
    current = next;
  }
  if (!response?.ok) throw new Error(`IQ_RECEIPT_DOWNLOAD_HTTP_${response?.status || 0}`);
  const bytes = await readBounded(response);
  const identified = identifyFile(bytes);
  return {
    status: "AVAILABLE",
    bytes,
    contentType: identified.contentType,
    filename: `IQ-${input.folio}.${identified.extension}`,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
