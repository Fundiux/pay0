import { ToolRequest, ToolResult } from "./toolRouter";

const clean = (value: unknown, max = 1000) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
export type RecentEntity = { system: "PAY0"; type: "SOLICITUD" | "PAGO"; id: string; folio: string };
export type HugoMemory = { recommendations: any[]; rules: any[] };
export type ContextPiece = { kind: "FACT" | "MEMORY" | "INFERENCE" | "USER_STATEMENT" | "RULE" | "UNKNOWN"; sourceSystem: string; entityType?: string; entityId?: string; completeness: string };

export function requestedFolio(message: string, recentEntities: RecentEntity[] = []): string | null {
  const explicit = message.toUpperCase().match(/\b[SP]\d[A-Z0-9]{4,19}\b/)?.[0];
  if (explicit) return explicit;
  const type = /solicitud/i.test(message) ? "SOLICITUD" : /pago/i.test(message) ? "PAGO" : null;
  if (!type || !/\b(esa|ese|anterior|cu[aá]nto|por qu[eé])\b/i.test(message)) return null;
  const candidates = recentEntities.filter(row => row.type === type);
  return candidates.length === 1 ? candidates[0].folio : null;
}

export async function buildHugoContext(input: { message: string; recentEntities?: RecentEntity[]; memory: HugoMemory; router: { execute(request: ToolRequest): Promise<ToolResult> } }) {
  const folio = requestedFolio(input.message, input.recentEntities);
  const requests = [folio ? { name: "getSolicitud" as const, input: { folio } } : { name: "searchSolicitudes" as const, input: { limit: 40 } },
    folio ? { name: "getPago" as const, input: { folio } } : { name: "searchPagos" as const, input: { limit: 30 } },
    { name: "getPaymentComplementStatus" as const, input: folio ? { folio } : {} }, { name: "getIqCapabilities" as const, input: {} }];
  const [solicitudResult, pagoResult, complementResult, capabilityResult] = await Promise.all(requests.map(request => input.router.execute(request))) as ToolResult[];
  const solicitudes = Array.isArray(solicitudResult.data) ? solicitudResult.data : solicitudResult.data ? [solicitudResult.data] : [];
  const pagos = Array.isArray(pagoResult.data) ? pagoResult.data : pagoResult.data ? [pagoResult.data] : [];
  const selectedSolicitudes = folio ? solicitudes.filter(row => clean(row.folio || row.folioIq, 60).toUpperCase() === folio).slice(0, 3) : solicitudes.slice(0, 8);
  const selectedPagos = folio ? pagos.filter(row => clean(row.folio || row.folioIq, 60).toUpperCase() === folio).slice(0, 3) : pagos.slice(0, 6);
  const complements = complementResult.data || [];
  const context = {
    alcanceContexto: "Muestra reciente y búsqueda exacta por folio, no un inventario completo.",
    capacidadesIq: capabilityResult.data,
    complementosPendientes: complements.filter((row: any) => row.status !== "VOIDED" && row.status !== "RECEIVED" && (!folio || row.solicitudFolio === folio || row.pagoFolio === folio)).map((row: any) => ({ solicitud: row.solicitudFolio, pago: row.pagoFolio, estado: row.automationStatus || row.status, error: row.automationError || null, proveedor: row.provider, enviadoAlProveedor: row.externalRequestSent === true })),
    folioConsultado: folio,
    solicitudes: selectedSolicitudes.map(row => ({ folio: row.folio, folioIq: row.folioIq, cliente: row.cliente,
      empresa: row.empresa, monto: row.monto, estado: row.estado,
      factura: row.factura, facturamaStatus: row.facturamaStatus, claveSat: row.claveSat, unidadSat: row.unidadSat })),
    pagos: selectedPagos.map(row => ({ folio: row.folio, folioIq: row.folioIq, cliente: row.cliente, monto: row.monto, estado: row.estado })),
    dudasPendientes: input.memory.recommendations.filter(row => row.status === "PENDING_REVIEW").slice(0, 8).map(row => ({ tipo: row.kind, caso: row.caseId, propuesta: row.proposal, confianza: row.confidence })),
    reglasConfirmadas: input.memory.rules.filter(row => Number(row.approvals || 0) > Number(row.rejections || 0)).slice(0, 10).map(row => ({ tipo: row.kind, regla: row.proposal, correccion: row.correction || null, aprobaciones: row.approvals || 0 })),
  };
  const pieces: ContextPiece[] = [{ kind: "USER_STATEMENT", sourceSystem: "USER", completeness: "COMPLETE" },
    ...[solicitudResult, pagoResult, complementResult, capabilityResult].flatMap(result => result.evidence.map(row => ({ kind: "FACT" as const, sourceSystem: row.sourceSystem, entityType: row.entityType, entityId: row.entityId, completeness: row.completeness }))),
    ...input.memory.recommendations.slice(0, 8).map(row => ({ kind: "MEMORY" as const, sourceSystem: "HUGO", entityType: "recommendation", entityId: row.id, completeness: "PARTIAL" })),
    ...input.memory.rules.slice(0, 10).map(row => ({ kind: "RULE" as const, sourceSystem: "HUGO", entityType: "rule", entityId: row.id, completeness: "PARTIAL" }))];
  if (solicitudResult.completeness === "UNKNOWN" && pagoResult.completeness === "UNKNOWN") pieces.push({ kind: "UNKNOWN", sourceSystem: "PAY0", completeness: "UNKNOWN" });
  const recentEntities: RecentEntity[] = [...selectedSolicitudes.map(row => ({ system: "PAY0" as const, type: "SOLICITUD" as const, id: row.id, folio: row.folio })).filter(row => row.folio),
    ...selectedPagos.map(row => ({ system: "PAY0" as const, type: "PAGO" as const, id: row.id, folio: row.folio })).filter(row => row.folio)].slice(0, 8);
  return { context, pieces, toolResults: [solicitudResult, pagoResult, complementResult, capabilityResult], recentEntities };
}
