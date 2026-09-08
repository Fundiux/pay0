import type { ReactNode } from "react";
import { MatBottomNav, type MatBottomNavItem } from "./MatBottomNav";
import { MatTelegramStatus } from "./MatTelegramStatus";
import type { MatBotScope } from "@/lib/telegramMiniApp";

export function MatShell({
  title,
  subtitle,
  badge,
  identityLabel,
  activeNav,
  navItems,
  botScope,
  children,
}: {
  title: string;
  subtitle: string;
  badge: string;
  identityLabel?: string;
  activeNav: string;
  navItems: MatBottomNavItem[];
  botScope: MatBotScope;
  children: ReactNode;
}) {
  return (
    <main className="relative h-dvh w-full overflow-hidden bg-[#050914] text-white">
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_-10%,rgba(0,225,255,0.24),transparent_38%),radial-gradient(circle_at_12%_70%,rgba(20,255,177,0.12),transparent_30%),linear-gradient(180deg,#071225_0%,#050914_45%,#030611_100%)]" />
        <div className="absolute left-[-70px] top-28 h-52 w-52 rounded-full bg-cyan-400/10 blur-3xl" />
        <div className="absolute bottom-0 right-[-90px] h-72 w-72 rounded-full bg-blue-500/10 blur-3xl" />
      </div>

      <div className="relative flex h-dvh w-full flex-col">
        <header className="z-20 shrink-0 px-4 pt-[calc(env(safe-area-inset-top)+10px)]">
          <h1 className="sr-only">{title}</h1>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div data-testid="mat-identity" className="truncate text-xl font-black tracking-tight text-white">
                {identityLabel || subtitle || title}
              </div>
              <div className="sr-only">{badge}</div>
            </div>

            <MatTelegramStatus scope={botScope} />
          </div>
        </header>

        <div className="min-h-0 flex-1">{children}</div>
      </div>

      <MatBottomNav active={activeNav} items={navItems} />
    </main>
  );
}