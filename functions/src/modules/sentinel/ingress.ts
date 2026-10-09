import type { ObservationDetector, IngestResult } from "./detector";
import type { VerifiedIngress } from "./schema";

/** The verifier must authenticate transport and bind scope from server records.
 * No Firebase/HTTP entry is exported until its IAM and persistence capability
 * are connected and reviewed. The body is never used as verification context.
 */
export function createObservationIngress<Envelope>(dependencies: {
  verifyEnvelope: (envelope: Envelope) => Promise<VerifiedIngress>;
  readEvent: (envelope: Envelope) => unknown;
  detector: ObservationDetector;
}): (envelope: Envelope) => Promise<IngestResult> {
  return async envelope => {
    let context: VerifiedIngress;
    try { context = await dependencies.verifyEnvelope(envelope); }
    catch { return { decision: "OBSERVE_ONLY", restricted: false, outcome: "INVALID_ORIGIN" }; }
    try { return await dependencies.detector.ingest(dependencies.readEvent(envelope), context); }
    catch { return { decision: "OBSERVE_ONLY", restricted: false, outcome: "INVALID_EVENT" }; }
  };
}
