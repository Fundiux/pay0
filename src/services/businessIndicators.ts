import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebaseClient";

export type PendingBucket = { facturas: number; monto: number; otrasMonedas: number };
export type BusinessIndicators = {
  ok: boolean;
  periodo: { desde: string; hasta: string };
  pagos: { total: number; montoPorMoneda: Record<string, number> };
  solicitudes: { total: number; conFactura: number; sinFactura: number; facturasCanceladasExcluidas: number };
  relacionadas: { conPagoAplicado: number; sinPagoAplicado: number };
  pendientes: { PPD: PendingBucket; PUE: PendingBucket; SIN_TIPO: PendingBucket };
  clienteConMasPendientes: { clienteId: string; cliente: string; facturas: number; monto: number } | null;
  mejorClientePorUtilidad: { clienteId: string; cliente: string; utilidad: number; operaciones: number } | null;
  advertencias: string[];
};

export async function getBusinessIndicators(period?: { desde: string; hasta: string }) {
  return (await httpsCallable<{ desde?: string; hasta?: string }, BusinessIndicators>(functions, "getBusinessIndicators")(period || {})).data;
}
