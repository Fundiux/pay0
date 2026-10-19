import type { EarningsByClientReportRow } from "../../reports/types";
export type ReportFileFormat = "PDF" | "XLSX";
export type EarningsReportToolInput = { dateFrom?: string; dateTo?: string; compareDateFrom?: string; compareDateTo?: string; limit?: number; includeCompensated?: boolean; clientQuery?: string; format?: ReportFileFormat };
export type HugoReportExport = { version: 1; kind: "EARNINGS_BY_CLIENT"; format?: ReportFileFormat; fileName: string; dateFrom: string; dateTo: string; includeCompensated: boolean;
  docsScanned: number; scanLimit: number; matchedClients: number; exportedClients: number; truncatedByScan: boolean; truncatedByExport: boolean; rows: EarningsByClientReportRow[] };
export type PendingEarningsReport = { rootId: string; clientQuery?: string; dateFrom?: string; dateTo?: string; compareDateFrom?: string; compareDateTo?: string; includeCompensated: boolean; format?: ReportFileFormat;
  stage: "DATES" | "CLIENT" | "FORMAT" | "READY"; resolvedAt: number; resolvedTurn: number };

export function validateEarningsReportInput(input: EarningsReportToolInput): void {
  if (!input.dateFrom || !input.dateTo) throw Error("HUGO_TOOL_INVALID_INPUT");
  if (Object.keys(input).some(key => !["dateFrom", "dateTo", "compareDateFrom", "compareDateTo", "limit", "includeCompensated", "clientQuery", "format"].includes(key))) throw Error("HUGO_TOOL_INVALID_INPUT");
  if (input.format !== undefined && !["PDF", "XLSX"].includes(input.format)) throw Error("HUGO_TOOL_INVALID_INPUT");
  if (input.clientQuery !== undefined && (typeof input.clientQuery !== "string" || !input.clientQuery.trim() || input.clientQuery.length > 120 || /[\x00-\x1f]/.test(input.clientQuery))) throw Error("HUGO_TOOL_INVALID_INPUT");
  if ((input.compareDateFrom !== undefined) !== (input.compareDateTo !== undefined)) throw Error("HUGO_TOOL_INVALID_INPUT");
  for (const date of [input.dateFrom, input.dateTo, input.compareDateFrom, input.compareDateTo]) {
    if (date !== undefined && (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) throw Error("HUGO_TOOL_INVALID_INPUT");
  }
  if (input.dateFrom && input.dateTo && input.dateFrom > input.dateTo) throw Error("HUGO_TOOL_INVALID_INPUT");
  if (input.compareDateFrom && input.compareDateTo && input.compareDateFrom > input.compareDateTo) throw Error("HUGO_TOOL_INVALID_INPUT");
  if (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 5000)) throw Error("HUGO_TOOL_INVALID_INPUT");
  if (input.includeCompensated !== undefined && typeof input.includeCompensated !== "boolean") throw Error("HUGO_TOOL_INVALID_INPUT");
}

export function isEarningsReportQuestion(message: string): boolean {
  const text = message.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return /\b(reporte|informe|resumen)\b/i.test(text) && /\b(utilidades|ganancias|honorarios)\b/i.test(text) && /\bclientes?\b/i.test(text);
}

export const isEarningsReportComparison = (message: string) => /\b(compara|comparalo|comparala|comparar|comparacion|comparado|comparada)\b/i.test(message.normalize("NFD").replace(/[\u0300-\u036f]/g, ""));

export function normalizePendingReport(raw: any, rootId: string, turn: number, now: number): PendingEarningsReport | undefined {
  if (!raw || raw.rootId !== rootId || !["DATES", "CLIENT", "FORMAT", "READY"].includes(raw.stage) || !Number.isFinite(raw.resolvedAt) || raw.resolvedAt > now || now - raw.resolvedAt > 30 * 60_000 ||
    !Number.isInteger(raw.resolvedTurn) || raw.resolvedTurn < 0 || raw.resolvedTurn > turn || turn - raw.resolvedTurn > 4 || typeof raw.includeCompensated !== "boolean") return;
  if (raw.clientQuery !== undefined && (typeof raw.clientQuery !== "string" || !raw.clientQuery.trim() || raw.clientQuery.length > 120 || /[\x00-\x1f]/.test(raw.clientQuery))) return;
  if (raw.format !== undefined && !["PDF", "XLSX"].includes(raw.format)) return;
  if (raw.dateFrom !== undefined || raw.dateTo !== undefined || raw.compareDateFrom !== undefined || raw.compareDateTo !== undefined) {
    try { validateEarningsReportInput({ dateFrom: raw.dateFrom, dateTo: raw.dateTo, ...(raw.compareDateFrom !== undefined || raw.compareDateTo !== undefined ? { compareDateFrom: raw.compareDateFrom, compareDateTo: raw.compareDateTo } : {}) }); } catch { return; }
  }
  return { rootId, stage: raw.stage, includeCompensated: raw.includeCompensated, resolvedAt: raw.resolvedAt, resolvedTurn: raw.resolvedTurn,
    ...(raw.clientQuery ? { clientQuery: raw.clientQuery.trim() } : {}), ...(raw.format ? { format: raw.format } : {}), ...(raw.dateFrom ? { dateFrom: raw.dateFrom, dateTo: raw.dateTo } : {}), ...(raw.compareDateFrom ? { compareDateFrom: raw.compareDateFrom, compareDateTo: raw.compareDateTo } : {}) };
}

export function reportConversationResetReply(message: string): string | null {
  const text = message.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/^[\s\u00a1\u00bf!?.]+|[\s!?.]+$/g, "");
  if (/^(?:hola(?:\s+(?:maria|hugo))?|buen(?:os dias|as tardes|as noches)|que tal|como estas)(?:\s+(?:maria|hugo))?$/.test(text)) return "Hola. ¿En qué puedo ayudarte?";
  if (/^(?:nueva conversacion|(?:inicia|iniciar|empieza|empezar|comienza|comenzar) (?:una )?nueva conversacion|(?:olvida|cancela) (?:lo anterior|el reporte|la consulta))$/.test(text)) return "De acuerdo, dejamos la consulta anterior. ¿En qué puedo ayudarte?";
  return null;
}

export function pendingReportRequest(message: string, previous?: PendingEarningsReport): { intent: boolean; request: EarningsReportToolInput | null; clientQuery?: string; includeCompensated?: boolean; format?: ReportFileFormat } {
  const text = message.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (reportConversationResetReply(message)) return { intent: false, request: null };
  const initial = isEarningsReportQuestion(message);
  const repeatedReport = !!previous && /\b(reporte|informe)\b/i.test(text) && /\b(utilidades|ganancias|honorarios|nuevamente|otra vez)\b/i.test(text);
  const pdf = /\bpdf\b/i.test(text), xlsx = /\b(excel|xlsx|xls)\b/i.test(text);
  const explicitFormat: ReportFileFormat | undefined = pdf !== xlsx ? pdf ? "PDF" : "XLSX" : undefined;
  const format = pdf && xlsx ? undefined : explicitFormat || (!initial ? previous?.format || (previous?.stage === "READY" ? "XLSX" : undefined) : undefined);
  const unquotedMessage = message.trim().replace(/^[\s\u0022\u0027\u201c\u201d\u00ab\u00bb]+|[\s\u0022\u0027\u201c\u201d\u00ab\u00bb]+$/g, "");
  const plainClientName = previous?.stage === "CLIENT" && /^[\p{L}\p{N}][\p{L}\p{N}\s&.'\u2019,\-]{0,119}$/u.test(unquotedMessage) &&
    !/^(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)(?:\s+(?:de\s+)?\d{4})?[.!?]?$/i.test(unquotedMessage) &&
    !/\b(hola|gracias|reporte|informe|formato|pdf|excel|xlsx|explica|explicame|consulta|quiero|puedes|ayuda|ayudame|nuevamente|otro tema)\b/i.test(text);
  const continuation = !!previous && !/\b(pagos?|solicitudes?|dispersiones?|otro tema|cambiando de tema)\b/i.test(text) &&
    (plainClientName || repeatedReport || pdf || xlsx || /\bdescarg\w*\b|\b\d{4}-\d{2}-\d{2}\b|\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|descarga|descargar|archivo)\b/i.test(text));
  if (!initial && !continuation) return { intent: false, request: null };
  const capturedName = message.match(/\bcliente\s+(.+)/i)?.[1]
    ?.replace(/\s+\d{4}-\d{2}-\d{2}[\s\S]*$/, "")
    .replace(/\s+(?:y\s+)?(?:lo\s+)?(?:quiero\s+)?en\s+(?:formato\s+)?(?:pdf|excel|xlsx|xls)\b[\s\S]*$/i, "")
    .replace(/\s+del\s+(?:mes\s+de\s+)?(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)(?:\s+(?:de\s+)?\d{4})?\s*$/i, "")
    .replace(/\s+(?:incluye|incluir|sin|con|no incluyas)\s+(?:las\s+)?compensadas\b[\s\S]*$/i, "")
    .replace(/\s+(?:del?|desde|entre|al)\s*$/i, "").trim().replace(/^[\s\u0022\u0027\u201c\u201d\u00ab\u00bb]+|[\s\u0022\u0027\u201c\u201d\u00ab\u00bb?.!,;:]+$/g, "");
  const name = capturedName && !/^(?:del?|por|para|en|entre|desde|con|sin|incluye)\b/i.test(capturedName) ? capturedName : undefined;
  const clientQuery = name || (!initial && plainClientName && !explicitFormat && !/\b\d{4}-\d{2}-\d{2}\b/.test(text) ? unquotedMessage.replace(/[?.!,;]+$/, "") : !initial ? previous?.clientQuery : undefined);
  const dates = text.match(/\b\d{4}-\d{2}-\d{2}\b/g) || [];
  const priorDates = !initial && previous?.dateFrom && previous.dateTo ? `${previous.dateFrom} ${previous.dateTo}` : "";
  const monthOnly = !plainClientName && !dates.length && /\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/i.test(text);
  const exclude = /\b(sin|excluye|excluir|no incluyas)\s+(?:las\s+)?compensadas\b/i.test(text);
  const includeCompensated = exclude ? false : /\b(incluye|incluir|con)\s+(?:las\s+)?compensadas\b/i.test(text) ? true : !initial && previous?.includeCompensated === true;
  const candidate = monthOnly ? null : earningsReportRequest(initial ? message : `reporte utilidades clientes ${dates.length ? message : priorDates}`);
  if (!candidate) return { intent: true, request: null, includeCompensated, ...(format ? { format } : {}), ...(clientQuery ? { clientQuery: clientQuery.slice(0, 120) } : {}) };
  candidate.includeCompensated = includeCompensated;
  if (!dates.length && previous?.compareDateFrom && previous.compareDateTo) {
    candidate.compareDateFrom = previous.compareDateFrom; candidate.compareDateTo = previous.compareDateTo;
  }
  if (format) candidate.format = format;
  if (clientQuery) candidate.clientQuery = clientQuery.slice(0, 120);
  return { intent: true, request: candidate, includeCompensated, ...(format ? { format } : {}), ...(clientQuery ? { clientQuery: clientQuery.slice(0, 120) } : {}) };
}

export function claimsUnexecutedReport(text: string, message: string): boolean {
  const normalized = `${message} ${text}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const answer = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return /\b(reporte|informe|archivo|excel|xlsx|pdf)\b/.test(normalized) &&
    /\b(generad[oa]s?|genere|generare|generando|preparad[oa]s?|prepare|preparare|preparando|cread[oa]s?|adjunt[oa]|list[oa]|descargar|descarga)\b|\b(voy|vamos)\s+a\s+(generar|preparar|crear|entregar)\b/.test(answer);
}

export function earningsReportRequest(message: string, previous?: EarningsReportToolInput): EarningsReportToolInput | null {
  const text = message.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const comparison = isEarningsReportComparison(message);
  if (!isEarningsReportQuestion(message) && !(previous && comparison)) return null;
  const dates = text.match(/\b\d{4}-\d{2}-\d{2}\b/g) || [];
  // Relative or ambiguous periods require clarification, never silently all-time.
  if (dates.length !== 2 && !(comparison && dates.length === 4)) return null;
  if (comparison && dates.length === 2 && !previous) return null;
  const excludeCompensated = /\b(sin|excluye|excluir)\s+(?:las\s+)?compensadas\b|\bno\s+(?:incluyas|incluya|incluye|incluir)\s+(?:las\s+)?compensadas\b/i.test(text);
  const explicitInclude = /\b(incluye|incluir|con)\s+(?:las\s+)?compensadas\b/i.test(text);
  const includeCompensated = excludeCompensated ? false : explicitInclude ? true : comparison && dates.length === 2 && previous ? previous.includeCompensated === true : false;
  const input: EarningsReportToolInput = comparison && dates.length === 2
    ? { dateFrom: previous!.dateFrom, dateTo: previous!.dateTo, compareDateFrom: dates[0], compareDateTo: dates[1], limit: previous!.limit ?? 5000, includeCompensated, ...(previous!.clientQuery ? { clientQuery: previous!.clientQuery } : {}), ...(previous!.format ? { format: previous!.format } : {}) }
    : { dateFrom: dates[0], dateTo: dates[1], ...(dates.length === 4 ? { compareDateFrom: dates[2], compareDateTo: dates[3] } : {}), limit: 5000, includeCompensated };
  try { validateEarningsReportInput(input); } catch { return null; }
  return input;
}

export function formatEarningsReport(data: any): string {
  if (data.clientResolution?.status === "AMBIGUOUS") return `Encontré varios clientes autorizados que coinciden: ${data.clientResolution.candidates.join(", ")}. Indica el nombre completo del cliente; todavía no he generado un reporte ni un archivo para uno de ellos.`;
  if (data.clientResolution?.status === "NOT_FOUND") return `No encontré una coincidencia para ese cliente entre las operaciones autorizadas del periodo.${data.mayBeTruncated ? " La búsqueda puede estar incompleta por el límite de registros." : ""} Confirma el nombre completo; esto no demuestra que el cliente no exista.`;
  const amount = (value: unknown) => Number(value || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const base = `Reporte de utilidades${data.clientResolution?.status === "RESOLVED" ? ` de ${data.clientResolution.clientName}` : " por cliente"} del ${data.dateFrom || "inicio disponible"} al ${data.dateTo || "último registro disponible"}: ${data.summary.operationsCount} operaciones de ${data.summary.clientsCount} clientes; utilidades registradas ${amount(data.summary.totalEarningsAmount)}. Operaciones compensadas ${data.includeCompensated ? "incluidas" : "excluidas"}. Se revisaron ${data.docsScanned} registros, con límite de ${data.scanLimit}. ${data.mayBeTruncated ? "Se alcanzó el límite; el reporte puede estar incompleto." : "El resumen corresponde al rango y alcance autorizados."} Importes según el reporte canónico de PAY0, sin conversión adicional de monedas.`;
  if (!data.comparison) return base;
  const comparison = data.comparison;
  return `${base} Comparación con ${comparison.dateFrom} al ${comparison.dateTo}: ${comparison.summary.operationsCount} operaciones de ${comparison.summary.clientsCount} clientes; utilidades registradas ${amount(comparison.summary.totalEarningsAmount)}. Diferencia del periodo principal menos el comparado: ${amount(comparison.difference.totalEarningsAmount)} en utilidades y ${comparison.difference.operationsCount} operaciones. ${comparison.mayBeTruncated ? "El periodo comparado también puede estar incompleto por el límite de registros." : "Ambos periodos usan los mismos filtros de compensadas y alcance autorizado."}`;
}
