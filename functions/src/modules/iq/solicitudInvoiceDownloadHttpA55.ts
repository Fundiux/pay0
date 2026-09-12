import {
  loginIqHttpDirect,
} from "./iqHttpAuth";
import { fetchIq } from "./iqHttpClient";

const DEFAULT_IQ_API_ORIGIN =
  "https://iq-produccion-ccc570f75402.herokuapp.com";

const MAX_HTTP_INVOICE_BYTES = 25 * 1024 * 1024;

export type IqInvoiceZipDownloadHttpInput = {
  erpUrl: string;
  apiOrigin?: string;
  username: string;
  password: string;
  marker: string;
  solicitudId?: string;
  iqFolio?: string;
  maxPages?: number;
  waitAfterClickMs?: number;
};

export type IqInvoiceZipDownloadHttpResult = {
  authenticated: boolean;
  finalPath: string;
  found: boolean;
  clicked: boolean;
  downloaded: boolean;
  fileName: string;
  contentType: string;
  bufferBase64: string;
  rowText: string;
  invoiceActionText: string;
  pagesInspected: number;
  errors: string[];
  transport: "HTTP_DIRECT";
  invoiceMetadataUrl?: string;
  downloadUrlResolved?: boolean;
};

function clean(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function apiOrigin(): string {
  return clean(process.env.PAY0_IQ_API_ORIGIN) || DEFAULT_IQ_API_ORIGIN;
}

function safePath(value: string): string {
  try {
    const url = new URL(value);
    return `${url.pathname}${url.search}`;
  } catch {
    return "/";
  }
}

function fileNameFromHeadersOrUrl(
  response: Response,
  fallbackUrl: string,
  iqFolio: string,
): string {
  const disposition = response.headers.get("content-disposition") || "";
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);

  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]).replace(/[\\/:*?"<>|]+/g,"_");
    } catch {
      return utf8Match[1].replace(/[\\/:*?"<>|]+/g,"_");
    }
  }

  const plainMatch = disposition.match(/filename="?([^";]+)"?/i);
  if (plainMatch?.[1]) {
    return plainMatch[1].replace(/[\\/:*?"<>|]+/g,"_");
  }

  try {
    const pathname = new URL(response.url || fallbackUrl).pathname;
    const last = decodeURIComponent(pathname.split("/").filter(Boolean).pop() || "");
    if (last && /\.zip$/i.test(last)) {
      return last.replace(/[\\/:*?"<>|]+/g,"_");
    }
  } catch {
    // fallback below
  }

  return `${iqFolio || "factura-iq"}.zip`;
}

function looksLikeZip(buffer: Buffer): boolean {
  if (buffer.length < 4) return false;

  return (
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    (
      (buffer[2] === 0x03 && buffer[3] === 0x04) ||
      (buffer[2] === 0x05 && buffer[3] === 0x06) ||
      (buffer[2] === 0x07 && buffer[3] === 0x08)
    )
  );
}

function emptyResult(): IqInvoiceZipDownloadHttpResult {
  return {
    authenticated: false,
    finalPath: "/invoices",
    found: false,
    clicked: false,
    downloaded: false,
    fileName: "",
    contentType: "application/zip",
    bufferBase64: "",
    rowText: "",
    invoiceActionText: "",
    pagesInspected: 0,
    errors: [],
    transport: "HTTP_DIRECT",
    invoiceMetadataUrl: "",
    downloadUrlResolved: false,
  };
}

export async function runIqDownloadInvoiceZipHttpA55(
  input: IqInvoiceZipDownloadHttpInput,
): Promise<IqInvoiceZipDownloadHttpResult> {
  const result = emptyResult();

  try {
    const iqFolio = clean(input.iqFolio);
    const marker = clean(input.marker);

    if (!iqFolio) {
      result.errors.push(
        "La solicitud no tiene Folio IQ; no es seguro descargar factura solo por monto o fecha.",
      );
      return result;
    }

    const session = await loginIqHttpDirect({
      apiOrigin: clean(input.apiOrigin) || apiOrigin(),
      credentials: {
        username: clean(input.username),
        password: clean(input.password),
      },
    });

    result.authenticated = true;

    const metadataUrl = new URL(
      `/invoices/invoice/${encodeURIComponent(iqFolio)}`,
      session.apiOrigin,
    );

    result.invoiceMetadataUrl = safePath(metadataUrl.toString());
    result.pagesInspected = 1;

    const metadataResponse = await fetchIq(metadataUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${session.accessToken}`,
      },
      redirect: "follow",
    }, { operation: "invoice_metadata" });

    result.finalPath = safePath(metadataResponse.url || metadataUrl.toString());

    if (metadataResponse.status === 401 || metadataResponse.status === 403) {
      result.authenticated = false;
      result.errors.push(
        `IQ factura rechazo autenticacion HTTP ${metadataResponse.status}.`,
      );
      return result;
    }

    if (metadataResponse.status === 404) {
      result.errors.push(
        `IQ aun no tiene factura disponible para el Folio IQ ${iqFolio}.`,
      );
      return result;
    }

    if (!metadataResponse.ok) {
      const rawErrorBody =
        await metadataResponse.text().catch(() => "");

      const errorBody = clean(rawErrorBody)
        .slice(0, 500);

      result.errors.push(
        `IQ factura metadata devolvio HTTP ${metadataResponse.status}` +
        (errorBody ? `: ${errorBody}` : "."),
      );

      return result;
    }

    result.found = true;
    result.clicked = true;
    result.invoiceActionText = "VER FACTURA HTTP";
    result.rowText = [
      `FOLIO IQ ${iqFolio}`,
      marker ? `MARKER ${marker}` : "",
    ].filter(Boolean).join(" | ");

    const payload = await metadataResponse.json().catch(() => null);
    const downloadUrl =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? clean((payload as Record<string,unknown>).url)
        : "";

    if (!downloadUrl) {
      result.errors.push(
        "IQ confirmo la factura, pero la respuesta no incluyo URL de descarga.",
      );
      return result;
    }

    let parsedDownloadUrl: URL;
    try {
      parsedDownloadUrl = new URL(downloadUrl);
    } catch {
      result.errors.push("IQ devolvio una URL de factura invalida.");
      return result;
    }

    if (parsedDownloadUrl.protocol !== "https:") {
      result.errors.push("IQ devolvio una URL de factura no HTTPS.");
      return result;
    }

    result.downloadUrlResolved = true;

    // URL firmada de Active Storage: no reenviar Bearer IQ.
    const downloadResponse = await fetchIq(parsedDownloadUrl, {
      method: "GET",
      headers: {
        Accept: "application/zip,application/octet-stream,*/*",
      },
      redirect: "follow",
    }, { timeoutMs: 60_000, operation: "invoice_download" });

    result.finalPath = safePath(downloadResponse.url || parsedDownloadUrl.toString());

    if (!downloadResponse.ok) {
      result.errors.push(
        `Descarga de factura IQ devolvio HTTP ${downloadResponse.status}.`,
      );
      return result;
    }

    const contentLength = Number(
      downloadResponse.headers.get("content-length") || 0,
    );

    if (
      Number.isFinite(contentLength) &&
      contentLength > MAX_HTTP_INVOICE_BYTES
    ) {
      result.errors.push("El ZIP de factura IQ excede 25 MB.");
      return result;
    }

    const arrayBuffer = await downloadResponse.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length <= 0) {
      result.errors.push("IQ devolvio un archivo de factura vacio.");
      return result;
    }

    if (buffer.length > MAX_HTTP_INVOICE_BYTES) {
      result.errors.push("El ZIP de factura IQ excede 25 MB.");
      return result;
    }

    if (!looksLikeZip(buffer)) {
      result.errors.push(
        "La descarga de factura IQ no tiene firma ZIP valida.",
      );
      return result;
    }

    result.fileName = fileNameFromHeadersOrUrl(
      downloadResponse,
      downloadUrl,
      iqFolio,
    );
    result.contentType =
      clean(downloadResponse.headers.get("content-type")) ||
      "application/zip";
    result.bufferBase64 = buffer.toString("base64");
    result.downloaded = true;

    return result;
  } catch (error) {
    result.errors.push(
      error instanceof Error
        ? clean(error.message)
        : clean(error) || "Error HTTP IQ no identificado.",
    );
    return result;
  }
}
