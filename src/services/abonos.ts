"use client";

import { functions } from "@/lib/firebaseClient";
import { toPositiveNumber } from "@/lib/validators";
import { httpsCallable } from "firebase/functions";

export async function applySolicitudAbono(params: { solicitudId: string; monto: number | string }) {
  const monto = toPositiveNumber(params.monto);
const fn = httpsCallable(functions, "applyAbono");

  try {
    const res: any = await fn({ solicitudId: params.solicitudId, monto });
return res?.data ?? res;
  } catch (error: any) {
    console.error("[FRONT][applySolicitudAbono] error", {
      solicitudId: params.solicitudId,
      monto,
      code: error?.code,
      message: error?.message,
      details: error?.details,
      fullError: error,
    });

    throw error;
  }
}

