export type EarningsReportToolInput = { dateFrom?: string; dateTo?: string; compareDateFrom?: string; compareDateTo?: string; limit?: number; includeCompensated?: boolean };

export function validateEarningsReportInput(input: EarningsReportToolInput): void {
  if (!input.dateFrom || !input.dateTo) throw Error("HUGO_TOOL_INVALID_INPUT");
  if (Object.keys(input).some(key => !["dateFrom", "dateTo", "compareDateFrom", "compareDateTo", "limit", "includeCompensated"].includes(key))) throw Error("HUGO_TOOL_INVALID_INPUT");
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
    ? { dateFrom: previous!.dateFrom, dateTo: previous!.dateTo, compareDateFrom: dates[0], compareDateTo: dates[1], limit: previous!.limit ?? 5000, includeCompensated }
    : { dateFrom: dates[0], dateTo: dates[1], ...(dates.length === 4 ? { compareDateFrom: dates[2], compareDateTo: dates[3] } : {}), limit: 5000, includeCompensated };
  try { validateEarningsReportInput(input); } catch { return null; }
  return input;
}

export function formatEarningsReport(data: any): string {
  const amount = (value: unknown) => Number(value || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const base = `Reporte de utilidades por cliente del ${data.dateFrom || "inicio disponible"} al ${data.dateTo || "último registro disponible"}: ${data.summary.operationsCount} operaciones de ${data.summary.clientsCount} clientes; utilidades registradas ${amount(data.summary.totalEarningsAmount)}. Operaciones compensadas ${data.includeCompensated ? "incluidas" : "excluidas"}. Se revisaron ${data.docsScanned} registros, con límite de ${data.scanLimit}. ${data.mayBeTruncated ? "Se alcanzó el límite; el reporte puede estar incompleto." : "El resumen corresponde al rango y alcance autorizados."} Importes según el reporte canónico de PAY0, sin conversión adicional de monedas.`;
  if (!data.comparison) return base;
  const comparison = data.comparison;
  return `${base} Comparación con ${comparison.dateFrom} al ${comparison.dateTo}: ${comparison.summary.operationsCount} operaciones de ${comparison.summary.clientsCount} clientes; utilidades registradas ${amount(comparison.summary.totalEarningsAmount)}. Diferencia del periodo principal menos el comparado: ${amount(comparison.difference.totalEarningsAmount)} en utilidades y ${comparison.difference.operationsCount} operaciones. ${comparison.mayBeTruncated ? "El periodo comparado también puede estar incompleto por el límite de registros." : "Ambos periodos usan los mismos filtros de compensadas y alcance autorizado."}`;
}
