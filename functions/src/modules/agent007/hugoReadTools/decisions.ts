import type { DecisionClientItem, FindDecisionsInput, FindDecisionsResult, MatchNote } from "./contract";
import { HUGO_READ_LIMITS } from "./contract";
import { FUZZY_THRESHOLD, fuzzyScore, mexicoDate, mexicoDayRange, toMillis } from "./search";
import type { RawRow } from "./search";

/** Decisions read per root; above it the answer says it covers only the ones read. */
export const DECISIONS_READ_LIMIT = 1000;
const OPTIONS = ["FACTURAR_PUE", "ESPERAR_FACTURA", "APLICAR_A_FACTURA_EXISTENTE", "DEVOLVER"] as const;
const NOTE_MAX = 160;

const text = (value: unknown, max = 200) => typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
const emptyCounts = () => Object.fromEntries(OPTIONS.map(option => [option, 0])) as Record<string, number>;
const optionOf = (row: RawRow) => text(row.option, 60).toUpperCase();
const clientKey = (row: RawRow) => text(row.clienteId, 160) || text(row.snapshot?.clienteNombre) || "sin-cliente";

/**
 * Pattern of the manual decisions made on pagos without a solicitud, per client. Pure: the caller supplies
 * rows already read with the server-resolved rootId. The final decision of each pago is what counts toward
 * the pattern; earlier ones only show up as "cambios" (decisions changed after the first one).
 */
export function findPagoSinSolicitudDecisions(rows: RawRow[], input: FindDecisionsInput, readCapReached = false): FindDecisionsResult {
  const filtros: Record<string, unknown> = {}, interpretacion: MatchNote[] = [], advertencias: string[] = [];
  let selected = rows.filter(row => row && typeof row.id === "string");
  const { fromMs, toMs } = mexicoDayRange(input.desde, input.hasta);
  if (input.desde) filtros.desde = input.desde;
  if (input.hasta) filtros.hasta = input.hasta;
  if (fromMs !== undefined || toMs !== undefined) selected = selected.filter(row => { const ms = toMillis(row.createdAt); return ms !== null && (fromMs === undefined || ms >= fromMs) && (toMs === undefined || ms < toMs); });
  if (input.cliente) {
    const names = new Set<string>();
    for (const row of selected) { const name = text(row.snapshot?.clienteNombre); if (name) names.add(name); }
    const matches = [...names].filter(name => fuzzyScore(input.cliente!, name) >= FUZZY_THRESHOLD);
    filtros.cliente = input.cliente;
    interpretacion.push({ campo: "cliente", dicho: input.cliente, entendido: matches.slice(0, 3).join(" / ") || "sin coincidencias",
      confianza: matches.length === 1 && matches[0].toLowerCase() === input.cliente.toLowerCase() ? "EXACTA" : "APROXIMADA" });
    const allowed = new Set(matches);
    selected = selected.filter(row => allowed.has(text(row.snapshot?.clienteNombre)));
  }
  if (input.opcion) { filtros.opcion = input.opcion; selected = selected.filter(row => optionOf(row) === input.opcion); }

  // The final decision of a pago is its newest one.
  const byPago = new Map<string, RawRow>();
  for (const row of selected) {
    const key = `${clientKey(row)}|${text(row.pagoId, 160) || row.id}`, current = byPago.get(key);
    if (!current || (toMillis(row.createdAt) ?? 0) >= (toMillis(current.createdAt) ?? 0)) byPago.set(key, row);
  }
  const groups = new Map<string, { cliente: string; todas: number; finales: RawRow[] }>();
  for (const row of selected) {
    const group = groups.get(clientKey(row)) || { cliente: text(row.snapshot?.clienteNombre) || "Cliente sin nombre", todas: 0, finales: [] };
    group.todas += 1; groups.set(clientKey(row), group);
  }
  for (const row of byPago.values()) groups.get(clientKey(row))?.finales.push(row);

  const porOpcion = emptyCounts();
  const items: DecisionClientItem[] = [...groups.values()].map(group => {
    const counts = emptyCounts();
    for (const row of group.finales) { const option = optionOf(row); counts[option] = (counts[option] || 0) + 1; porOpcion[option] = (porOpcion[option] || 0) + 1; }
    const latest = [...group.finales].sort((a, b) => (toMillis(b.createdAt) ?? 0) - (toMillis(a.createdAt) ?? 0))[0];
    const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return { cliente: group.cliente, pagos: group.finales.length, decisiones: group.todas, cambios: group.todas - group.finales.length,
      porOpcion: counts, opcionMasFrecuente: dominant && dominant[1] > 0 ? dominant[0] : null,
      ultimaOpcion: latest ? optionOf(latest) : null, ultimaFecha: latest ? mexicoDate(latest.createdAt) : null,
      ultimaNota: latest ? text(latest.note, NOTE_MAX) || null : null };
  }).sort((a, b) => b.pagos - a.pagos || a.cliente.localeCompare(b.cliente));

  if (readCapReached) advertencias.push(`Solo se leyeron las primeras ${DECISIONS_READ_LIMIT} decisiones; el resultado puede estar incompleto.`);
  const limit = Math.min(Math.max(Math.trunc(Number(input.limite) || HUGO_READ_LIMITS.defaultItems), 1), HUGO_READ_LIMITS.maxItems);
  const shown = input.soloConteo ? [] : items.slice(0, limit);
  return { total: byPago.size, decisiones: selected.length, clientes: items.length, porOpcion, mostrados: shown.length, items: shown, filtros, interpretacion, advertencias };
}
