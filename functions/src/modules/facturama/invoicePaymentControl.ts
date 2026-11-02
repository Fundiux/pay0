import { FieldPath, Query, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { onCall } from "firebase-functions/v2/https";
import { assertAuthorized } from "../../utils/authGuard";
import { db, getMyUser, requireAuth } from "../sharedCallables/helpers";

// Control de facturas emitidas contra pagos aplicados, en ambos sentidos:
// - FACTURA_SIN_PAGO: solicitud con factura emitida y sin pago aplicado.
// - PAGO_SIN_FACTURA: pago aplicado a una solicitud que no tiene factura emitida.
// - PAGO_SIN_APLICACION: pago activo que no está aplicado a ninguna solicitud.
// Solo es lectura. El vínculo es por solicitud: pagoAplicaciones (solicitudId + pagoId)
// contra la factura de la solicitud (facturaUuid/uuidCfdi/iqInvoiceUuid o facturamaInvoices).

const PAGE_SIZE = 500;
const MAX_DOCS_PER_COLLECTION = 20000;
const MAX_LISTED_ROWS = 200;

// Solo facturas timbradas en producción cuentan como emitidas. Las de sandbox se reportan aparte.
const ISSUED_INVOICE_STATUSES = new Set(["PRODUCTION_ISSUED", "ISSUED", "EMITTED"]);
const APPLIED_APPLICATION_STATUSES = new Set(["APLICADA", "APPLIED", "IQ_APPLIED"]);
const INACTIVE_SOLICITUD_STATUSES = new Set(["CANCELADO", "CANCELADA", "RECHAZADO", "RECHAZADA", "ELIMINADA"]);
const INACTIVE_PAGO_STATUSES = new Set(["CANCELADO", "CANCELADA", "RECHAZADO", "RECHAZADA", "ELIMINADA"]);

export type ControlSolicitud = {
  id: string;
  folio?: string | null;
  folioIq?: string | null;
  status?: string | null;
  facturaUuid?: string | null;
  uuidCfdi?: string | null;
  iqInvoiceUuid?: string | null;
};

export type ControlInvoice = {
  id: string;
  sourceSolicitudId?: string | null;
  status?: string | null;
  uuid?: string | null;
};

export type ControlApplication = {
  id: string;
  pagoId?: string | null;
  solicitudId?: string | null;
  montoAplicado?: number | null;
  status?: string | null;
};

export type ControlPago = {
  id: string;
  folio?: string | null;
  pagoFolio?: string | null;
  status?: string | null;
};

export type InvoicePaymentControlInput = {
  solicitudes: ControlSolicitud[];
  invoices: ControlInvoice[];
  applications: ControlApplication[];
  pagos: ControlPago[];
};

const clean = (value: unknown, max = 160) =>
  String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, max);

const upper = (value: unknown) => clean(value, 80).toUpperCase();

// Trabaja en centavos para que las sumas no acumulen error de punto flotante.
const toCents = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
};

const fromCents = (cents: number) => cents / 100;

export function buildInvoicePaymentControl(input: InvoicePaymentControlInput) {
  const solicitudesById = new Map(input.solicitudes.map(row => [row.id, row]));
  const pagosById = new Map(input.pagos.map(row => [row.id, row]));

  const isActiveSolicitud = (row: ControlSolicitud | undefined) =>
    Boolean(row) && !INACTIVE_SOLICITUD_STATUSES.has(upper(row?.status));

  // 1. Facturas emitidas por solicitud.
  const invoiceBySolicitud = new Map<string, { source: "SOLICITUD" | "FACTURAMA"; uuid: string | null; ref: string }>();
  for (const solicitud of input.solicitudes) {
    const uuid = clean(solicitud.facturaUuid || solicitud.uuidCfdi || solicitud.iqInvoiceUuid, 80);
    if (uuid) invoiceBySolicitud.set(solicitud.id, { source: "SOLICITUD", uuid, ref: solicitud.id });
  }
  let facturasSandboxIgnoradas = 0;
  for (const invoice of input.invoices) {
    const solicitudId = clean(invoice.sourceSolicitudId, 128);
    if (!solicitudId) continue;
    const status = upper(invoice.status);
    if (!ISSUED_INVOICE_STATUSES.has(status)) {
      if (status.startsWith("SANDBOX")) facturasSandboxIgnoradas += 1;
      continue;
    }
    if (!invoiceBySolicitud.has(solicitudId)) {
      invoiceBySolicitud.set(solicitudId, { source: "FACTURAMA", uuid: clean(invoice.uuid, 80) || null, ref: invoice.id });
    }
  }

  // 2. Pagos aplicados por solicitud (solo aplicaciones vigentes con monto positivo).
  const activeApplications = input.applications.filter(
    row => APPLIED_APPLICATION_STATUSES.has(upper(row.status)) && toCents(row.montoAplicado) > 0 && clean(row.solicitudId, 128),
  );
  const appliedCentsBySolicitud = new Map<string, number>();
  const appliedPagoIds = new Set<string>();
  for (const application of activeApplications) {
    const solicitudId = clean(application.solicitudId, 128);
    appliedCentsBySolicitud.set(solicitudId, (appliedCentsBySolicitud.get(solicitudId) || 0) + toCents(application.montoAplicado));
    appliedPagoIds.add(clean(application.pagoId, 128));
  }

  const folioOf = (row: ControlSolicitud | undefined) => clean(row?.folio || row?.folioIq, 80) || null;
  const pagoFolioOf = (pagoId: string) => {
    const pago = pagosById.get(pagoId);
    return clean(pago?.folio || pago?.pagoFolio, 80) || null;
  };

  // 3. FACTURA_SIN_PAGO
  const facturaSinPagoAll = input.solicitudes
    .filter(solicitud => isActiveSolicitud(solicitud) && invoiceBySolicitud.has(solicitud.id) && !appliedCentsBySolicitud.has(solicitud.id))
    .map(solicitud => {
      const invoice = invoiceBySolicitud.get(solicitud.id)!;
      return { solicitudId: solicitud.id, solicitudFolio: folioOf(solicitud), status: clean(solicitud.status, 80) || null, facturaSource: invoice.source, facturaUuid: invoice.uuid, facturaRef: invoice.ref };
    });

  // 4. PAGO_SIN_FACTURA (una fila por aplicación de pago a solicitud sin factura)
  const pagoSinFacturaAll = activeApplications
    .map(application => ({ application, solicitud: solicitudesById.get(clean(application.solicitudId, 128)) }))
    .filter(({ solicitud }) => isActiveSolicitud(solicitud) && !invoiceBySolicitud.has(solicitud!.id))
    .map(({ application, solicitud }) => {
      const pagoId = clean(application.pagoId, 128);
      return {
        applicationId: application.id,
        pagoId,
        pagoFolio: pagoFolioOf(pagoId),
        solicitudId: solicitud!.id,
        solicitudFolio: folioOf(solicitud),
        montoAplicado: fromCents(toCents(application.montoAplicado)),
      };
    });

  // 5. PAGO_SIN_APLICACION (pago activo sin ninguna aplicación vigente)
  const pagosSinAplicacionAll = input.pagos
    .filter(pago => !INACTIVE_PAGO_STATUSES.has(upper(pago.status)) && !appliedPagoIds.has(pago.id))
    .map(pago => ({ pagoId: pago.id, pagoFolio: clean(pago.folio || pago.pagoFolio, 80) || null, status: clean(pago.status, 80) || null }));

  // 6. PAGO_EN_SOLICITUD_INACTIVA (pago vigente aplicado a solicitud cancelada, rechazada o inexistente)
  const pagoEnSolicitudInactivaAll = activeApplications
    .map(application => ({ application, solicitud: solicitudesById.get(clean(application.solicitudId, 128)) }))
    .filter(({ solicitud }) => !isActiveSolicitud(solicitud))
    .map(({ application, solicitud }) => {
      const pagoId = clean(application.pagoId, 128);
      return {
        applicationId: application.id,
        pagoId,
        pagoFolio: pagoFolioOf(pagoId),
        solicitudId: clean(application.solicitudId, 128),
        solicitudFolio: folioOf(solicitud),
        solicitudStatus: solicitud ? clean(solicitud.status, 80) || null : "NO_ENCONTRADA",
        montoAplicado: fromCents(toCents(application.montoAplicado)),
      };
    });

  const montoPagadoSinFactura = pagoSinFacturaAll.reduce((sum, row) => sum + toCents(row.montoAplicado), 0);
  const solicitudesActivas = input.solicitudes.filter(isActiveSolicitud);

  return {
    summary: {
      solicitudesActivas: solicitudesActivas.length,
      solicitudesConFactura: solicitudesActivas.filter(row => invoiceBySolicitud.has(row.id)).length,
      solicitudesConPagoAplicado: solicitudesActivas.filter(row => appliedCentsBySolicitud.has(row.id)).length,
      solicitudesSinPago: solicitudesActivas.filter(row => !appliedCentsBySolicitud.has(row.id)).length,
      facturaSinPago: facturaSinPagoAll.length,
      pagoSinFactura: pagoSinFacturaAll.length,
      montoPagadoSinFactura: fromCents(montoPagadoSinFactura),
      pagosSinAplicacion: pagosSinAplicacionAll.length,
      pagoEnSolicitudInactiva: pagoEnSolicitudInactivaAll.length,
      facturasSandboxIgnoradas,
    },
    facturaSinPago: facturaSinPagoAll.slice(0, MAX_LISTED_ROWS),
    pagoSinFactura: pagoSinFacturaAll.slice(0, MAX_LISTED_ROWS),
    pagosSinAplicacion: pagosSinAplicacionAll.slice(0, MAX_LISTED_ROWS),
    pagoEnSolicitudInactiva: pagoEnSolicitudInactivaAll.slice(0, MAX_LISTED_ROWS),
    listedLimit: MAX_LISTED_ROWS,
  };
}

async function readAllByRoot<T extends { id: string }>(query: Query): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = [];
  let last: QueryDocumentSnapshot | undefined;
  while (rows.length < MAX_DOCS_PER_COLLECTION) {
    let page = query.orderBy(FieldPath.documentId()).limit(PAGE_SIZE);
    if (last) page = page.startAfter(last);
    const snapshot = await page.get();
    for (const doc of snapshot.docs) rows.push({ id: doc.id, ...doc.data() } as unknown as T);
    if (snapshot.size < PAGE_SIZE) return { rows, truncated: false };
    last = snapshot.docs[snapshot.docs.length - 1];
  }
  return { rows, truncated: true };
}

export const getInvoicePaymentControl = onCall(
  { region: "us-central1", timeoutSeconds: 120, memory: "512MiB" },
  async (request) => {
    const uid = requireAuth(request);
    const user = await getMyUser(uid);
    // Resumen del dashboard: superadmin y admin con acceso al módulo dashboard.
    assertAuthorized(request.auth, user, { allowedRoles: ["superadmin", "admin"], requiredModule: "dashboard", requiredAction: "view" });
    const rootId = clean(user?.rootId || uid, 128);

    const [solicitudes, invoices, applications, pagos] = await Promise.all([
      readAllByRoot<ControlSolicitud>(db.collection("solicitudes").where("rootId", "==", rootId).select("folio", "folioIq", "status", "facturaUuid", "uuidCfdi", "iqInvoiceUuid")),
      readAllByRoot<ControlInvoice>(db.collection("facturamaInvoices").where("rootId", "==", rootId).select("sourceSolicitudId", "status", "uuid")),
      readAllByRoot<ControlApplication>(db.collection("pagoAplicaciones").where("rootId", "==", rootId).select("pagoId", "solicitudId", "montoAplicado", "status")),
      readAllByRoot<ControlPago>(db.collection("pagos").where("rootId", "==", rootId).select("folio", "pagoFolio", "status")),
    ]);

    return {
      ok: true,
      generatedAt: new Date().toISOString(),
      truncated: solicitudes.truncated || invoices.truncated || applications.truncated || pagos.truncated,
      ...buildInvoicePaymentControl({
        solicitudes: solicitudes.rows,
        invoices: invoices.rows,
        applications: applications.rows,
        pagos: pagos.rows,
      }),
    };
  },
);
