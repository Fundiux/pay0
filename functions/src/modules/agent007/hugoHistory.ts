export const HUGO_TIME_ZONE = "America/Mexico_City";

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const parts = new Intl.DateTimeFormat("en-CA", {
  timeZone: HUGO_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

export function hugoDateKey(date = new Date()): string {
  const row = Object.fromEntries(parts.formatToParts(date).map(part => [part.type, part.value]));
  return `${row.year}-${row.month}-${row.day}`;
}

function localPartsMillis(date: Date) {
  const row = Object.fromEntries(parts.formatToParts(date).map(part => [part.type, part.value]));
  return Date.UTC(Number(row.year), Number(row.month) - 1, Number(row.day), Number(row.hour), Number(row.minute), Number(row.second));
}

export function nextDateKey(dateKey: string): string {
  if (!DATE_KEY.test(dateKey)) throw new Error("INVALID_DATE_KEY");
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

export function hugoDayBounds(dateKey: string): { from: Date; to: Date } {
  if (!DATE_KEY.test(dateKey)) throw new Error("INVALID_DATE_KEY");
  const [year, month, day] = dateKey.split("-").map(Number);
  if (new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) !== dateKey) throw new Error("INVALID_DATE_KEY");
  const desired = Date.UTC(year, month - 1, day);
  let guess = desired;
  for (let index = 0; index < 3; index += 1) guess += desired - localPartsMillis(new Date(guess));
  const next = nextDateKey(dateKey);
  const [nextYear, nextMonth, nextDay] = next.split("-").map(Number);
  const nextDesired = Date.UTC(nextYear, nextMonth - 1, nextDay);
  let nextGuess = nextDesired;
  for (let index = 0; index < 3; index += 1) nextGuess += nextDesired - localPartsMillis(new Date(nextGuess));
  return { from: new Date(guess), to: new Date(nextGuess) };
}

