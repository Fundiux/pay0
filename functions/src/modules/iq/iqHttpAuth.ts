export interface IqHttpCredentials {
  username: string;
  password: string;
}

export interface IqPermission {
  entity: string;
  action: string;
  description?: string;
}

export interface IqHttpAuthSession {
  apiOrigin: string;
  accessToken: string;
  accessTokenExpiresAtMs: number | null;
  userId: number;
  userType: string;
  role: string;
  branchId: number | null;
  branchName: string;
  permissions: IqPermission[];
}

interface IqLoginResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  user_id?: unknown;
  user_type?: unknown;
  role?: unknown;
  branch?: unknown;
  branch_id?: unknown;
  branch_name?: unknown;
  permissions?: unknown;
}

function cleanText(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeOrigin(raw: string): string {
  const parsed = new URL(raw);
  return parsed.origin;
}

function decodeJwtExpiryMs(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }

  try {
    const normalized = parts[1]
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    const padded =
      normalized +
      "=".repeat((4 - (normalized.length % 4)) % 4);

    const payload = JSON.parse(
      Buffer.from(padded, "base64").toString("utf8"),
    ) as { exp?: unknown };

    const exp = Number(payload.exp);
    return Number.isFinite(exp) && exp > 0
      ? exp * 1000
      : null;
  } catch {
    return null;
  }
}

function parsePermissions(value: unknown): IqPermission[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const permissions: IqPermission[] = [];

  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const row = item as Record<string, unknown>;
    const entity = cleanText(row.entity);
    const action = cleanText(row.action);

    if (!entity || !action) {
      continue;
    }

    const description = cleanText(row.description);
    const permission: IqPermission = {
      entity,
      action,
    };

    if (description) {
      permission.description = description;
    }

    permissions.push(permission);
  }

  return permissions;
}

function hasPermission(
  permissions: readonly IqPermission[],
  entity: string,
  action: string,
): boolean {
  return permissions.some(
    (permission) =>
      permission.entity === entity &&
      permission.action === action,
  );
}

export function assertIqDepositPermissions(
  session: IqHttpAuthSession,
): void {
  const required = [
    ["deposits", "view"],
    ["deposits", "create"],
    ["deposits/voucher", "create"],
  ] as const;

  const missing = required.filter(
    ([entity, action]) =>
      !hasPermission(session.permissions, entity, action),
  );

  if (missing.length > 0) {
    throw new Error(
      `IQ_AUTH_MISSING_PERMISSIONS: ${missing
        .map(([entity, action]) => `${entity}:${action}`)
        .join(",")}`,
    );
  }
}

export function isIqAccessTokenUsable(
  session: IqHttpAuthSession,
  safetyWindowMs = 30_000,
): boolean {
  if (!session.accessToken) {
    return false;
  }

  if (session.accessTokenExpiresAtMs === null) {
    return true;
  }

  return (
    session.accessTokenExpiresAtMs >
    Date.now() + Math.max(0, safetyWindowMs)
  );
}

export async function loginIqHttpDirect(input: {
  apiOrigin: string;
  credentials: IqHttpCredentials;
  timeoutMs?: number;
  requiredPermissions?: "DEPOSIT" | "NONE";
}): Promise<IqHttpAuthSession> {
  const apiOrigin = normalizeOrigin(input.apiOrigin);
  const username = cleanText(input.credentials.username);
  const password = cleanText(input.credentials.password);

  if (!username || !password) {
    throw new Error("IQ_AUTH_CREDENTIALS_REQUIRED");
  }

  const timeoutMs = Math.max(
    5_000,
    Math.min(Number(input.timeoutMs ?? 30_000), 60_000),
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(
      new URL("/users/sessions", apiOrigin),
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          user: {
            username,
            password,
          },
        }),
        signal: controller.signal,
      },
    );

    const payload = (await response
      .json()
      .catch(() => ({}))) as IqLoginResponse;

    if (response.status !== 201) {
      throw new Error(
        `IQ_AUTH_HTTP_${response.status}`,
      );
    }

    const accessToken = cleanText(payload.access_token);
    if (!accessToken) {
      throw new Error("IQ_AUTH_ACCESS_TOKEN_MISSING");
    }

    const userId = Number(payload.user_id);
    if (!Number.isInteger(userId) || userId <= 0) {
      throw new Error("IQ_AUTH_USER_ID_INVALID");
    }

    const branchCandidate =
      payload.branch_name ?? payload.branch;
    const branchId = Number(payload.branch_id);
    const permissions = parsePermissions(payload.permissions);

    const session: IqHttpAuthSession = {
      apiOrigin,
      accessToken,
      accessTokenExpiresAtMs:
        decodeJwtExpiryMs(accessToken),
      userId,
      userType: cleanText(payload.user_type),
      role: cleanText(payload.role),
      branchId:
        Number.isInteger(branchId) && branchId > 0
          ? branchId
          : null,
      branchName: cleanText(branchCandidate),
      permissions,
    };

    if ((input.requiredPermissions ?? "DEPOSIT") === "DEPOSIT") {
      assertIqDepositPermissions(session);
    }

    if (!isIqAccessTokenUsable(session, 10_000)) {
      throw new Error("IQ_AUTH_ACCESS_TOKEN_ALREADY_EXPIRING");
    }

    return session;
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === "AbortError"
    ) {
      throw new Error("IQ_AUTH_TIMEOUT");
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function toIqAuthContext(
  session: IqHttpAuthSession,
): {
  apiOrigin: string;
  bearerToken: string;
} {
  if (!isIqAccessTokenUsable(session)) {
    throw new Error("IQ_AUTH_ACCESS_TOKEN_EXPIRED");
  }

  return {
    apiOrigin: session.apiOrigin,
    bearerToken: session.accessToken,
  };
}