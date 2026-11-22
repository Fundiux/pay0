import { onDocumentWritten } from "firebase-functions/v2/firestore";

import { IQ_CANCELLATION_CREDENTIALS_KEY } from "../iq/solicitudCancellationService";
import { methodAccountRef } from "./iqCatalogDomain";
import { productionIqLinkPorts } from "./iqLinkPorts";
import { linkOrCreateMethod } from "./iqLinkService";

const text = (value: unknown) => String(value ?? "").trim();

// Fires when a beneficiary account is uploaded or its destination changes. The link write itself
// re-fires this trigger, so only a changed account (CLABE or card) starts new work.
// One instance overflowed during the nightly burst (2026-11-14: 141 "no available instance" aborts). A few
// instances are safe: the create is decided by the reservation transaction (one per account and catalog),
// IQ traffic stays bounded by the safety runtime, and the nightly catalog pass no longer rewrites unchanged links.
export const linkBeneficiaryMethodToIq = onDocumentWritten({ document: "clientBeneficiaryMethods/{methodId}", region: "us-central1", retry: true, maxInstances: 5, concurrency: 1, timeoutSeconds: 300, memory: "512MiB", secrets: [IQ_CANCELLATION_CREDENTIALS_KEY] }, async event => {
  const after = event.data?.after;
  if (!after?.exists) return;
  const method = after.data() || {};
  const account = methodAccountRef(method);
  if (!account || method.active === false) return;
  const before = event.data?.before;
  const beforeAccount = before?.exists ? methodAccountRef(before.data() || {}) : null;
  const linkedEntries = (method.iqLinksByCatalog ?? {}) as Record<string, any>;
  const alreadyHandled = Object.keys(linkedEntries).length > 0 && Object.values(linkedEntries).every(entry => entry?.key === account.key);
  // Same account as before and every catalog entry already points at it: nothing new to link.
  if (beforeAccount?.key === account.key && alreadyHandled) return;
  let deferred = false;
  try {
    const outcomes = await linkOrCreateMethod({ methodId: text(event.params.methodId), ports: productionIqLinkPorts });
    // IN_PROGRESS: another instance holds the create for this account; the retry links this method to its result.
    deferred = outcomes.some(outcome => outcome.status === "DEFERRED" || outcome.status === "IN_PROGRESS");
  } catch (error) {
    console.error("IQ_BENEFICIARY_LINK_FAILED", text(event.params.methodId), text(error instanceof Error ? error.message : error).slice(0, 200));
  }
  // Only a "not now" from the safety runtime is retried (with the platform's backoff); real failures are not.
  if (deferred) throw new Error("IQ_BENEFICIARY_LINK_DEFERRED");
});
