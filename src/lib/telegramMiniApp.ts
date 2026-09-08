export type MatBotScope = "USERS" | "CLIENTS";

export type TelegramWebAppLike = {
  initData?: string;
  initDataUnsafe?: {
    user?: {
      id?: number;
      first_name?: string;
      last_name?: string;
      username?: string;
      language_code?: string;
    };
    start_param?: string;
  };
  platform?: string;
  colorScheme?: string;
  version?: string;
  expand?: () => void;
  ready?: () => void;
};

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebAppLike;
    };
  }
}

export function getTelegramWebApp(): TelegramWebAppLike | null {
  if (typeof window === "undefined") return null;
  return window.Telegram?.WebApp || null;
}

export function getTelegramInitData(): string {
  return String(getTelegramWebApp()?.initData || "").trim();
}

export function isTelegramMiniApp(): boolean {
  return Boolean(getTelegramInitData());
}

export function getBrowserTelegramName(): string {
  const user = getTelegramWebApp()?.initDataUnsafe?.user;

  if (!user) return "";

  return [user.first_name, user.last_name].filter(Boolean).join(" ").trim() || user.username || String(user.id || "");
}

export function getTelegramPlatform(): string {
  return String(getTelegramWebApp()?.platform || "").trim();
}

export function initTelegramMiniAppShell() {
  const webApp = getTelegramWebApp();

  if (!webApp) return;

  try {
    webApp.ready?.();
    webApp.expand?.();
  } catch {
    // No-op: Telegram shell helpers are optional.
  }
}