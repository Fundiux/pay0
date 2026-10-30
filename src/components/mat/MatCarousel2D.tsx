"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { getTelegramWebApp, supportsTelegramVersion } from "@/lib/telegramMiniApp";

export type MatCarouselSlide = {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  icon: string;
  actionLabel?: string;
  pinReason?: string;
  children: ReactNode;
};

function announceSection(id: string) {
  if (window.location.hash !== `#${id}`) {
    window.history.replaceState(null, "", `#${id}`);
  }
  window.dispatchEvent(new CustomEvent("mat-section-change", { detail: { id } }));
}

export function MatCarousel2D({
  id = "carrusel",
  slides,
}: {
  id?: string;
  slides: MatCarouselSlide[];
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const start = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const selectFromHash = () => {
      const index = slides.findIndex((slide) => slide.id === window.location.hash.slice(1));
      setActiveIndex(index < 0 ? 0 : index);
    };
    const selectFromNav = (event: Event) => {
      const targetId = (event as CustomEvent<{ id?: string }>).detail?.id;
      const index = slides.findIndex((slide) => slide.id === targetId);
      if (index >= 0) setActiveIndex(index);
    };
    selectFromHash();
    window.addEventListener("hashchange", selectFromHash);
    window.addEventListener("mat-section-change", selectFromNav as EventListener);
    return () => {
      window.removeEventListener("hashchange", selectFromHash);
      window.removeEventListener("mat-section-change", selectFromNav as EventListener);
    };
  }, [slides]);

  useEffect(() => {
    const app = getTelegramWebApp();
    if (!app?.initData || !app.BackButton || !supportsTelegramVersion(app, "6.1")) return;
    const back = app.BackButton;
    const onBack = () => announceSection(slides[0].id);
    try {
      if (activeIndex > 0) {
        back.onClick?.(onBack);
        back.show?.();
      } else {
        back.hide?.();
      }
    } catch { /* Native navigation is optional. */ }
    return () => {
      try {
        back.offClick?.(onBack);
        back.hide?.();
      } catch { /* Route teardown must remain safe. */ }
    };
  }, [activeIndex, slides]);

  const active = slides[activeIndex] || slides[0];
  if (!active) return null;

  return (
    <section id={id} aria-label="Secciones MAT" className="h-full min-h-0 overflow-hidden"
      onTouchStart={(event) => { start.current = { x: event.touches[0].clientX, y: event.touches[0].clientY }; }}
      onTouchEnd={(event) => {
        const origin = start.current;
        start.current = null;
        if (!origin || !event.changedTouches.length) return;
        const target = event.target as HTMLElement;
        if (target.closest("[role='dialog'], input, textarea, select, [data-mat-no-swipe]")) return;
        const dx = event.changedTouches[0].clientX - origin.x;
        const dy = event.changedTouches[0].clientY - origin.y;
        if (Math.abs(dx) < 55 || Math.abs(dx) < Math.abs(dy) * 1.35) return;
        const next = activeIndex + (dx < 0 ? 1 : -1);
        if (next >= 0 && next < slides.length) announceSection(slides[next].id);
      }}>
      <div key={active.id} id={active.id} aria-label={active.title} className="h-full overflow-y-auto overscroll-contain px-4 pb-5 pt-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {active.id !== "inicio" ? (
          <header className="mb-5">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-cyan-300">{active.eyebrow}</p>
            <h2 className="mt-1 text-2xl font-black tracking-tight text-white">{active.title}</h2>
            <p className="mt-1 text-sm leading-5 text-slate-400">{active.description}</p>
          </header>
        ) : null}
        {active.children}
      </div>
    </section>
  );
}
