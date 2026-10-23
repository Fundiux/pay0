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
  isFullscreen?: boolean;
  isExpanded?: boolean;
  expand?: () => void;
  ready?: () => void;
  isVersionAtLeast?: (version: string) => boolean;
  requestFullscreen?: () => void | Promise<void>;
  onEvent?: (event: string, callback: () => void) => void;
  offEvent?: (event: string, callback: () => void) => void;
  BackButton?: {
    show?: () => void;
    hide?: () => void;
    onClick?: (callback: () => void) => void;
    offClick?: (callback: () => void) => void;
  };
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

export function supportsTelegramVersion(app: TelegramWebAppLike, minimum: string): boolean {
  try {
    if (app.isVersionAtLeast) return app.isVersionAtLeast(minimum);
    const current = (app.version || "0").split(".").map(Number);
    const required = minimum.split(".").map(Number);
    return (current[0] || 0) > (required[0] || 0) ||
      ((current[0] || 0) === (required[0] || 0) && (current[1] || 0) >= (required[1] || 0));
  } catch { return false; }
}

let initializedApp: TelegramWebAppLike | null = null;

export function initTelegramMiniAppShell(onReady?: () => void): () => void {
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let observedApp: TelegramWebAppLike | null = null;
  const syncFullscreen = () => {
    if (observedApp) document.documentElement.dataset.matFullscreen = String(observedApp.isFullscreen === true);
  };
  const start = (attempt: number) => {
    if (disposed) return;
    const app = getTelegramWebApp();
    if (!app && attempt < 20) {
      timer = setTimeout(() => start(attempt + 1), 100);
      return;
    }
    if (!app || !app.initData) {
      onReady?.();
      return;
    }
    onReady?.();
    observedApp = app;
    syncFullscreen();
    try {
      app.onEvent?.("fullscreenChanged", syncFullscreen);
      app.onEvent?.("fullscreenFailed", syncFullscreen);
    } catch { /* Event support varies by client. */ }
    if (initializedApp === app) return;
    initializedApp = app;
    try { app.ready?.(); } catch { /* Older clients may reject optional shell calls. */ }
    try { app.expand?.(); } catch { /* Continue with the available viewport. */ }
    const supportsFullscreen = supportsTelegramVersion(app, "8.0");
    if (supportsFullscreen && app.requestFullscreen && !app.isFullscreen) {
      try {
        const result = app.requestFullscreen();
        if (result && typeof result.catch === "function") result.catch(syncFullscreen);
      } catch { syncFullscreen(); }
    }
  };
  start(0);
  return () => {
    disposed = true;
    if (timer) clearTimeout(timer);
    if (observedApp) {
      try {
        observedApp.offEvent?.("fullscreenChanged", syncFullscreen);
        observedApp.offEvent?.("fullscreenFailed", syncFullscreen);
      } catch { /* Shell teardown must not block route changes. */ }
    }
  };
}
