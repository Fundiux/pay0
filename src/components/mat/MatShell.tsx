"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { MatBottomNav, type MatBottomNavItem } from "./MatBottomNav";
import { getBrowserTelegramName, getTelegramWebApp, initTelegramMiniAppShell, type TelegramFullscreenStatus } from "@/lib/telegramMiniApp";

export function MatShell({
  title,
  identityLabel,
  loading,
  activeNav,
  navItems,
  children,
}: {
  title: string;
  identityLabel?: string;
  loading: boolean;
  activeNav: string;
  navItems: MatBottomNavItem[];
  children: ReactNode;
}) {
  const [welcomeName, setWelcomeName] = useState("");
  const [fullscreenStatus, setFullscreenStatus] = useState<TelegramFullscreenStatus | null>(null);
  useEffect(() => initTelegramMiniAppShell(() => setWelcomeName(getBrowserTelegramName()), setFullscreenStatus), []);

  return (
    <main className="mat-shell relative flex h-dvh w-full min-w-0 flex-col overflow-hidden bg-[#050914] text-white">
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_-10%,rgba(0,225,255,0.24),transparent_38%),radial-gradient(circle_at_12%_70%,rgba(20,255,177,0.12),transparent_30%),linear-gradient(180deg,#071225_0%,#050914_45%,#030611_100%)]" />
        <div className="absolute left-[-70px] top-28 h-52 w-52 rounded-full bg-cyan-400/10 blur-3xl" />
        <div className="absolute bottom-0 right-[-90px] h-72 w-72 rounded-full bg-blue-500/10 blur-3xl" />
      </div>

      <div className="mat-content relative flex min-h-0 w-full flex-1 flex-col">
        <h1 className="sr-only">{title}</h1>
        {loading ? (
          <header className="mat-header z-20 shrink-0 px-4 pb-2">
            <div data-testid="mat-identity" className="truncate text-sm font-semibold text-slate-300">
              {welcomeName || identityLabel ? `Hola, ${welcomeName || identityLabel}` : "Preparando MAT"}
            </div>
          </header>
        ) : null}

        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </div>

      {fullscreenStatus && !fullscreenStatus.active ? (
        <button
          type="button"
          className="relative z-20 mx-auto mb-1 rounded-full border border-white/15 bg-slate-950/85 px-3 py-1 text-[10px] text-slate-300"
          onClick={() => {
            try {
              const result = getTelegramWebApp()?.requestFullscreen?.();
              if (result && typeof result.catch === "function") void result.catch(() => undefined);
            } catch { /* Telegram reports native failures through fullscreenFailed. */ }
          }}
          aria-label="Intentar pantalla completa"
        >
          Pantalla completa · {fullscreenStatus.platform} {fullscreenStatus.version}
          {fullscreenStatus.error ? ` · ${fullscreenStatus.error}` : ""}
        </button>
      ) : null}
      <MatBottomNav active={activeNav} items={navItems} />
    </main>
  );
}
