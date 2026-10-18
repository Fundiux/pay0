import {
  FieldValue,
  Timestamp,
  getFirestore,
} from "firebase-admin/firestore";
import {
  evaluateIqOperatingWindow,
  normalizeIqOperatingCalendarConfig,
  type IqOperatingCalendarConfig,
  type IqOperatingPurpose,
} from "./operatingCalendar";

// H4_D82_A3_A6_A3C_AUTOMATION_CONTROL
export type IqAutomationProcessKey =
  | "discovery"
  | "invoiceImport"
  | "statusMonitor"
  | "solicitudCreate"
  | "solicitudReconciliation"
  | "pagoCreate"
  | "pagoReconciliation"
  // H4_D87_A58_A46_DISPERSION_CREATE_CONTRACT
  | "dispersionCreate"
  | "paymentApplicationExecution";

type IqAutomationFlowKey =
  keyof IqOperatingCalendarConfig["automation"];

function automationFlowForProcess(
  process: IqAutomationProcessKey,
): IqAutomationFlowKey {
  switch (process) {
    case "discovery":
    case "invoiceImport":
    case "statusMonitor":
    case "solicitudCreate":
    case "solicitudReconciliation":
      return "solicitudes";

    case "pagoCreate":
    case "pagoReconciliation":
      return "pagos";

    case "dispersionCreate":
      return "dispersiones";

    case "paymentApplicationExecution":
      return "aplicacionPagos";
  }
}

export async function isIqAutomationFlowEnabled(
  rootId: string,
  flow: IqAutomationFlowKey,
): Promise<boolean> {
  const cleanRootId = String(rootId || "").trim();

  if (!cleanRootId) {
    return false;
  }

  const snap = await getFirestore()
    .collection("iqIntegrationConfigs")
    .doc(cleanRootId)
    .get();

  if (!snap.exists) {
    return false;
  }

  const config =
    normalizeIqOperatingCalendarConfig(
      snap.data(),
    );

  return (
    config.enabled === true &&
    config.automation[flow] === true
  );
}

// H4_D87_A58_A14_INTERVAL_DUE_GATE
function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function toMillis(value: unknown): number {
  if (!value) return 0;

  const candidate = value as {
    toMillis?: () => number;
    seconds?: number;
  };

  if (typeof candidate.toMillis === "function") {
    return candidate.toMillis();
  }

  if (typeof candidate.seconds === "number") {
    return candidate.seconds * 1000;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  return 0;
}

function processIntervalMinutes(
  config: IqOperatingCalendarConfig,
  process: IqAutomationProcessKey,
): number {
  const configured = Number(config.intervalMinutes?.[process] ?? 5);

  if (!Number.isFinite(configured)) {
    return 5;
  }

  const minimum = process === "solicitudCreate" || process === "pagoCreate" ? 1 : 5;
  return Math.max(minimum, Math.min(1440, Math.floor(configured)));
}

async function claimIqAutomationProcessIfDue(input: {
  rootId: string;
  process: IqAutomationProcessKey;
  config: IqOperatingCalendarConfig;
  now: Date;
}): Promise<boolean> {
  const db = getFirestore();
  const ref = db.collection("iqIntegrationConfigs").doc(input.rootId);
  const intervalMs =
    processIntervalMinutes(input.config, input.process) * 60 * 1000;
  const nowMs = input.now.getTime();

  return db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);

    if (!snap.exists) {
      return false;
    }

    const liveRaw = asRecord(snap.data());
    const liveConfig = normalizeIqOperatingCalendarConfig(liveRaw);

    if (
      !liveConfig.enabled ||
      liveConfig.automation[automationFlowForProcess(input.process)] !== true
    ) {
      return false;
    }

    const runtime = asRecord(liveRaw.automationRuntime);
    const processRuntime = asRecord(runtime[input.process]);
    const lastClaimedMs = toMillis(processRuntime.lastClaimedAt);

    if (
      lastClaimedMs > 0 &&
      nowMs - lastClaimedMs < intervalMs
    ) {
      return false;
    }

    transaction.update(ref, {
      [`automationRuntime.${input.process}.lastClaimedAt`]:
        Timestamp.fromDate(input.now),
      [`automationRuntime.${input.process}.intervalMinutes`]:
        processIntervalMinutes(liveConfig, input.process),
      [`automationRuntime.${input.process}.updatedAt`]:
        FieldValue.serverTimestamp(),
    });

    return true;
  });
}

export async function loadEnabledIqAutomationRoots(input: {
  process: IqAutomationProcessKey;
  purpose?: IqOperatingPurpose;
  respectWindow?: boolean;
  now?: Date;
}): Promise<Map<string, IqOperatingCalendarConfig>> {
  const db = getFirestore();
  const snap = await db
    .collection("iqIntegrationConfigs")
    .limit(25)
    .get();

  const enabled = new Map<string, IqOperatingCalendarConfig>();
  const now = input.now ?? new Date();

  for (const doc of snap.docs) {
    const config = normalizeIqOperatingCalendarConfig(doc.data());

    if (!config.enabled) {
      continue;
    }

    if (config.automation[automationFlowForProcess(input.process)] !== true) {
      continue;
    }

    if (
      input.respectWindow !== false &&
      input.purpose
    ) {
      const decision = evaluateIqOperatingWindow(
        config,
        now,
        input.purpose,
      );

      if (!decision.allowed) {
        continue;
      }
    }

    const due = await claimIqAutomationProcessIfDue({
      rootId: doc.id,
      process: input.process,
      config,
      now,
    });

    if (!due) {
      continue;
    }

    enabled.set(doc.id, config);
  }

  return enabled;
}


