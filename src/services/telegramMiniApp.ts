import { getFunctions, httpsCallable } from "firebase/functions";
import app from "@/lib/firebase";
import type { MatBotScope } from "@/lib/telegramMiniApp";

const functions = getFunctions(app, "us-central1");

export type MatSessionStatus =
  | "OK"
  | "INVALID_INIT_DATA"
  | "EXPIRED"
  | "MISSING_TOKEN"
  | "UNLINKED"
  | "ERROR";

export type MatHomeTone = "ok" | "warn" | "info" | "danger" | "muted";

export interface VerifyTelegramMiniAppSessionInput {
  initData: string;
  botScope: MatBotScope;
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

export async function verifyTelegramMiniAppSession(
  input: VerifyTelegramMiniAppSessionInput,
): Promise<VerifyTelegramMiniAppSessionResult> {
  const callable = httpsCallable<
    VerifyTelegramMiniAppSessionInput,
    VerifyTelegramMiniAppSessionResult
  >(functions, "verifyTelegramMiniAppSession");

  const result = await callable(input);
  return result.data;
}

export async function getMatUserHome(
  input: VerifyTelegramMiniAppSessionInput,
): Promise<MatUserHomeResult> {
  const callable = httpsCallable<
    VerifyTelegramMiniAppSessionInput,
    MatUserHomeResult
  >(functions, "getMatUserHome");

  const result = await callable(input);
  return result.data;
}

export async function getMatClientHome(
  input: VerifyTelegramMiniAppSessionInput,
): Promise<MatClientHomeResult> {
  const callable = httpsCallable<
    VerifyTelegramMiniAppSessionInput,
    MatClientHomeResult
  >(functions, "getMatClientHome");

  const result = await callable(input);
  return result.data;
}