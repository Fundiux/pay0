"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

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

function updateHashAndNotify(id: string) {
  if (typeof window === "undefined") return;

  const nextHash = `#${id}`;

  if (window.location.hash !== nextHash) {
    if (window.history?.replaceState) {
      window.history.replaceState(null, "", nextHash);
    } else {
      window.location.hash = id;
    }
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
  const trackRef = useRef<HTMLDivElement | null>(null);
  const activeIdRef = useRef("");
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    const currentHash = window.location.hash.replace("#", "");
    const hashIndex = slides.findIndex((slide) => slide.id === currentHash);

    if (hashIndex >= 0) {
      const target = track.children[hashIndex] as HTMLElement | undefined;
      target?.scrollIntoView({ block: "nearest", inline: "center" });
      setActiveIndex(hashIndex);
      activeIdRef.current = slides[hashIndex]?.id || "";
      window.dispatchEvent(new CustomEvent("mat-section-change", { detail: { id: activeIdRef.current } }));
    }
  }, [slides]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    let frame = 0;

    function updateActive() {
      if (!track) return;

      const children = Array.from(track.children) as HTMLElement[];
      if (!children.length) return;

      const trackBox = track.getBoundingClientRect();
      const center = trackBox.left + trackBox.width / 2;

      let bestIndex = 0;
      let bestDistance = Number.POSITIVE_INFINITY;

      children.forEach((child, index) => {
        const childBox = child.getBoundingClientRect();
        const childCenter = childBox.left + childBox.width / 2;
        const distance = Math.abs(center - childCenter);

        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = index;
        }
      });

      const nextId = slides[bestIndex]?.id || "";

      setActiveIndex(bestIndex);

      if (nextId && nextId !== activeIdRef.current) {
        activeIdRef.current = nextId;
        updateHashAndNotify(nextId);
      }
    }

    function onScroll() {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(updateActive);
    }

    updateActive();
    track.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);

    return () => {
      window.cancelAnimationFrame(frame);
      track.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [slides]);

  function goTo(index: number) {
    const track = trackRef.current;
    if (!track) return;

    const target = track.children[index] as HTMLElement | undefined;
    if (!target) return;

    target.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });

    const nextId = slides[index]?.id;
    if (nextId) {
      activeIdRef.current = nextId;
      setActiveIndex(index);
      updateHashAndNotify(nextId);
    }
  }

  return (
    <section id={id} aria-label="Carrusel MAT 2D" className="relative flex h-full min-h-0 flex-col">
      <div
        ref={trackRef}
        className="flex flex-1 snap-x snap-mandatory gap-2 overflow-x-auto overflow-y-hidden px-2 pb-[104px] pt-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {slides.map((slide, index) => (
          <section
            key={slide.id}
            id={slide.id}
            aria-label={slide.title}
            data-active={index === activeIndex ? "true" : "false"}
            className="relative flex h-full w-[calc(100vw-1rem)] shrink-0 snap-center flex-col overflow-hidden rounded-[34px] border border-white/10 bg-white/[0.07] shadow-2xl shadow-black/45 backdrop-blur-xl md:w-[min(560px,calc(100vw-1rem))]"
          >
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_80%_0%,rgba(0,225,255,0.13),transparent_36%),linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))]" />

            <div className="relative min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {slide.children}
            </div>
          </section>
        ))}
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-[88px] z-30 flex justify-center px-4">
        <div className="pointer-events-auto flex items-center justify-center gap-1.5 rounded-full border border-white/10 bg-black/35 px-3 py-2 shadow-xl shadow-black/40 backdrop-blur-xl">
          {slides.map((slide, index) => (
            <button
              key={slide.id}
              type="button"
              aria-label={`Ir a ${slide.title}`}
              onClick={() => goTo(index)}
              className={`h-1.5 rounded-full transition-all ${
                index === activeIndex ? "w-8 bg-cyan-300" : "w-2 bg-white/25"
              }`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}