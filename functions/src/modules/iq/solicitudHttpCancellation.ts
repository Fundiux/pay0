import {
  loginIqHttpDirect,
  type IqHttpAuthSession,
  type IqHttpCredentials,
} from "./iqHttpAuth";

const DEFAULT_IQ_API_ORIGIN =
  "https://iq-produccion-ccc570f75402.herokuapp.com";

export type IqSolicitudCancellationHttpResult = {
  ok: boolean;
  iqFolio: string;
  status: number;
  outcome:
    | "CANCELLATION_REQUESTED"
    | "HTTP_REJECTED"
    | "TRANSPORT_UNKNOWN";
  message: string;
  responseBody: string;
};

function clean(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function apiOrigin(): string {
  return clean(process.env.PAY0_IQ_API_ORIGIN) || DEFAULT_IQ_API_ORIGIN;
}

async function authHeaders(
  session: IqHttpAuthSession,
): Promise<Record<string, string>> {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${session.accessToken}`,
  };
}

async function putCancellationOnce(
  session: IqHttpAuthSession,
  iqFolio: string,
): Promise<{ status: number; bodyText: string }> {
  const path =
    `/invoices/pending_cancellation/${encodeURIComponent(iqFolio)}`;

  const response = await fetch(new URL(path, session.apiOrigin), {
    method: "PUT",
    headers: await authHeaders(session),
  });

  return {
    status: response.status,
    bodyText: await response.text(),
  };
}

function responseMessage(bodyText: string): string {
  const raw = clean(bodyText);

  if (!raw) return "";

  try {
    const parsed = JSON.parse(raw);
    return clean(parsed?.message ?? parsed?.error ?? raw);
  } catch {
    return raw;
  }
}

export async function runIqRequestInvoiceCancellationHttp(input: {
  username: string;
  password: string;
  iqFolio: string;
  apiOrigin?: string;
}): Promise<IqSolicitudCancellationHttpResult> {
  const credentials: IqHttpCredentials = {
    username: clean(input.username),
    password: clean(input.password),
  };

  const iqFolio = clean(input.iqFolio);
  const origin = clean(input.apiOrigin) || apiOrigin();

  if (!credentials.username || !credentials.password) {
    throw new Error("IQ_AUTH_CREDENTIALS_REQUIRED");
  }

  if (!iqFolio) {
    throw new Error("IQ_FOLIO_REQUIRED");
  }

  let session = await loginIqHttpDirect({
    apiOrigin: origin,
    credentials,
  });

  let result: { status: number; bodyText: string };

  try {
    result = await putCancellationOnce(session, iqFolio);
  } catch (error) {
    return {
      ok: false,
      iqFolio,
      status: 0,
      outcome: "TRANSPORT_UNKNOWN",
      message:
        clean(error instanceof Error ? error.message : error) ||
        "IQ_CANCELLATION_TRANSPORT_UNKNOWN",
      responseBody: "",
    };
  }

  if (result.status === 401) {
    session = await loginIqHttpDirect({
      apiOrigin: origin,
      credentials,
    });

    try {
      result = await putCancellationOnce(session, iqFolio);
    } catch (error) {
      return {
        ok: false,
        iqFolio,
        status: 0,
        outcome: "TRANSPORT_UNKNOWN",
        message:
          clean(error instanceof Error ? error.message : error) ||
          "IQ_CANCELLATION_TRANSPORT_UNKNOWN",
        responseBody: "",
      };
    }
  }

  const message = responseMessage(result.bodyText);

  if (result.status >= 200 && result.status < 300) {
    return {
      ok: true,
      iqFolio,
      status: result.status,
      outcome: "CANCELLATION_REQUESTED",
      message: message || "Solicitud de cancelacion aceptada por IQ.",
      responseBody: result.bodyText,
    };
  }

  return {
    ok: false,
    iqFolio,
    status: result.status,
    outcome: "HTTP_REJECTED",
    message:
      message ||
      `IQ rechazo la solicitud de cancelacion con HTTP ${result.status}.`,
    responseBody: result.bodyText,
  };
}
