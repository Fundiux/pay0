export type DateScopeMode = "day" | "week" | "month" | "year" | "custom";

export type CustomRange = {
  start?: Date;
  end?: Date;
};

export function getWeekNumber(d: Date) {
  const date = new Date(d.getTime());
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const week1 = new Date(date.getFullYear(), 0, 4);
  return 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
}

export function formatMonthSpanish(d: Date) {
  return [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
  ][d.getMonth()];
}

export function formatShortDate(d?: Date) {
  if (!d) return "";
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

export function getScopeRange(mode: DateScopeMode, baseDate: Date, customRange?: CustomRange) {
  if (mode === "custom" && customRange?.start && customRange?.end) {
    const from = new Date(customRange.start);
    const to = new Date(customRange.end);
    from.setHours(0, 0, 0, 0);
    to.setHours(23, 59, 59, 999);
    return { from, to };
  }

  const from = new Date(baseDate);
  const to = new Date(baseDate);

  if (mode === "day") {
    from.setHours(0, 0, 0, 0);
    to.setHours(23, 59, 59, 999);
  } else if (mode === "week") {
    const day = from.getDay();
    from.setDate(from.getDate() - day);
    from.setHours(0, 0, 0, 0);
    to.setDate(from.getDate() + 6);
    to.setHours(23, 59, 59, 999);
  } else if (mode === "month") {
    from.setDate(1);
    from.setHours(0, 0, 0, 0);
    to.setMonth(to.getMonth() + 1);
    to.setDate(0);
    to.setHours(23, 59, 59, 999);
  } else if (mode === "year") {
    from.setMonth(0, 1);
    from.setHours(0, 0, 0, 0);
    to.setMonth(11, 31);
    to.setHours(23, 59, 59, 999);
  }

  return { from, to };
}

export function shiftBaseDate(mode: DateScopeMode, baseDate: Date, direction: number) {
  const next = new Date(baseDate);

  if (mode === "day") next.setDate(next.getDate() + direction);
  if (mode === "week") next.setDate(next.getDate() + direction * 7);
  if (mode === "month") next.setMonth(next.getMonth() + direction);
  if (mode === "year") next.setFullYear(next.getFullYear() + direction);

  return next;
}

export function getScopeLabel(mode: DateScopeMode, baseDate: Date, customRange?: CustomRange) {
  if (mode === "custom" && customRange?.start && customRange?.end) {
    return `${formatShortDate(customRange.start)} - ${formatShortDate(customRange.end)}`;
  }

  if (mode === "day") return `${baseDate.getDate()}/${baseDate.getMonth() + 1}/${baseDate.getFullYear()}`;
  if (mode === "week") return `Semana ${getWeekNumber(baseDate)}`;
  if (mode === "month") return formatMonthSpanish(baseDate);
  return `${baseDate.getFullYear()}`;
}

export function isTsWithinRange(ts: any, from: Date, to: Date) {
  if (!ts?.seconds) return false;
  const value = ts.seconds * 1000;
  return value >= from.getTime() && value <= to.getTime();
}
