function enabled(): boolean {
  try { return sessionStorage.getItem("PAY0_OPERATION_TIMING") === "1"; }
  catch { return false; }
}

/** Temporary opt-in trace. Contains only operation IDs, stages and timings. */
export function beginOperationTiming() {
  const clickAt = Date.now();
  const start = performance.now();
  return (operationId: string) => {
    if (!enabled()) return;
    console.info("PAY0_OPERATION_TIMING", { stage: "ui_click_at", operationId, at: clickAt });
    requestAnimationFrame(() => {
      console.info("PAY0_OPERATION_TIMING", {
        stage: "ui_released_at", operationId, at: Date.now(),
        UI_LATENCY: Math.round(performance.now() - start),
      });
    });
  };
}

export function traceReactiveOperation(operationId: string, data: Record<string, any>) {
  if (!enabled()) return;
  const writes = [data.iqSyncUpdatedAt, data.iqDepositUpdatedAt, data.updatedAt]
    .map((timestamp) => typeof timestamp?.toMillis === "function" ? timestamp.toMillis() : 0);
  const writeAt = Math.max(...writes) || null;
  console.info("PAY0_OPERATION_TIMING", {
    stage: "ui_reactive_update_at", operationId, at: Date.now(),
    // An estimate across browser/server clocks, measured at listener delivery.
    REACTIVE_LATENCY_ESTIMATE: writeAt === null ? null : Date.now() - writeAt,
  });
}

export function traceDocumentOperation(stage: "document_upload_started_at" | "document_uploaded_at" | "document_finalized_at", operationId: string, at = Date.now()) {
  if (enabled()) console.info("PAY0_OPERATION_TIMING", { stage, operationId, at });
}
