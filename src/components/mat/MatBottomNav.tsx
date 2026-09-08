"use client";

import { MouseEvent, useEffect, useState } from "react";

export type MatBottomNavItem = {
  key: string;
  label: string;
  icon: string;
  targetId?: string;
  disabled?: boolean;
};

function getItemByTarget(items: MatBottomNavItem[], targetId: string) {
  return items.find((item) => item.key === targetId || (item.targetId || item.key) === targetId);
}

function scrollToMatSection(targetId: string) {
  if (typeof window === "undefined") return false;

  const target = document.getElementById(targetId);
  if (!target) return false;

  target.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });

  if (window.history?.replaceState) {
    window.history.replaceState(null, "", `#${targetId}`);
  } else {
    window.location.hash = targetId;
  }

  window.dispatchEvent(new CustomEvent("mat-section-change", { detail: { id: targetId } }));

  return true;
}

export function MatBottomNav({
  items,
  active,
}: {
  active: string;
  items: MatBottomNavItem[];
}) {
  const [activeKey, setActiveKey] = useState(active || items[0]?.key || "");

  useEffect(() => {
    setActiveKey(active || items[0]?.key || "");
  }, [active, items]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    function syncFromHash() {
      const hash = window.location.hash.replace("#", "");
      if (!hash) return;

      const match = getItemByTarget(items, hash);
      if (match) setActiveKey(match.key);
    }

    function syncFromCarousel(event: Event) {
      const customEvent = event as CustomEvent<{ id?: string }>;
      const targetId = customEvent.detail?.id;
      if (!targetId) return;

      const match = getItemByTarget(items, targetId);
      if (match) setActiveKey(match.key);
    }

    syncFromHash();

    window.addEventListener("hashchange", syncFromHash);
    window.addEventListener("mat-section-change", syncFromCarousel as EventListener);

    return () => {
      window.removeEventListener("hashchange", syncFromHash);
      window.removeEventListener("mat-section-change", syncFromCarousel as EventListener);
    };
  }, [items]);

  return (
    <nav className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+18px)] z-50 px-4">
      <div
        className="pointer-events-auto mx-auto grid w-full max-w-[560px] gap-1 rounded-[34px] border border-white/10 bg-[#050914]/82 p-1.5 shadow-2xl shadow-black/70 backdrop-blur-2xl ring-1 ring-cyan-300/5"
        style={{ gridTemplateColumns: `repeat(${Math.max(items.length, 1)}, minmax(0, 1fr))` }}
      >
        {items.map((item) => {
          const isActive = item.key === activeKey;
          const targetId = item.targetId || item.key;

          function handleClick(event: MouseEvent<HTMLAnchorElement>) {
            if (item.disabled) {
              event.preventDefault();
              return;
            }

            setActiveKey(item.key);
            window.requestAnimationFrame(() => scrollToMatSection(targetId));
          }

          return (
            <a
              key={item.key}
              role="button"
              href={`#${targetId}`}
              aria-pressed={isActive}
              aria-disabled={item.disabled ? "true" : "false"}
              title={item.disabled ? "No disponible" : `Ir a ${item.label}`}
              onClick={handleClick}
              className={`rounded-[27px] px-1 py-2 text-center transition ${
                item.disabled
                  ? "pointer-events-none cursor-not-allowed opacity-40"
                  : isActive
                    ? "bg-cyan-300 text-slate-950 shadow-lg shadow-cyan-950/40"
                    : "text-slate-400 hover:bg-white/[0.05] hover:text-slate-100"
              }`}
            >
              <div className="text-sm font-black leading-none">{item.icon}</div>
              <div className="mt-1 truncate text-[7px] font-black uppercase tracking-[0.08em]">{item.label}</div>
            </a>
          );
        })}
      </div>
    </nav>
  );
}