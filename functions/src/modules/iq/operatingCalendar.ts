export type IqOperatingPurpose =
  | "CREATION"
  | "RECONCILIATION"
  | "INVOICE";

export type IqOperatingWindow = {
  start: string;
  end: string;
};

export type IqDateOverride = {
  closed?: boolean;
  windows?: IqOperatingWindow[];
};

export type IqAutomationFlowConfig = {
  solicitudes: boolean;
  pagos: boolean;
  aplicacionPagos: boolean;
  dispersiones: boolean;
  crearCliente: boolean;
  cancelarSolicitud: boolean;
};

// Las etapas tecnicas conservan intervalos independientes,
// pero ya no son switches de habilitacion.
// H4_D87_A58_A9_PROCESS_INTERVALS_BACKEND
export type IqAutomationProcessIntervals = {
  discovery: number;
  invoiceImport: number;
  statusMonitor: number;
  solicitudCreate: number;
  solicitudReconciliation: number;
  pagoCreate: number;
  pagoReconciliation: number;
  dispersionCreate: number;
  paymentApplicationExecution: number;
};

// H4_D82_A3_A6_A3C_AUTOMATION_CONTROL
export type IqOperatingCalendarConfig = {
  enabled: boolean;
  timezone: string;
  weeklyWindows: Record<string, IqOperatingWindow[]>;
  holidays: string[];
  dateOverrides: Record<string, IqDateOverride>;
  creationCutoffMinutes: number;
  reconciliationCutoffMinutes: number;
  invoiceCutoffMinutes: number;
  queueDrainSeconds: number;
  automation: IqAutomationFlowConfig;
  intervalMinutes?: IqAutomationProcessIntervals;
};

export type IqOperatingDecision = {
  allowed: boolean;
  configured: boolean;
  reason:
    | "OPEN"
    | "CONFIG_NOT_READY"
    | "INTEGRATION_DISABLED"
    | "CLOSED_DAY"
    | "BEFORE_OPENING"
    | "AFTER_CUTOFF"
    | "AFTER_CLOSING";
  timezone: string;
  localDate: string;
  localTime: string;
  window: IqOperatingWindow | null;
  nextEligibleAt: Date | null;
};

const DEFAULT_TIMEZONE = "America/Mexico_City";

const WEEKDAY_KEYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

function cleanText(value: unknown): string {
  return String(value ?? "").trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function isValidTime(value: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(value)) {
    return false;
  }

  const [hour, minute] = value.split(":").map(Number);

  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

function timeToMinutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function sanitizeWindows(value: unknown): IqOperatingWindow[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      const record = asRecord(entry);
      return {
        start: cleanText(record.start),
        end: cleanText(record.end),
      };
    })
    .filter((window) => {
      return (
        isValidTime(window.start) &&
        isValidTime(window.end) &&
        timeToMinutes(window.end) > timeToMinutes(window.start)
      );
    })
    .sort((left, right) => timeToMinutes(left.start) - timeToMinutes(right.start));
}

export function normalizeIqOperatingCalendarConfig(
  value: unknown,
): IqOperatingCalendarConfig {
  const record = asRecord(value);
  const weeklyInput = asRecord(record.weeklyWindows);
  const weeklyWindows: Record<string, IqOperatingWindow[]> = {};

  for (const day of WEEKDAY_KEYS) {
    weeklyWindows[day] = sanitizeWindows(weeklyInput[day]);
  }

  const holidays = Array.isArray(record.holidays)
    ? record.holidays
        .map(cleanText)
        .filter((entry) => /^\d{4}-\d{2}-\d{2}$/.test(entry))
    : [];

  const dateOverridesInput = asRecord(record.dateOverrides);
  const dateOverrides: Record<string, IqDateOverride> = {};
  const automationInput = asRecord(record.automation);
  const intervalInput = asRecord(record.intervalMinutes);

  for (const [date, rawOverride] of Object.entries(dateOverridesInput)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      continue;
    }

    const override = asRecord(rawOverride);
    const normalizedOverride: IqDateOverride = {
      closed: override.closed === true,
    };

    if (Array.isArray(override.windows)) {
      normalizedOverride.windows = sanitizeWindows(override.windows);
    }

    dateOverrides[date] = normalizedOverride;
  }

  return {
    enabled: record.enabled === true,
    timezone: cleanText(record.timezone) || DEFAULT_TIMEZONE,
    weeklyWindows,
    holidays,
    dateOverrides,
    creationCutoffMinutes: clampInteger(
      record.creationCutoffMinutes,
      20,
      0,
      180,
    ),
    reconciliationCutoffMinutes: clampInteger(
      record.reconciliationCutoffMinutes,
      5,
      0,
      180,
    ),
    invoiceCutoffMinutes: clampInteger(
      record.invoiceCutoffMinutes,
      10,
      0,
      180,
    ),
    queueDrainSeconds: clampInteger(record.queueDrainSeconds, 15, 0, 120),
    intervalMinutes: {
      discovery: clampInteger(intervalInput.discovery, 20, 5, 1440),
      invoiceImport: clampInteger(intervalInput.invoiceImport, 20, 5, 1440),
      statusMonitor: clampInteger(intervalInput.statusMonitor, 20, 5, 1440),
      solicitudCreate: clampInteger(intervalInput.solicitudCreate, 1, 1, 1440),
      solicitudReconciliation: clampInteger(
        intervalInput.solicitudReconciliation,
        10,
        5,
        1440,
      ),
      pagoCreate: clampInteger(intervalInput.pagoCreate, 1, 1, 1440),
      pagoReconciliation: clampInteger(
        intervalInput.pagoReconciliation,
        20,
        5,
        1440,
      ),
      dispersionCreate: clampInteger(
        intervalInput.dispersionCreate,
        5,
        5,
        1440,
      ),
      paymentApplicationExecution: clampInteger(
        intervalInput.paymentApplicationExecution,
        5,
        5,
        1440,
      ),
    },
    automation: {
      solicitudes: automationInput.solicitudes === true,
      pagos: automationInput.pagos === true,
      aplicacionPagos: automationInput.aplicacionPagos === true,
      dispersiones: automationInput.dispersiones === true,
      crearCliente: automationInput.crearCliente === true,
      cancelarSolicitud: automationInput.cancelarSolicitud === true,
    },
  };
}

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: string;
};

function getZonedParts(date: Date, timezone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    weekday: "long",
  });

  const parts = formatter.formatToParts(date);
  const map = parts.reduce<Record<string, string>>((acc, part) => {
    if (part.type !== "literal") {
      acc[part.type] = part.value;
    }
    return acc;
  }, {});

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
    weekday: cleanText(map.weekday).toLowerCase(),
  };
}

function formatDateKey(parts: Pick<ZonedParts, "year" | "month" | "day">): string {
  return [
    String(parts.year).padStart(4, "0"),
    String(parts.month).padStart(2, "0"),
    String(parts.day).padStart(2, "0"),
  ].join("-");
}

function formatTimeKey(parts: Pick<ZonedParts, "hour" | "minute">): string {
  return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

function getTimezoneOffsetMs(date: Date, timezone: string): number {
  const parts = getZonedParts(date, timezone);
  const representedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );

  return representedAsUtc - date.getTime();
}

function zonedDateTimeToUtc(input: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  timezone: string;
}): Date {
  const targetUtc = Date.UTC(
    input.year,
    input.month - 1,
    input.day,
    input.hour,
    input.minute,
    0,
  );

  let candidate = new Date(targetUtc);

  for (let iteration = 0; iteration < 3; iteration += 1) {
    const offset = getTimezoneOffsetMs(candidate, input.timezone);
    candidate = new Date(targetUtc - offset);
  }

  return candidate;
}

function addLocalDays(
  parts: Pick<ZonedParts, "year" | "month" | "day">,
  days: number,
): Pick<ZonedParts, "year" | "month" | "day"> {
  const utc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));

  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
  };
}

function getWeekdayKey(
  dateParts: Pick<ZonedParts, "year" | "month" | "day">,
  timezone: string,
): string {
  const midday = zonedDateTimeToUtc({
    ...dateParts,
    hour: 12,
    minute: 0,
    timezone,
  });

  return getZonedParts(midday, timezone).weekday;
}

function getWindowsForDate(
  config: IqOperatingCalendarConfig,
  dateParts: Pick<ZonedParts, "year" | "month" | "day">,
): IqOperatingWindow[] {
  const dateKey = formatDateKey(dateParts);
  const override = config.dateOverrides[dateKey];

  if (override?.closed === true) {
    return [];
  }

  if (override?.windows) {
    return override.windows;
  }

  if (config.holidays.includes(dateKey)) {
    return [];
  }

  const weekday = getWeekdayKey(dateParts, config.timezone);
  return config.weeklyWindows[weekday] ?? [];
}

function getCutoffMinutes(
  config: IqOperatingCalendarConfig,
  purpose: IqOperatingPurpose,
): number {
  if (purpose === "CREATION") {
    return config.creationCutoffMinutes;
  }

  if (purpose === "INVOICE") {
    return config.invoiceCutoffMinutes;
  }

  return config.reconciliationCutoffMinutes;
}

function buildWindowStart(
  dateParts: Pick<ZonedParts, "year" | "month" | "day">,
  time: string,
  timezone: string,
): Date {
  const [hour, minute] = time.split(":").map(Number);

  return zonedDateTimeToUtc({
    ...dateParts,
    hour,
    minute,
    timezone,
  });
}

function findNextEligibleAt(
  config: IqOperatingCalendarConfig,
  now: Date,
  purpose: IqOperatingPurpose,
): Date | null {
  const localNow = getZonedParts(now, config.timezone);
  const cutoff = getCutoffMinutes(config, purpose);

  for (let offsetDays = 0; offsetDays <= 21; offsetDays += 1) {
    const dateParts = addLocalDays(localNow, offsetDays);
    const windows = getWindowsForDate(config, dateParts);

    for (const window of windows) {
      const startAt = buildWindowStart(dateParts, window.start, config.timezone);
      const endAt = buildWindowStart(dateParts, window.end, config.timezone);
      const cutoffAt = new Date(endAt.getTime() - cutoff * 60_000);

      if (cutoffAt.getTime() <= startAt.getTime()) {
        continue;
      }

      if (startAt.getTime() >= now.getTime()) {
        return startAt;
      }

      if (
        offsetDays === 0 &&
        now.getTime() >= startAt.getTime() &&
        now.getTime() < cutoffAt.getTime()
      ) {
        return now;
      }
    }
  }

  return null;
}

export function evaluateIqOperatingWindow(
  configInput: unknown,
  now: Date,
  purpose: IqOperatingPurpose,
): IqOperatingDecision {
  const config = normalizeIqOperatingCalendarConfig(configInput);
  const localNow = getZonedParts(now, config.timezone);
  const localDate = formatDateKey(localNow);
  const localTime = formatTimeKey(localNow);
  const configured = Object.values(config.weeklyWindows).some(
    (windows) => windows.length > 0,
  );

  if (!configured) {
    return {
      allowed: false,
      configured: false,
      reason: "CONFIG_NOT_READY",
      timezone: config.timezone,
      localDate,
      localTime,
      window: null,
      nextEligibleAt: null,
    };
  }

  if (!config.enabled) {
    return {
      allowed: false,
      configured: true,
      reason: "INTEGRATION_DISABLED",
      timezone: config.timezone,
      localDate,
      localTime,
      window: null,
      nextEligibleAt: null,
    };
  }

  const dateParts = {
    year: localNow.year,
    month: localNow.month,
    day: localNow.day,
  };
  const windows = getWindowsForDate(config, dateParts);
  const currentMinutes = localNow.hour * 60 + localNow.minute;
  const cutoff = getCutoffMinutes(config, purpose);

  for (const window of windows) {
    const startMinutes = timeToMinutes(window.start);
    const endMinutes = timeToMinutes(window.end);
    const cutoffMinutes = endMinutes - cutoff;

    if (currentMinutes < startMinutes) {
      return {
        allowed: false,
        configured: true,
        reason: "BEFORE_OPENING",
        timezone: config.timezone,
        localDate,
        localTime,
        window,
        nextEligibleAt: buildWindowStart(dateParts, window.start, config.timezone),
      };
    }

    if (currentMinutes >= startMinutes && currentMinutes < cutoffMinutes) {
      return {
        allowed: true,
        configured: true,
        reason: "OPEN",
        timezone: config.timezone,
        localDate,
        localTime,
        window,
        nextEligibleAt: now,
      };
    }

    if (currentMinutes >= cutoffMinutes && currentMinutes < endMinutes) {
      return {
        allowed: false,
        configured: true,
        reason: "AFTER_CUTOFF",
        timezone: config.timezone,
        localDate,
        localTime,
        window,
        nextEligibleAt: findNextEligibleAt(config, new Date(now.getTime() + 60_000), purpose),
      };
    }
  }

  const nextEligibleAt = findNextEligibleAt(config, now, purpose);

  return {
    allowed: false,
    configured: true,
    reason: windows.length === 0 ? "CLOSED_DAY" : "AFTER_CLOSING",
    timezone: config.timezone,
    localDate,
    localTime,
    window: null,
    nextEligibleAt,
  };
}

export function getIqReconciliationDelayMs(attemptCount: number): number {
  if (attemptCount <= 0) {
    return 2 * 60_000;
  }

  if (attemptCount === 1) {
    return 5 * 60_000;
  }

  if (attemptCount === 2) {
    return 15 * 60_000;
  }

  return 30 * 60_000;
}

