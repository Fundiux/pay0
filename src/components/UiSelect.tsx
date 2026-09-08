"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

export type UiSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  options: UiSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  size?: "default" | "compact";
  menuMode?: "absolute" | "inline" | "fixed";
};

export default function UiSelect({
  value,
  onChange,
  options,
  placeholder = "Selecciona opcion",
  disabled = false,
  className = "",
  size = "default",
  menuMode = "absolute",
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef("");
  const searchTimerRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [fixedMenuStyle, setFixedMenuStyle] = useState<{ left: number; top: number; width: number } | null>(null);

  const compact = size === "compact";
  const inlineMenu = menuMode === "inline";
  const fixedMenu = menuMode === "fixed";

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!rootRef.current || rootRef.current.contains(event.target as Node)) return;
      setOpen(false);
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (disabled && open) {
      setOpen(false);
    }
  }, [disabled, open]);

  useEffect(() => {
    return () => {
      if (searchTimerRef.current) {
        window.clearTimeout(searchTimerRef.current);
      }
    };
  }, []);

  const selected = useMemo(() => {
    if (!value) return null;
    return options.find((option) => option.value === value) || null;
  }, [options, value]);

  useLayoutEffect(() => {
    if (!open || !fixedMenu || !rootRef.current) {
      setFixedMenuStyle(null);
      return;
    }

    const updatePosition = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      setFixedMenuStyle({
        left: rect.left,
        top: rect.bottom + 4,
        width: rect.width,
      });
    };

    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);

    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open, fixedMenu]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;

    if (event.key === "Escape") {
      setOpen(false);
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpen((current) => !current);
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      const currentIndex = options.findIndex((option) => option.value === value);
      const next = options.slice(currentIndex + 1).find((option) => !option.disabled) || options.find((option) => !option.disabled);
      if (next) onChange(next.value);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      const currentIndex = options.findIndex((option) => option.value === value);
      const previous =
        options
          .slice(0, currentIndex < 0 ? options.length : currentIndex)
          .reverse()
          .find((option) => !option.disabled) ||
        [...options].reverse().find((option) => !option.disabled);
      if (previous) onChange(previous.value);
      return;
    }

    if (event.key.length !== 1) return;

    searchRef.current = `${searchRef.current}${event.key}`.toLowerCase();

    if (searchTimerRef.current) {
      window.clearTimeout(searchTimerRef.current);
    }

    searchTimerRef.current = window.setTimeout(() => {
      searchRef.current = "";
    }, 700);

    const term = searchRef.current;
    const match =
      options.find((option) => !option.disabled && option.label.toLowerCase().startsWith(term)) ||
      options.find((option) => !option.disabled && option.label.toLowerCase().includes(term));

    if (match) {
      onChange(match.value);
      setOpen(true);
    }
  };

  const triggerClass = compact
    ? "h-8 rounded-lg px-2.5 py-1 text-[11px]"
    : "h-10 rounded-xl px-3 py-2 text-sm";

  const menuClass = inlineMenu
    ? compact
      ? "relative z-[1600] mt-1 max-h-32 overflow-y-auto rounded-lg border border-white/10 bg-[#1c2636] py-1 shadow-2xl"
      : "relative z-[1600] mt-1 max-h-64 overflow-y-auto rounded-xl border border-white/10 bg-[#1c2636] py-1 shadow-2xl"
    : fixedMenu
      ? compact
        ? "fixed z-[5000] max-h-32 overflow-y-auto rounded-lg border border-white/10 bg-[#1c2636] py-1 shadow-2xl"
        : "fixed z-[5000] max-h-64 overflow-y-auto rounded-xl border border-white/10 bg-[#1c2636] py-1 shadow-2xl"
      : compact
        ? "absolute left-0 right-0 z-[1600] mt-1 max-h-32 overflow-y-auto rounded-lg border border-white/10 bg-[#1c2636] py-1 shadow-2xl"
        : "absolute left-0 right-0 z-[1600] mt-1 max-h-64 overflow-y-auto rounded-xl border border-white/10 bg-[#1c2636] py-1 shadow-2xl";

  const emptyClass = compact ? "px-2.5 py-2 text-[11px] text-slate-500" : "px-3 py-3 text-sm text-slate-500";
  const optionClass = compact ? "px-2.5 py-1.5 text-[11px]" : "px-3 py-2 text-sm";

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          if (disabled) return;
          setOpen((current) => !current);
        }}
        onKeyDown={handleKeyDown}
        className={[
          "flex w-full items-center justify-between gap-2 border border-white/10 bg-[#0b1220] text-left text-slate-100 outline-none transition focus:border-sky-500/50",
          triggerClass,
          disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-white/5",
        ].join(" ")}
      >
        <span className={`truncate ${selected ? "text-white" : "text-slate-500"}`}>
          {selected?.label || placeholder}
        </span>
        <ChevronDown
          size={compact ? 13 : 16}
          className={`shrink-0 text-slate-400 transition ${open ? "rotate-180 text-sky-300" : ""}`}
        />
      </button>

      {open && (
        <ul
          role="listbox"
          className={menuClass}
          style={fixedMenu && fixedMenuStyle ? { left: fixedMenuStyle.left, top: fixedMenuStyle.top, width: fixedMenuStyle.width } : undefined}
        >
          {options.length === 0 ? (
            <li className={emptyClass}>Sin opciones</li>
          ) : (
            options.map((option) => (
              <li key={`${option.value}-${option.label}`} role="option" aria-selected={Boolean(value) && option.value === value}>
                <button
                  type="button"
                  disabled={option.disabled}
                  onClick={() => {
                    if (option.disabled) return;
                    onChange(option.value);
                    setOpen(false);
                  }}
                  className={[
                    "w-full text-left transition",
                    optionClass,
                    option.disabled
                      ? "cursor-not-allowed text-slate-600"
                      : Boolean(value) && option.value === value
                        ? "bg-[#0063C4]/25 text-white"
                        : "text-slate-300 hover:bg-[#0063C4]/25 hover:text-white",
                  ].join(" ")}
                >
                  {option.label}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}