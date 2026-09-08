export type MatBotScope = "USERS" | "CLIENTS";

export type MatSessionStatus =
  | "OK"
  | "INVALID_INIT_DATA"
  | "EXPIRED"
  | "MISSING_TOKEN"
  | "UNLINKED"
  | "ERROR";

export interface TelegramMiniAppUser {
  id: number;
  isBot?: boolean;
  firstName?: string;
  lastName?: string;
  username?: string;
  languageCode?: string;
  allowsWriteToPm?: boolean;
  raw?: Record<string, unknown>;
}

export interface VerifiedTelegramMiniAppInitData {
  scope: MatBotScope;
  telegramUserId: string;
  authDate: number;
  user: TelegramMiniAppUser;
  queryId?: string;
  startParam?: string;
}

export interface VerifyTelegramMiniAppSessionInput {
  initData?: unknown;
  botScope?: unknown;
}

export interface VerifyTelegramMiniAppSessionResult {
  ok: boolean;
  status: MatSessionStatus;
  scope: MatBotScope | "";
  telegramUserId: string;
  displayName: string;
  username: string;
  linked: boolean;
  pay0UserId?: string;
  clienteId?: string;
  message: string;
}

export type MatHomeTone = "ok" | "warn" | "info" | "danger" | "muted";

export interface MatHomeBalance {
  availableBalance: number;
  netBalance: number;
  pendingAdvance: number;
  label: string;
}

export interface MatHomeMetric {
  label: string;
  value: string;
}

export interface MatHomeItem {
  id: string;
  title: string;
  caption: string;
  amount: string;
  status: string;
  tone: MatHomeTone;
  createdAtMillis: number;
}

export interface MatUserHomeResult {
  ok: boolean;
  status: MatSessionStatus;
  scope: "USERS";
  linked: boolean;
  telegramUserId: string;
  displayName: string;
  username: string;
  message: string;
  pay0UserId?: string;
  role?: string;
  rootId?: string;
  balance: MatHomeBalance;
  metrics: MatHomeMetric[];
  movements: MatHomeItem[];
  clients: MatHomeItem[];
  solicitudes: MatHomeItem[];
  dispersiones: MatHomeItem[];
}

export interface MatClientHomeResult {
  ok: boolean;
  status: MatSessionStatus;
  scope: "CLIENTS";
  linked: boolean;
  telegramUserId: string;
  displayName: string;
  username: string;
  message: string;
  clienteId?: string;
  clienteNombre?: string;
  balance: MatHomeBalance;
  metrics: MatHomeMetric[];
  movements: MatHomeItem[];
  solicitudes: MatHomeItem[];
  dispersiones: MatHomeItem[];
}