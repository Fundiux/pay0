import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebaseClient";

export type TelegramLinkTokenResult = {
  ok: boolean;
  token: string;
  startUrl: string;
  expiresAt: string;
};

export type TelegramLinkStatusResult = {
  ok: boolean;
  linked: boolean;
  telegramUserId: string;
  telegramUsername: string;
  role: string;
  rootId: string;
};

export type TelegramUnlinkResult = {
  ok: boolean;
  unlinked: boolean;
  count: number;
};

export type TelegramNotificationPrefs = {
  uid: string;
  enabled: boolean;
  notifySaldo: boolean;
  notifyPagos: boolean;
  notifySolicitudes: boolean;
  notifyDispersiones: boolean;
};

export type TelegramNotificationPrefsResult = {
  ok: boolean;
  prefs: TelegramNotificationPrefs;
};

export async function createTelegramLinkToken(): Promise<TelegramLinkTokenResult> {
  const callable = httpsCallable<Record<string, never>, TelegramLinkTokenResult>(
    functions,
    "createTelegramLinkToken"
  );

  const result = await callable({});
  return result.data;
}

export async function getMyTelegramLinkStatus(): Promise<TelegramLinkStatusResult> {
  const callable = httpsCallable<Record<string, never>, TelegramLinkStatusResult>(
    functions,
    "getMyTelegramLinkStatus"
  );

  const result = await callable({});
  return result.data;
}

export async function unlinkMyTelegramAccount(): Promise<TelegramUnlinkResult> {
  const callable = httpsCallable<Record<string, never>, TelegramUnlinkResult>(
    functions,
    "unlinkMyTelegramAccount"
  );

  const result = await callable({});
  return result.data;
}

export async function getMyTelegramNotificationPrefs(): Promise<TelegramNotificationPrefsResult> {
  const callable = httpsCallable<Record<string, never>, TelegramNotificationPrefsResult>(
    functions,
    "getMyTelegramNotificationPrefs"
  );

  const result = await callable({});
  return result.data;
}

export async function updateMyTelegramNotificationPrefs(
  prefs: Partial<TelegramNotificationPrefs>
): Promise<TelegramNotificationPrefsResult> {
  const callable = httpsCallable<Partial<TelegramNotificationPrefs>, TelegramNotificationPrefsResult>(
    functions,
    "updateMyTelegramNotificationPrefs"
  );

  const result = await callable(prefs);
  return result.data;
}
export type TelegramTestNotificationResult = {
  ok: boolean;
  sent: boolean;
  reason?: string;
};

export async function sendMyTelegramTestNotification(): Promise<TelegramTestNotificationResult> {
  const callable = httpsCallable<Record<string, never>, TelegramTestNotificationResult>(
    functions,
    "sendMyTelegramTestNotification"
  );

  const result = await callable({});
  return result.data;
}
export type ClientTelegramLinkTokenResult = {
  ok: boolean;
  token: string;
  startUrl: string;
  expiresAt: string;
  clientName: string;
};

export type ClientTelegramLinkStatusResult = {
  ok: boolean;
  linked: boolean;
  telegramUserId: string;
  telegramUsername: string;
  clientId: string;
  clientName: string;
};

export type ClientTelegramUnlinkResult = {
  ok: boolean;
  unlinked: boolean;
  count: number;
};

export async function createClientTelegramLinkToken(
  clientId: string
): Promise<ClientTelegramLinkTokenResult> {
  const callable = httpsCallable<{ clientId: string }, ClientTelegramLinkTokenResult>(
    functions,
    "createClientTelegramLinkToken"
  );

  const result = await callable({ clientId });
  return result.data;
}

export async function getClientTelegramLinkStatus(
  clientId: string
): Promise<ClientTelegramLinkStatusResult> {
  const callable = httpsCallable<{ clientId: string }, ClientTelegramLinkStatusResult>(
    functions,
    "getClientTelegramLinkStatus"
  );

  const result = await callable({ clientId });
  return result.data;
}

export async function unlinkClientTelegramAccount(
  clientId: string
): Promise<ClientTelegramUnlinkResult> {
  const callable = httpsCallable<{ clientId: string }, ClientTelegramUnlinkResult>(
    functions,
    "unlinkClientTelegramAccount"
  );

  const result = await callable({ clientId });
  return result.data;
}
