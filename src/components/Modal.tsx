"use client";

import { ReactNode, useEffect } from "react";
import { X } from "lucide-react";

type Props = {
  open: boolean;
  title?: string;
  children: ReactNode;
  onClose: () => void;
  widthClassName?: string;
  bodyClassName?: string;
};

export default function Modal({ open, title, children, onClose, widthClassName, bodyClassName }: Props) {
  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] h-[100dvh] w-[100dvw] overflow-hidden">
      <div className="fixed inset-0 h-[100dvh] w-[100dvw] bg-black/65 backdrop-blur-sm" />

      <div
        className="fixed inset-0 flex h-[100dvh] w-[100dvw] items-center justify-center overflow-hidden p-4"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            onClose();
          }
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          onMouseDown={(event) => event.stopPropagation()}
          className={[
            "relative w-[calc(100vw-2rem)]",
            widthClassName || "max-w-3xl",
            "max-h-[calc(100vh-2rem)]",
            "rounded-2xl border border-white/10",
            "bg-[#161d2b] shadow-2xl shadow-black/50",
          ].join(" ")}
        >
          {title ? (
            <div className="flex min-h-[52px] items-center justify-between border-b border-white/10 px-5 py-3">
              <div className="text-[13px] text-slate-100">{title}</div>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-white/5 hover:text-white"
                aria-label="Cerrar"
                title="Cerrar"
              >
                <X size={16} strokeWidth={1.9} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="absolute -right-2 -top-2 z-20 inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-[#0b1220] text-slate-400 shadow-lg shadow-black/40 transition hover:bg-white/5 hover:text-white"
              aria-label="Cerrar"
              title="Cerrar"
            >
              <X size={16} strokeWidth={1.9} />
            </button>
          )}

          <div className={bodyClassName || (title ? "max-h-[calc(100vh-7rem)] overflow-y-auto p-5" : "max-h-[calc(100vh-2rem)] overflow-y-auto p-5")}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}