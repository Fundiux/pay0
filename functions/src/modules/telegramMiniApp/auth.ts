import * as crypto from "crypto";
import type {
  MatBotScope,
  TelegramMiniAppUser,
  VerifiedTelegramMiniAppInitData,
} from "./domain";

const TELEGRAM_WEB_APP_DATA_KEY = "WebAppData";
const DEFAULT_MAX_AGE_SECONDS = 60 * 60;

function normalizeScope(scope: unknown): MatBotScope {
  const value = String(scope || "").trim().toUpperCase();

  if (value === "USERS" || value === "CLIENTS") {
    return value;
  }

  throw new Error("INVALID_SCOPE");
}

function parseAuthDate(value: string | null): number {
  const n = Number(value || 0);

  if (!Number.isFinite(n) || n <= 0) {
    throw new Error("INVALID_AUTH_DATE");
  }

  return Math.floor(n);
}

function safeJsonParse(value: string | null): Record<string, unknown> {
  if (!value) {
    throw new Error("MISSING_USER");
  }

  try {
    const parsed = JSON.parse(value);

    if (!parsed || typeof parsed !== "object") {
      throw new Error("INVALID_USER");
    }

    return parsed as Record<string, unknown>;
  } catch {
    throw new Error("INVALID_USER");
  }
}

function toTelegramUser(raw: Record<string, unknown>): TelegramMiniAppUser {
  const idNumber = Number(raw.id);

  if (!Number.isFinite(idNumber) || idNumber <= 0) {
    throw new Error("INVALID_USER_ID");
  }

  return {
    id: idNumber,
    isBot: Boolean(raw.is_bot),
    firstName: typeof raw.first_name === "string" ? raw.first_name : "",
    lastName: typeof raw.last_name === "string" ? raw.last_name : "",
    username: typeof raw.username === "string" ? raw.username : "",
    languageCode: typeof raw.language_code === "string" ? raw.language_code : "",
    allowsWriteToPm: Boolean(raw.allows_write_to_pm),
    raw,
  };
}

function timingSafeHexEqual(a: string, b: string): boolean {
  const cleanA = String(a || "").trim().toLowerCase();
  const cleanB = String(b || "").trim().toLowerCase();

  if (!cleanA || !cleanB || cleanA.length !== cleanB.length) {
    return false;
  }

  const bufferA = Buffer.from(cleanA, "hex");
  const bufferB = Buffer.from(cleanB, "hex");

  if (bufferA.length !== bufferB.length) {
    return false;
  }

  return crypto.timingSafeEqual(bufferA, bufferB);
}

export function validateTelegramMiniAppInitData({
  initData,
  botToken,
  botScope,
  maxAgeSeconds = DEFAULT_MAX_AGE_SECONDS,
  nowSeconds = Math.floor(Date.now() / 1000),
}: {
  initData: string;
  botToken: string;
  botScope: unknown;
  maxAgeSeconds?: number;
  nowSeconds?: number;
}): VerifiedTelegramMiniAppInitData {
  const scope = normalizeScope(botScope);
  const rawInitData = String(initData || "").trim();
  const token = String(botToken || "").trim();

  if (!rawInitData) {
    throw new Error("MISSING_INIT_DATA");
  }

  if (!token) {
    throw new Error("MISSING_TOKEN");
  }

  const params = new URLSearchParams(rawInitData);
  const receivedHash = params.get("hash");

  if (!receivedHash) {
    throw new Error("MISSING_HASH");
  }

  params.delete("hash");

  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = crypto
    .createHmac("sha256", TELEGRAM_WEB_APP_DATA_KEY)
    .update(token)
    .digest();

  const calculatedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  if (!timingSafeHexEqual(calculatedHash, receivedHash)) {
    throw new Error("INVALID_HASH");
  }

  const authDate = parseAuthDate(params.get("auth_date"));

  if (maxAgeSeconds > 0 && nowSeconds - authDate > maxAgeSeconds) {
    throw new Error("EXPIRED_AUTH_DATE");
  }

  const userRaw = safeJsonParse(params.get("user"));
  const user = toTelegramUser(userRaw);

  return {
    scope,
    telegramUserId: String(user.id),
    authDate,
    user,
    queryId: params.get("query_id") || "",
    startParam: params.get("start_param") || "",
  };
}

export function getTelegramDisplayName(user: TelegramMiniAppUser): string {
  return [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || user.username || String(user.id);
}