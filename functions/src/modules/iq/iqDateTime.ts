// H4_D87_A58_A35_R1_CANONICAL_IQ_DATETIME
// Fuente unica para interpretar timestamps que VIENEN DESDE IQ.
//
// Regla:
// - IQ sin Z/offset => hora local de IQ en America/Mexico_City.
// - IQ con Z/offset explicito => se respeta el instante recibido.
// - No usar este parser para Timestamp/createdAt internos de PAY0.
// - No depende de la zona horaria del proceso de Cloud Run.

export const IQ_CANONICAL_TIME_ZONE = "America/Mexico_City";

type IqLocalDateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
};

function clean(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function validParts(parts: IqLocalDateTimeParts): boolean {
  if (!Number.isInteger(parts.year) || parts.year < 2000 || parts.year > 2200) {
    return false;
  }
  if (!Number.isInteger(parts.month) || parts.month < 1 || parts.month > 12) {
    return false;
  }

  const daysInMonth = new Date(
    Date.UTC(parts.year, parts.month, 0),
  ).getUTCDate();

  if (!Number.isInteger(parts.day) || parts.day < 1 || parts.day > daysInMonth) {
    return false;
  }
  if (!Number.isInteger(parts.hour) || parts.hour < 0 || parts.hour > 23) {
    return false;
  }
  if (!Number.isInteger(parts.minute) || parts.minute < 0 || parts.minute > 59) {
    return false;
  }
  if (!Number.isInteger(parts.second) || parts.second < 0 || parts.second > 59) {
    return false;
  }
  if (
    !Number.isInteger(parts.millisecond) ||
    parts.millisecond < 0 ||
    parts.millisecond > 999
  ) {
    return false;
  }

  return true;
}

function millisecondsFromFraction(value: string | undefined): number {
  if (!value) return 0;
  return Number(value.slice(0, 3).padEnd(3, "0"));
}

function timezoneOffsetMs(
  instantMs: number,
  timeZone: string,
): number {
  const wholeSecondMs = Math.trunc(instantMs / 1000) * 1000;

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(wholeSecondMs));

  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");

  const representedAsUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );

  return representedAsUtc - wholeSecondMs;
}

function localPartsToUtcMs(
  parts: IqLocalDateTimeParts,
  timeZone: string,
): number | null {
  if (!validParts(parts)) return null;

  const representedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
  );

  try {
    let candidate = representedAsUtc;

    // Dos pasadas suelen bastar; tres protege cambios historicos de offset.
    for (let i = 0; i < 3; i += 1) {
      const offset = timezoneOffsetMs(candidate, timeZone);
      const next = representedAsUtc - offset;
      if (next === candidate) break;
      candidate = next;
    }

    return Number.isFinite(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

function parseNaiveIqLocal(
  text: string,
  timeZone: string,
): number | null {
  const ymd = text.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?)?$/,
  );

  if (ymd) {
    const [
      ,
      year,
      month,
      day,
      hour = "0",
      minute = "0",
      second = "0",
      fraction,
    ] = ymd;

    return localPartsToUtcMs(
      {
        year: Number(year),
        month: Number(month),
        day: Number(day),
        hour: Number(hour),
        minute: Number(minute),
        second: Number(second),
        millisecond: millisecondsFromFraction(fraction),
      },
      timeZone,
    );
  }

  const dmy = text.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?)?$/,
  );

  if (dmy) {
    const [
      ,
      day,
      month,
      year,
      hour = "0",
      minute = "0",
      second = "0",
      fraction,
    ] = dmy;

    return localPartsToUtcMs(
      {
        year: Number(year),
        month: Number(month),
        day: Number(day),
        hour: Number(hour),
        minute: Number(minute),
        second: Number(second),
        millisecond: millisecondsFromFraction(fraction),
      },
      timeZone,
    );
  }

  return null;
}

export function parseIqDateTimeMs(
  value: unknown,
  timeZone = IQ_CANONICAL_TIME_ZONE,
): number | null {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const text = clean(value);
  if (!text) return null;

  const hasExplicitZone =
    /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text);

  if (hasExplicitZone) {
    let normalized = text.replace(
      /^(\d{4}-\d{2}-\d{2})\s+/,
      "$1T",
    );

    normalized = normalized.replace(
      /([+-]\d{2})(\d{2})$/,
      "$1:$2",
    );

    const direct = Date.parse(normalized);
    return Number.isFinite(direct) ? direct : null;
  }

  // IMPORTANTE: un timestamp IQ sin zona NUNCA cae en Date.parse().
  return parseNaiveIqLocal(text, timeZone);
}