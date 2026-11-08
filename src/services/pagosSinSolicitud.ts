import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebaseClient";

export type PagoSinSolicitudDecisionOption = "FACTURAR_PUE" | "ESPERAR_FACTURA" | "APLICAR_A_FACTURA_EXISTENTE" | "DEVOLVER";
export type PagoSinSolicitudRow = {
  pagoId: string; folio: string; clienteId: string; clienteNombre: string; monto: number; moneda: string; fecha: string;
  case: "A" | "B"; reason: string; pendingCount: number; classifiedAt: string | null;
  latestDecision: { option: string; decidedByName: string; decidedAt: string | null; note: string } | null;
};
export type PagosSinSolicitudList = { ok: boolean; rows: PagoSinSolicitudRow[]; truncated: boolean };

export async function listPagosSinSolicitud() {
  return (await httpsCallable<Record<string, never>, PagosSinSolicitudList>(functions, "listPagosSinSolicitud")({})).data;
}

export async function decidePagoSinSolicitud(input: { pagoId: string; option: PagoSinSolicitudDecisionOption; note: string; requestId: string }) {
  return (await httpsCallable<typeof input, { ok: boolean; reused: boolean; decisionId: string }>(functions, "decidePagoSinSolicitud")(input)).data;
}
