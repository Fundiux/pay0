import { createHash } from "crypto";
import { downloadIqFile, identifyFile, type IqReceiptFetch } from "../dispersionDocuments/iqReceiptHttp";

export type IqCancellationReceiptResult =
  | { status: "NOT_AVAILABLE" }
  | { status: "AVAILABLE"; bytes: Buffer; contentType: string; extension: string; sha256: string };

const NO_RECEIPT = /no tiene comprobante de cancelaci/i;

function identifyReceipt(bytes: Buffer): { contentType: string; extension: string } {
  if (/^\s*<\?xml/.test(bytes.subarray(0, 64).toString("utf8"))) return { contentType: "application/xml", extension: "xml" };
  return identifyFile(bytes);
}

// Only GET: a PATCH on this same IQ path cancels the invoice.
export async function fetchIqCancellationReceipt(input: {
  apiOrigin: string;
  accessToken: string;
  iqFolio: string;
  fetcher: IqReceiptFetch;
}): Promise<IqCancellationReceiptResult> {
  if (!/^[1-9][0-9]{0,15}$/.test(input.iqFolio)) throw new Error("IQ_ACUSE_FOLIO_INVALID");
  const origin = new URL(input.apiOrigin);
  const lookup = await input.fetcher(new URL(`/invoices/cancellation/${input.iqFolio}`, origin), {
    method: "GET",
    headers: { Accept: "application/json", Authorization: `Bearer ${input.accessToken}` },
    redirect: "manual",
  });
  if (lookup.status === 404 || lookup.status === 204) return { status: "NOT_AVAILABLE" };
  if (lookup.status === 400 && NO_RECEIPT.test(await lookup.text())) return { status: "NOT_AVAILABLE" };
  if (!lookup.ok) throw new Error(`IQ_ACUSE_LOOKUP_HTTP_${lookup.status}`);
  const payload = await lookup.json() as { url?: unknown };
  const rawUrl = typeof payload.url === "string" ? payload.url.trim() : "";
  if (!rawUrl) return { status: "NOT_AVAILABLE" };
  const bytes = await downloadIqFile({ rawUrl, origin, token: input.accessToken, fetcher: input.fetcher });
  return { status: "AVAILABLE", bytes, ...identifyReceipt(bytes), sha256: createHash("sha256").update(bytes).digest("hex") };
}
