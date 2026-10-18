"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays } from "lucide-react";
import {
  CustomRange,
  DateScopeMode,
  formatMonthSpanish,
  getScopeLabel,
} from "@/lib/dateScope";

type Props = {
  mode: DateScopeMode;
  baseDate: Date;
  customRange?: CustomRange;
  onModeChange: (mode: DateScopeMode) => void;
  onNavigate: (direction: number) => void;
  onCustomRangeChange?: (range: CustomRange) => void;
  className?: string;
};

export default function DateScopeBar({
  mode,
  baseDate,
  customRange,
  onModeChange,
  onNavigate,
  onCustomRangeChange,
  className = "",
}: Props) {
  const [showPicker, setShowPicker] = useState(false);
  const [pickerDate, setPickerDate] = useState(baseDate);

  useEffect(() => {
    if (showPicker) {
      if (mode === "custom" && customRange?.start) {
        setPickerDate(customRange.start);
      } else {
        setPickerDate(baseDate);
      }
    }
  }, [showPicker, baseDate, mode, customRange]);

  const calendarDays = useMemo(() => {
    const year = pickerDate.getFullYear();
    const month = pickerDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const days: Array<Date | null> = [];
    for (let i = 0; i < (firstDay === 0 ? 6 : firstDay - 1); i++) days.push(null);
    for (let d = 1; d <= daysInMonth; d++) days.push(new Date(year, month, d));
    return days;
  }, [pickerDate]);

  const centerLabel = useMemo(() => {
    return getScopeLabel(mode, baseDate, customRange);
  }, [mode, baseDate, customRange]);

  const displayCenterLabel = useMemo(() => {
    if (mode === "month") {
      return formatMonthSpanish(baseDate);
    }

    return centerLabel;
  }, [mode, baseDate, centerLabel]);

  const handleDateClick = (date: Date) => {
    if (!onCustomRangeChange) return;

    if (!customRange?.start || (customRange.start && customRange.end)) {
      onCustomRangeChange({ start: date });
      return;
    }

    if (date < customRange.start) {
      onCustomRangeChange({ start: date });
      return;
    }

    onCustomRangeChange({
      start: customRange.start,
      end: date,
    });
    onModeChange("custom");
    setShowPicker(false);
  };

  return (
    <div className={`relative ${className}`}>
      <div className="flex min-h-[15px] items-center gap-4 px-1 py-0">
        <div className="flex shrink-0 gap-1">
          {(["day", "week", "month", "year"] as DateScopeMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onModeChange(m)}
              className={
                mode === m
                  ? "h-7 px-2 text-xs font-normal text-sky-300 transition-colors"
                  : "h-7 px-2 text-xs font-normal text-slate-500 transition-colors hover:text-slate-200"
              }
            >
              {m === "day" ? "DIA" : m === "week" ? "SEMANA" : m === "month" ? "MES" : "AÑO"}
            </button>
          ))}
        </div>

        <div className="flex flex-1 items-center justify-center">
          <div className={`flex h-7 items-center gap-4 px-2 ${mode === "custom" ? "opacity-50" : ""}`}>
            <button
              type="button"
              onClick={() => onNavigate(-1)}
              disabled={mode === "custom"}
              className="bg-transparent px-1 text-lg font-normal text-sky-400 hover:text-sky-300 disabled:opacity-40"
            >
              &lt;
            </button>

            <span className="min-w-[100px] text-center text-sm font-normal text-slate-100">
              {displayCenterLabel}
            </span>

            <button
              type="button"
              onClick={() => onNavigate(1)}
              disabled={mode === "custom"}
              className="bg-transparent px-1 text-lg font-normal text-sky-400 hover:text-sky-300 disabled:opacity-40"
            >
              &gt;
            </button>
          </div>
        </div>

        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setShowPicker((p) => !p)}
            className={
              mode === "custom"
                ? "inline-flex h-7 w-7 items-center justify-center text-sky-300 transition-colors"
                : "inline-flex h-7 w-7 items-center justify-center text-slate-400 transition-colors hover:text-white"
            }
          >
            <CalendarDays size={14} />
          </button>

          {showPicker && (
            <div className="absolute right-0 top-[36px] z-[1600] w-[320px] rounded-2xl border border-white/10 bg-[#0b1220] p-4 shadow-2xl">
              <div className="mb-4 flex items-center justify-between text-white">
                <button
                  type="button"
                  onClick={() => setPickerDate((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}
                  className="bg-transparent text-lg font-normal text-sky-400 hover:text-sky-300"
                >
                  -
                </button>

                <span className="text-sm font-normal">
                  {formatMonthSpanish(pickerDate)} {pickerDate.getFullYear()}
                </span>

                <button
                  type="button"
                  onClick={() => setPickerDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}
                  className="bg-transparent text-lg font-normal text-sky-400 hover:text-sky-300"
                >
                  +
                </button>
              </div>

              <div className="mb-2 grid grid-cols-7 gap-1 text-center">
                {["L", "M", "M", "J", "V", "S", "D"].map((d) => (
                  <span key={d} className="text-[10px] font-normal text-slate-500">
                    {d}
                  </span>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-1 text-center">
                {calendarDays.map((date, i) => {
                  if (!date) return <div key={`empty-${i}`} />;

                  const isStart = customRange?.start?.toDateString() === date.toDateString();
                  const isEnd = customRange?.end?.toDateString() === date.toDateString();
                  const inRange =
                    customRange?.start &&
                    customRange?.end &&
                    date > customRange.start &&
                    date < customRange.end;

                  return (
                    <button
                      key={date.toISOString()}
                      type="button"
                      onClick={() => handleDateClick(date)}
                      className={
                        isStart || isEnd
                          ? "rounded-md bg-sky-400 py-2 text-xs font-normal text-black"
                          : inRange
                            ? "rounded-md bg-sky-400/20 py-2 text-xs text-white"
                            : "rounded-md py-2 text-xs text-white hover:bg-white/5"
                      }
                    >
                      {date.getDate()}
                    </button>
                  );
                })}
              </div>

              <div className="mt-4 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onCustomRangeChange?.({});
                    onModeChange("day");
                    setShowPicker(false);
                  }}
                  className="rounded-lg border border-white/10 px-3 py-2 text-xs font-normal text-slate-300 hover:bg-white/5"
                >
                  Limpiar
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const today = new Date();
                    onCustomRangeChange?.({ start: today, end: today });
                    onModeChange("custom");
                    setShowPicker(false);
                  }}
                  className="rounded-lg bg-sky-500 px-3 py-2 text-xs font-normal text-black hover:bg-sky-400"
                >
                  Hoy
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}