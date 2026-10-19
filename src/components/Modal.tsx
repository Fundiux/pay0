"use client";

import { ReactNode, RefObject, useEffect, useId, useRef } from "react";
import { X } from "lucide-react";

type Props = {
  open: boolean;
  title?: string;
  children: ReactNode;
  onClose: () => void;
  widthClassName?: string;
  bodyClassName?: string;
  ariaLabel?: string;
  closeOnEscape?: boolean;
  closeOnBackdrop?: boolean;
  closeButtonDisabled?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
};

const openModalIds = new Set<string>();
const openModalElements = new Map<string, HTMLDivElement>();
let bodyOverflowBeforeModal = "";

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function getFocusable(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(focusableSelector)).filter(
    (element) => element.getAttribute("aria-hidden") !== "true" && element.offsetParent !== null,
  );
}

export default function Modal({
  open,
  title,
  children,
  onClose,
  widthClassName,
  bodyClassName,
  ariaLabel,
  closeOnEscape = true,
  closeOnBackdrop = true,
  closeButtonDisabled = false,
  initialFocusRef,
}: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const closePolicyRef = useRef({ closeOnEscape, closeButtonDisabled });
  onCloseRef.current = onClose;
  closePolicyRef.current = { closeOnEscape, closeButtonDisabled };
  const modalId = useId();
  const titleId = useId();
  const hasTitle = Boolean(title?.trim());

  // Capture before children mount: an autoFocus child can otherwise replace the opener
  // before the effect that manages the open dialog runs.
  if (open && !restoreFocusRef.current && typeof document !== "undefined") {
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }

  useEffect(() => {
    if (!open) return;

    openModalIds.add(modalId);
    if (dialogRef.current) openModalElements.set(modalId, dialogRef.current);
    if (openModalIds.size === 1) bodyOverflowBeforeModal = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (event: KeyboardEvent) => {
      const { closeOnEscape: canCloseOnEscape, closeButtonDisabled: isCloseDisabled } = closePolicyRef.current;
      if (event.key === "Escape" && openModalIds.has(modalId) && Array.from(openModalIds).at(-1) === modalId && canCloseOnEscape && !isCloseDisabled) {
        event.preventDefault();
        onCloseRef.current();
      }
    };

    window.addEventListener("keydown", onKey);
    const focusFrame = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      if (dialog.contains(document.activeElement) && document.activeElement !== dialog) return;
      const preferred = initialFocusRef?.current;
      const target = preferred && dialog.contains(preferred) && !preferred.hasAttribute("disabled")
        ? preferred
        : getFocusable(dialog)[0] || dialog;
      target.focus();
    });

    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", onKey);
      const wasTopModal = Array.from(openModalIds).at(-1) === modalId;
      openModalIds.delete(modalId);
      openModalElements.delete(modalId);
      if (openModalIds.size === 0) document.body.style.overflow = bodyOverflowBeforeModal;
      const previousFocus = restoreFocusRef.current;
      restoreFocusRef.current = null;
      const remainingTopId = Array.from(openModalIds).at(-1);
      if (wasTopModal) window.requestAnimationFrame(() => {
        // A new dialog may have opened since cleanup. Never steal its focus.
        if (Array.from(openModalIds).at(-1) !== remainingTopId) return;
        const remainingDialog = remainingTopId ? openModalElements.get(remainingTopId) : null;
        if (remainingDialog?.isConnected) {
          const target = previousFocus?.isConnected && remainingDialog.contains(previousFocus)
            ? previousFocus : getFocusable(remainingDialog)[0] || remainingDialog;
          target.focus();
        } else if (previousFocus?.isConnected && !previousFocus.hasAttribute("disabled") && previousFocus.tabIndex >= 0) previousFocus.focus();
      });
    };
  }, [initialFocusRef, modalId, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] h-[100dvh] w-[100dvw] overflow-hidden">
      <div className="fixed inset-0 h-[100dvh] w-[100dvw] bg-black/65 backdrop-blur-sm" />

      <div
        className="fixed inset-0 flex h-[100dvh] w-[100dvw] items-center justify-center overflow-hidden p-4"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget && closeOnBackdrop && !closeButtonDisabled) {
            onClose();
          }
        }}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={hasTitle ? titleId : undefined}
          aria-label={hasTitle ? undefined : ariaLabel || "Ventana de diálogo PAY0"}
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key !== "Tab" || Array.from(openModalIds).at(-1) !== modalId) return;
            const focusable = getFocusable(event.currentTarget);
            if (!focusable.length) {
              event.preventDefault();
              event.currentTarget.focus();
              return;
            }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            const active = document.activeElement;
            if (event.shiftKey && (active === first || active === event.currentTarget || !event.currentTarget.contains(active))) {
              event.preventDefault();
              last.focus();
            } else if (!event.shiftKey && (active === last || active === event.currentTarget || !event.currentTarget.contains(active))) {
              event.preventDefault();
              first.focus();
            }
          }}
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
              <div id={titleId} className="text-[13px] text-slate-100">{title}</div>
              <button
                type="button"
                onClick={onClose}
                disabled={closeButtonDisabled}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
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
              disabled={closeButtonDisabled}
              className="absolute -right-2 -top-2 z-20 inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-[#0b1220] text-slate-400 shadow-lg shadow-black/40 transition hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
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
