type Stage = "document_finalized_at" | "pay0_persisted_at" | "iq_dispatch_at" | "iq_response_at" | "firestore_iq_update_at";

/** Temporary opt-in diagnostic: IDs and timestamps only, never request data. */
export function operationTiming(stage: Stage, operationId: string, startedAt?: number): number {
  const at = Date.now();
  if (process.env.PAY0_OPERATION_TIMING === "1") {
    console.info("PAY0_OPERATION_TIMING", {
      stage, operationId, at,
      ...(startedAt === undefined ? {} : { elapsedMs: at - startedAt }),
    });
  }
  return at;
}
