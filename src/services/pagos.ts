"use client";

import { functions } from "@/lib/firebaseClient";
import { httpsCallable } from "firebase/functions";

export async function createPago(input: {
  clienteId: string;
  companyId: string;
  despachoId?: string;
  empresaNombre?: string;
  operationTypeKey?: string;
  saleTypeKey?: string;
  pricingMode?: string;
  calculationBaseType?: string;
  finalClientRate?: number | string | null;
  montoTotal: number | string;
  fechaPago?: string;
  referencia?: string;
  moneda?: string;
  notaInicial?: string;
}) {
  const fn = httpsCallable(functions, "createPago");
  const res: any = await fn(input);
  return res?.data ?? res;
}

export async function changePagoStatus(params: {
  pagoId: string;
  newStatus?: string;
  conciliationNote?: string;
  hasUnreadMsg?: boolean;
}) {
  const fn = httpsCallable(functions, "changePagoStatus");
  const res: any = await fn(params);
  return res?.data ?? res;
}

export async function addPagoNota(params: {
  pagoId: string;
  text: string;
}) {
  const fn = httpsCallable(functions, "addPagoNota");
  const res: any = await fn(params);
  return res?.data ?? res;
}

export function createPagoApplicationIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `payapp-${crypto.randomUUID()}`;
  }

  return `payapp-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
}

export async function reservePagoApplicationBatch(params: {
  pagoId: string;
  aplicaciones: Array<{
    solicitudId: string;
    montoAplicado: number | string;
  }>;
  idempotencyKey: string;
}) {
  const fn = httpsCallable(functions, "reservePagoApplicationBatch");
  const res: any = await fn(params);
  return res?.data ?? res;
}

export async function applyPagoToSolicitudesAtomic(params: {
  pagoId: string;
  aplicaciones: Array<{
    solicitudId: string;
    montoAplicado: number | string;
  }>;
  idempotencyKey: string;
}) {
  const fn = httpsCallable(functions, "applyPagoToSolicitudesAtomic");
  const res: any = await fn(params);
  return res?.data ?? res;
}

export async function preparePagoApplicationIqPlan(params: {
  pagoId: string;
  aplicaciones: Array<{
    solicitudId: string;
    montoAplicado: number | string;
  }>;
  idempotencyKey: string;
}) {
  const fn = httpsCallable(functions, "preparePagoApplicationIqPlan");
  const res: any = await fn(params);
  return res?.data ?? res;
}

export async function applyPagoToSolicitud(params: {
  pagoId: string;
  solicitudId: string;
  montoAplicado: number | string;
  idempotencyKey?: string;
}) {
  return applyPagoToSolicitudesAtomic({
    pagoId: params.pagoId,
    idempotencyKey:
      String(params.idempotencyKey || "").trim() ||
      createPagoApplicationIdempotencyKey(),
    aplicaciones: [
      {
        solicitudId: params.solicitudId,
        montoAplicado: params.montoAplicado,
      },
    ],
  });
}

export async function executePagoApplicationIqPlan(params: {
  planId: string;
  planHash: string;
  confirmExecution: true;
}) {
  const fn = httpsCallable(functions, "executePagoApplicationIqPlan", {
    timeout: 300_000,
  });
  const res: any = await fn(params);
  return res?.data ?? res;
}

export async function diagnosePagoApplicationIqMethods(params: {
  planId: string;
  planHash: string;
}) {
  const fn = httpsCallable(functions, "diagnosePagoApplicationIqMethods", {
    timeout: 300_000,
  });
  const res: any = await fn(params);
  return res?.data ?? res;
}

export async function resumePagoApplicationIqPlan(params: {
  pagoId: string;
}) {
  const fn = httpsCallable(functions, "resumePagoApplicationIqPlan");
  const res: any = await fn(params);
  return res?.data ?? res;
}


