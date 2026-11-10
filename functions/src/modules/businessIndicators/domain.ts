import { isConfirmedFacturamaCancellation } from "../facturama/cancellationStatus";
import { getSolicitudCoverageState } from "../solicitudes/domain";

type Row = Record<string, any>;

const DEAD_STATUS = /CANCEL|RECHAZ|ELIMIN|ANUL/;
const clean = (value: unknown) => String(value ?? "").trim();
const upper = (value: unknown) => clean(value).toUpperCase();
const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const currencyOf = (row: Row) => upper(row.currency || row.moneda) || "MXN";
const isDeleted = (row: Row) => row.isDeleted === true || (row.deletedAt !== undefined && row.deletedAt !== null);
const isDead = (row: Row) => isDeleted(row) || DEAD_STATUS.test(upper(row.status || row.estatus));
const invoiceUuid = (row: Row) => upper(row.facturaUuid || row.uuidCfdi);
const clientName = (row: Row) => clean(row.clienteNombre || row.clientName) || "Cliente sin nombre";

/** Fiscal payment type of an invoiced solicitud; the XML method is the fallback when tipoFactura is empty. */
export function invoiceKind(row: Row): "PPD" | "PUE" | "SIN_TIPO" {
  const kind = upper(row.tipoFactura || row.facturaMetodoPago);
  return kind === "PPD" || kind === "PUE" ? kind : "SIN_TIPO";
}

export type BusinessIndicators = {
  pagos: { total: number; montoPorMoneda: Record<string, number> };
  solicitudes: { total: number; conFactura: number; sinFactura: number; facturasCanceladasExcluidas: number };
  relacionadas: { conPagoAplicado: number; sinPagoAplicado: number };
  pendientes: Record<"PPD" | "PUE" | "SIN_TIPO", { facturas: number; monto: number; otrasMonedas: number }>;
  clienteConMasPendientes: { clienteId: string; cliente: string; facturas: number; monto: number } | null;
  advertencias: string[];
};

/**
 * Business indicators of one period. Pure: the caller reads rows already scoped by rootId and by the period.
 * Invoices whose CFDI was cancelled (Facturama cancellationStatus CANCELED) never count as billing or as debt,
 * and neither do dead (cancelled, rejected, deleted) pagos and solicitudes.
 */
export function computeBusinessIndicators(input: { pagos: Row[]; solicitudes: Row[]; facturas: Row[] }): BusinessIndicators {
  const canceledUuids = new Set(input.facturas.filter(row => isConfirmedFacturamaCancellation(row.cancellationStatus)).map(row => upper(row.uuid)).filter(Boolean));
  const advertencias: string[] = [];
  if (!input.facturas.length && input.solicitudes.some(row => invoiceUuid(row))) advertencias.push("No se pudo cruzar con el estado de cancelación de Facturama; las facturas canceladas en trámite aún cuentan.");

  const pagos = input.pagos.filter(row => !isDead(row));
  const montoPorMoneda: Record<string, number> = {};
  for (const row of pagos) {
    const amount = Number(row.montoTotal ?? row.monto ?? 0);
    if (Number.isFinite(amount)) montoPorMoneda[currencyOf(row)] = round2((montoPorMoneda[currencyOf(row)] || 0) + amount);
  }

  const solicitudes = input.solicitudes.filter(row => !isDead(row));
  let facturasCanceladasExcluidas = 0, conFactura = 0, conPago = 0, sinPago = 0;
  const pendientes = { PPD: { facturas: 0, monto: 0, otrasMonedas: 0 }, PUE: { facturas: 0, monto: 0, otrasMonedas: 0 }, SIN_TIPO: { facturas: 0, monto: 0, otrasMonedas: 0 } };
  const byClient = new Map<string, { clienteId: string; cliente: string; facturas: number; monto: number }>();
  for (const row of solicitudes) {
    const uuid = invoiceUuid(row);
    if (!uuid) continue;
    if (canceledUuids.has(uuid)) { facturasCanceladasExcluidas += 1; continue; }
    conFactura += 1;
    const { applied, pending } = getSolicitudCoverageState(row);
    if (applied > 0) conPago += 1; else sinPago += 1;
    if (pending <= 0.01) continue;
    const bucket = pendientes[invoiceKind(row)];
    bucket.facturas += 1;
    if (currencyOf(row) === "MXN") bucket.monto = round2(bucket.monto + pending); else bucket.otrasMonedas += 1;
    const key = clean(row.clienteId) || clientName(row);
    const entry = byClient.get(key) || { clienteId: clean(row.clienteId), cliente: clientName(row), facturas: 0, monto: 0 };
    entry.facturas += 1;
    if (currencyOf(row) === "MXN") entry.monto = round2(entry.monto + pending);
    byClient.set(key, entry);
  }
  if (Object.values(pendientes).some(bucket => bucket.otrasMonedas)) advertencias.push("Hay facturas pendientes en otra moneda: se cuentan, pero su monto no se suma al total en pesos.");
  const top = [...byClient.values()].sort((a, b) => b.facturas - a.facturas || b.monto - a.monto || a.cliente.localeCompare(b.cliente))[0] || null;

  return {
    pagos: { total: pagos.length, montoPorMoneda },
    solicitudes: { total: solicitudes.length, conFactura, sinFactura: solicitudes.filter(row => !invoiceUuid(row)).length, facturasCanceladasExcluidas },
    relacionadas: { conPagoAplicado: conPago, sinPagoAplicado: sinPago },
    pendientes, clienteConMasPendientes: top, advertencias,
  };
}
