import { isConfirmedFacturamaCancellation } from "./cancellationStatus";
import type { FacturamaRep } from "./repCancellation";

// The SAT closes a cancellation in at most 72 hours (the receiver may have to accept it). After that the cancellation is
// requested again and the internal group is told, so the team can ask the client to accept it.
export const CANCELLATION_WAIT_MS = 72 * 60 * 60 * 1000;

export type OriginalState = { state: "NOT_REQUESTED" | "REQUESTED" | "CANCELED"; requestedAtMs: number };

export type ProcessPorts = {
  nowMs(): number;
  reps(): Promise<FacturamaRep[]>;
  /** The SAT already reports the complement as cancelled. Read-only. */
  repSatCancelled(rep: FacturamaRep): Promise<boolean>;
  /** Sends the cancellation of one complement to Facturama and records it. Returns the provider status. */
  requestRepCancel(rep: FacturamaRep): Promise<string>;
  /** Marks the complement cancelled. */
  markRepCancelled(rep: FacturamaRep): Promise<void>;
  /** Saves the complement's cancellation receipt once; the upload goes to the client by itself. Never throws. */
  saveRepAcuse(rep: FacturamaRep): Promise<void>;
  original(): Promise<OriginalState>;
  /** Cancels the original invoice. Only called when every complement is cancelled. */
  requestOriginal(): Promise<void>;
  /** Tells the internal group. One call per re-request, never more. */
  alert(input: { kind: "REP" | "ORIGINAL"; installment?: number; attempt: number }): Promise<void>;
};

export type ProcessSummary = {
  phase: "REPS" | "ORIGINAL" | "DONE";
  actions: string[];
};

/**
 * One idempotent pass of the cancellation of an invoice that has payment complements. It can run as often as needed:
 * - the complements are cancelled first, each one on its own;
 * - the original invoice is cancelled only when EVERY complement is effectively cancelled;
 * - whatever is not confirmed stays pending, nothing is cancelled early;
 * - after 72 hours without confirmation the request is repeated once and the internal group is told.
 */
export async function advanceCancellation(ports: ProcessPorts, options: { repsOnly?: boolean } = {}): Promise<ProcessSummary> {
  const actions: string[] = [];
  const now = ports.nowMs();
  const reps = await ports.reps();
  let pending = 0;
  for (const rep of reps) {
    if (isConfirmedFacturamaCancellation(rep.cancellationStatus)) {
      if (!rep.receiptUploadId) { await ports.saveRepAcuse(rep); actions.push(`ACUSE_REP_${rep.installment}`); }
      continue;
    }
    if (rep.cancellationRequestedAtMs && await ports.repSatCancelled(rep)) {
      await ports.markRepCancelled(rep);
      await ports.saveRepAcuse(rep);
      actions.push(`REP_${rep.installment}_CANCELADO`);
      continue;
    }
    if (!rep.cancellationRequestedAtMs) {
      const status = await ports.requestRepCancel(rep);
      actions.push(`REP_${rep.installment}_SOLICITADO`);
      if (isConfirmedFacturamaCancellation(status)) { await ports.markRepCancelled(rep); await ports.saveRepAcuse(rep); actions.push(`REP_${rep.installment}_CANCELADO`); continue; }
    } else if (now - rep.cancellationRequestedAtMs >= CANCELLATION_WAIT_MS) {
      await ports.alert({ kind: "REP", installment: rep.installment, attempt: rep.cancellationAttempts + 1 });
      const status = await ports.requestRepCancel(rep);
      actions.push(`REP_${rep.installment}_REINTENTO`);
      if (isConfirmedFacturamaCancellation(status)) { await ports.markRepCancelled(rep); await ports.saveRepAcuse(rep); actions.push(`REP_${rep.installment}_CANCELADO`); continue; }
    }
    pending += 1;
  }
  if (pending) return { phase: "REPS", actions };
  // The substitution route cancels the original itself, right after the complements.
  if (options.repsOnly) return { phase: "ORIGINAL", actions };

  const original = await ports.original();
  if (original.state === "CANCELED") return { phase: "DONE", actions };
  if (original.state === "NOT_REQUESTED") { await ports.requestOriginal(); actions.push("ORIGINAL_SOLICITADA"); return { phase: "ORIGINAL", actions }; }
  if (now - original.requestedAtMs >= CANCELLATION_WAIT_MS) {
    await ports.alert({ kind: "ORIGINAL", attempt: 2 });
    await ports.requestOriginal();
    actions.push("ORIGINAL_REINTENTO");
  }
  return { phase: "ORIGINAL", actions };
}

export function alertText(input: { kind: "REP" | "ORIGINAL"; clientName: string; folio: string; installment?: number }): string {
  const what = input.kind === "REP" ? `el complemento de pago${input.installment ? ` (parcialidad ${input.installment})` : ""} de la factura ${input.folio}` : `la factura ${input.folio}`;
  return `No se pudo cancelar ${what} de ${input.clientName || "el cliente"}: falló o requería la aceptación del cliente y no se obtuvo en 72 horas. Ya volví a solicitar la cancelación. Si el cliente debe aceptarla, avísale.`;
}
