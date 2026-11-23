import { onDocumentCreated } from "firebase-functions/v2/firestore";

import * as admin from "firebase-admin";

import { readEnabledIqAutomationRoots } from "./automationRuntime";
import {
  IQ_CREDENTIALS_KEY,
  buildDispersionSchedulerAuth,
  isDispersionCreateSchedulerCandidate,
  runCreateClientDispersionIqCore,
} from "./dispersionCreationCallables";
import { syncDispersionIqIncident } from "./dispersionIqIncident";
import { PERSONAL_COMMISSION_ACCOUNT_KEY } from "../commissionDistributions/privateBankInstrument";

const text = (value: unknown) => String(value ?? "").trim();

// Sends a new client dispersion to IQ as soon as it is created, so nobody has to press a button or wait
// for the 5 minute scheduler. It applies the same gates as processIqDispersionCreate (master switch,
// dispersion flow, candidate rules; creation never waits for the operating window) and the same core, whose per-leg transaction lock
// and retry block keep a second runner (the scheduler) from sending the same leg twice.
// It does not retry on failure: the scheduler is the safety net, and a failed-safe leg stays held.
export const sendNewDispersionToIq = onDocumentCreated(
  {
    document: "clientDispersions/{dispersionId}",
    region: "us-central1",
    retry: false,
    // One warm instance: a cold start of this 2 GiB function took long enough for a person to press the
    // old manual button before the automatic send began.
    minInstances: 1,
    maxInstances: 1,
    concurrency: 1,
    timeoutSeconds: 540,
    memory: "2GiB",
    secrets: [IQ_CREDENTIALS_KEY, PERSONAL_COMMISSION_ACCOUNT_KEY],
  },
  async (event) => {
    const dispersionId = text(event.params.dispersionId);
    const principal = (event.data?.data() || {}) as Record<string, unknown>;
    const rootId = text(principal.rootId);
    if (!dispersionId || !rootId) return;

    try {
      const enabledRoots = await readEnabledIqAutomationRoots({
        process: "dispersionCreate",
        purpose: "CREATION",
        respectWindow: false,
      });
      if (!enabledRoots.has(rootId)) return;
      if (!isDispersionCreateSchedulerCandidate(principal, rootId)) return;

      const auth = await buildDispersionSchedulerAuth(principal, rootId);
      await runCreateClientDispersionIqCore({ auth, dispersionId, previewOnly: false });
    } catch (error) {
      console.error("IQ_DISPERSION_CREATE_ON_CREATE_FAILED", {
        rootId,
        dispersionId,
        message: (error instanceof Error ? error.message : String(error)).slice(0, 200),
      });
      // The scheduler retries; until it succeeds the failure is visible as an incident (and closes itself then).
      await syncDispersionIqIncident({
        db: admin.firestore(), rootId, dispersionId, aggregateStatus: "IQ_ERROR_SEGURO",
        evidence: { source: "ON_CREATE", message: (error instanceof Error ? error.message : String(error)).slice(0, 200) },
      }).catch((incidentError) => console.error("DISPERSION_INCIDENT_SYNC_FAILED", dispersionId, String(incidentError?.message || incidentError).slice(0, 160)));
    }
  },
);
