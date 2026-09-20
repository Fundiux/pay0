import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebaseClient";
import type { SolicitudStatus, SatMotivoCancelacion } from "@/lib/solicitudStatus";

export type CreateSolicitudInput = {
  clienteId: string;
  companyId: string;
  despachoId?: string;
  operationTypeKey?: string;
  monto: number;
  tipoFactura: "PUE" | "PPD" | string;
  comentario?: string;
  clienteNombre?: string;
  empresaNombre?: string;
  replacementOfSolicitudId?: string;
  replacementReason?: string;
};

export async function createSolicitud(input: CreateSolicitudInput) {
  const fn = httpsCallable(functions, "createSolicitud");
  return await fn(input);
}

export type SolicitudPageCursor = { seconds: number; nanoseconds: number; id: string };
export async function listSolicitudes(input: {
  limit?: number;
  fromMillis?: number;
  toMillis?: number;
  cursorSeconds?: number;
  cursorNanoseconds?: number;
  cursorId?: string;
} = {}): Promise<{ items: any[]; hasMore: boolean; nextCursor: SolicitudPageCursor | null }> {
  const fn = httpsCallable<typeof input, { items: any[]; hasMore: boolean; nextCursor: SolicitudPageCursor | null }>(functions, "listSolicitudes");
  const response = await fn(input);
  return response.data;
}

export async function cancelSolicitud(params: {
  solicitudId: string;
  motivo?: string;
  motivoCancelacionSAT?: SatMotivoCancelacion;
  motivoCancelacionDetalle?: string;
  uuidCfdiSustituto?: string;
  relatedSolicitudId?: string;
}) {
  const fn = httpsCallable(functions, "cancelSolicitud");
  return await fn(params);
}

export async function changeSolicitudStatus(params: {
  solicitudId: string;
  newStatus?: SolicitudStatus;
  ocultar?: boolean;
  hasUnreadMsg?: boolean;
  motivo?: string;
  motivoRechazo?: string;
  motivoRechazoDetalle?: string;
  motivoCancelacionSAT?: SatMotivoCancelacion;
  motivoCancelacionDetalle?: string;
  relatedSolicitudId?: string;
  uuidCfdiSustituido?: string;
  uuidCfdiSustituto?: string;
}) {
  const fn = httpsCallable(functions, "changeSolicitudStatus");
  return await fn(params);
}

export async function addSolicitudNota(params: { solicitudId: string; text: string }) {
  const fn = httpsCallable(functions, "addSolicitudNota");
  return await fn(params);
}
