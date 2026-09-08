import { loginIqHttpDirect } from "./iqHttpAuth";

const DEFAULT_IQ_API_ORIGIN =
  "https://iq-produccion-ccc570f75402.herokuapp.com";

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

export async function runIqLoginProbeHttpA56(input: {
  erpUrl?: string;
  apiOrigin?: string;
  username: string;
  password: string;
  timeoutMs?: number;
}): Promise<any> {
  const startedAtMs = Date.now();
  const apiOrigin =
    clean(input.apiOrigin) || DEFAULT_IQ_API_ORIGIN;

  try {
    const session = await loginIqHttpDirect({
      apiOrigin,
      credentials: {
        username: clean(input.username),
        password: clean(input.password),
      },
      timeoutMs: input.timeoutMs,
      requiredPermissions: "NONE",
    });

    return {
      authenticated: true,
      loginStatus: "IQ_AUTHENTICATED",
      loginMessage:
        "Sesion IQ confirmada por HTTP directo.",
      landingPath: "/",
      finalPath: "/",
      finalUrl: clean(input.erpUrl) || apiOrigin,
      candidateLinks: [],
      pages: [],
      networkGetPaths: ["/users/sessions"],
      transport: "HTTP_DIRECT",
      httpAuthEndpoint: "/users/sessions",
      elapsedMs: Date.now() - startedAtMs,

      // Metadata segura; nunca exponer accessToken.
      userId: session.userId,
      userType: session.userType,
      role: session.role,
      branchId: session.branchId,
      branchName: session.branchName,
      permissionsCount: session.permissions.length,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : clean(error) || "IQ_AUTH_UNKNOWN_ERROR";

    return {
      authenticated: false,
      loginStatus:
        message === "IQ_AUTH_TIMEOUT"
          ? "IQ_LOGIN_TIMEOUT"
          : message.startsWith("IQ_AUTH_HTTP_")
            ? "IQ_LOGIN_REJECTED"
            : "IQ_LOGIN_FAILED",
      loginMessage:
        `No se pudo confirmar la sesion IQ por HTTP directo: ${message}`,
      landingPath: "/",
      finalPath: "/",
      finalUrl: clean(input.erpUrl) || apiOrigin,
      candidateLinks: [],
      pages: [],
      networkGetPaths: ["/users/sessions"],
      transport: "HTTP_DIRECT",
      httpAuthEndpoint: "/users/sessions",
      elapsedMs: Date.now() - startedAtMs,
      error: message,
    };
  }
}